import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path, { dirname, join } from "node:path";

import { parseAnyComposition, validateCompositionBindings } from "@/modules/artifacts";

import type { Conflict } from "./conflicts";
import { GeneratorDomainError } from "./errors";
import {
  MANIFEST_FILENAME,
  emptyManifest,
  parseManifest,
  serializeManifest,
  sha256,
  type OwnershipManifest,
} from "./ownership";
import { TEMPLATE_COPY_EXCLUDES } from "./paths";
import {
  CODEGEN_ZONE_DIRS,
  flattenSitemap,
  renderCodegenFiles,
  renderHumanScaffolds,
  slugify,
  type GeneratorInput,
} from "./render";

/**
 * File-level generation/regeneration engine (§7.3, §18.2). Direct port of the
 * validated spike `spikes/regen/src/{generator,regenerate}.ts`, adapted to:
 * - start from the project template (copied on first generation),
 * - track ONLY codegen files + human scaffolds in the manifest (template files
 *   are implicitly human territory and never rewritten),
 * - the platform-contract file layout (see `render.ts`).
 *
 * This layer knows nothing about the DB or git — `service.ts` orchestrates.
 */

export interface EngineGenerateResult {
  repoDir: string;
  /** Codegen-owned files written (sorted). */
  codegenFiles: string[];
  /** Human-owned scaffolds written once (sorted). */
  humanFiles: string[];
  /** Binding conflicts already present in the approved compositions. */
  conflicts: Conflict[];
  manifest: OwnershipManifest;
}

export interface EngineRegenerateResult {
  repoDir: string;
  /** Codegen files rewritten because the spec changed them. */
  written: string[];
  /** Files created for the first time (new collections/pages/scaffolds). */
  created: string[];
  /** Codegen files whose generated content is identical — untouched. */
  skipped: string[];
  /** Human-owned files present on disk — never read for diffing, never written. */
  preserved: string[];
  /** Codegen files no longer produced by the spec, deleted (only if pristine). */
  deletedOrphans: string[];
  /** Conflicts reported, never auto-resolved (§18.2). */
  conflicts: Conflict[];
}

function writeFileEnsuringDir(repoDir: string, relPath: string, content: string): void {
  const abs = join(repoDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function copyTemplate(templateDir: string, repoDir: string): void {
  if (!existsSync(templateDir)) {
    throw new GeneratorDomainError(
      "TEMPLATE_NOT_FOUND",
      `No existe el template del proyecto en \`${templateDir}\`. ` +
        "Crea `templates/project-base` (o define PROJECT_TEMPLATE_DIR).",
    );
  }
  cpSync(templateDir, repoDir, {
    recursive: true,
    filter: (src) => !TEMPLATE_COPY_EXCLUDES.has(path.basename(src)),
  });
}

/**
 * The single project-specific value inside the otherwise template-static
 * `package.json`: its `name`. Set ONCE at initial generation via JSON merge
 * and deliberately NOT tracked in the manifest — dependencies and scripts are
 * the project's territory, so regeneration never reads or rewrites this file
 * (TEMPLATE.md, "package.json").
 */
function applyPackageName(repoDir: string, projectName: string): void {
  const pkgPath = join(repoDir, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  pkg.name = slugify(projectName);
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

export function hasManifest(repoDir: string): boolean {
  return existsSync(join(repoDir, MANIFEST_FILENAME));
}

export function readManifest(repoDir: string): OwnershipManifest {
  return parseManifest(readFileSync(join(repoDir, MANIFEST_FILENAME), "utf8"));
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

/**
 * Initial generation (§7.3): template copy + codegen + human scaffolds +
 * ownership manifest. Refuses to run on a directory that already has a
 * manifest — regeneration is a different operation with different rules.
 */
export function engineGenerate(
  input: GeneratorInput,
  repoDir: string,
  templateDir: string,
): EngineGenerateResult {
  if (hasManifest(repoDir)) {
    throw new GeneratorDomainError(
      "ALREADY_GENERATED",
      `El proyecto ya fue generado en \`${repoDir}\`; usa la regeneración en su lugar.`,
    );
  }
  rmSync(repoDir, { recursive: true, force: true });
  mkdirSync(repoDir, { recursive: true });
  copyTemplate(templateDir, repoDir);
  applyPackageName(repoDir, input.projectName);

  // Codegen-zone dirs are 100% codegen-owned: purge the template's
  // `@generated-example` placeholders so generated repos never keep stale
  // example files (e.g. collections the spec does not define).
  for (const zone of CODEGEN_ZONE_DIRS) {
    rmSync(join(repoDir, zone), { recursive: true, force: true });
  }

  const manifest = emptyManifest();

  const codegen = renderCodegenFiles(input);
  for (const [relPath, content] of codegen) {
    writeFileEnsuringDir(repoDir, relPath, content);
    manifest.files[relPath] = { owner: "codegen", contentHash: sha256(content) };
  }

  const human = renderHumanScaffolds(input);
  for (const [relPath, content] of human) {
    writeFileEnsuringDir(repoDir, relPath, content);
    // Human-owned: scaffolded once; no hash tracked because codegen will
    // never compare or rewrite this file again.
    manifest.files[relPath] = { owner: "human", contentHash: null };
  }

  writeFileSync(join(repoDir, MANIFEST_FILENAME), serializeManifest(manifest), "utf8");

  // Approved compositions may already carry bindings that the approved
  // collections do not satisfy (artifacts approved out of sync) — report.
  const conflicts = validateBindings(input, repoDir, manifest);

  return {
    repoDir,
    codegenFiles: [...codegen.keys()].sort(),
    humanFiles: [...human.keys()].sort(),
    conflicts,
    manifest,
  };
}

// ---------------------------------------------------------------------------
// regenerate
// ---------------------------------------------------------------------------

/**
 * Partial regeneration (§18.2):
 *  (a) rewrites ONLY codegen-owned files;
 *  (b) a hash mismatch on a codegen file = human edit → conflict, file untouched;
 *  (c) human-owned files (compositions, template files) are never written;
 *  (d) bindings in current (possibly human-edited) compositions are validated
 *      against the NEW collections — a removed field still bound is a
 *      descriptive conflict (page, section, prop, field), page NOT modified;
 *  (e) idempotent: same spec twice → zero diffs (deterministic render + hashes).
 */
export function engineRegenerate(input: GeneratorInput, repoDir: string): EngineRegenerateResult {
  if (!hasManifest(repoDir)) {
    throw new GeneratorDomainError(
      "NOT_GENERATED",
      `No hay manifest de ownership en \`${repoDir}\`; genera el proyecto primero.`,
    );
  }
  const manifest = readManifest(repoDir);

  const result: EngineRegenerateResult = {
    repoDir,
    written: [],
    created: [],
    skipped: [],
    preserved: [],
    deletedOrphans: [],
    conflicts: [],
  };

  // 1. Codegen-owned files: rewrite only pristine ones; conflicts otherwise.
  const desired = renderCodegenFiles(input);

  for (const [relPath, content] of desired) {
    const abs = join(repoDir, relPath);
    const entry = manifest.files[relPath];
    const desiredHash = sha256(content);

    if (!entry) {
      // New codegen file (e.g. new collection). NOTE: if the template shipped
      // a file at this same path, it was never tracked → codegen claims it.
      writeFileEnsuringDir(repoDir, relPath, content);
      manifest.files[relPath] = { owner: "codegen", contentHash: desiredHash };
      result.created.push(relPath);
      continue;
    }

    if (entry.owner !== "codegen") {
      // Defensive: a path claimed by humans is never written by codegen.
      result.preserved.push(relPath);
      continue;
    }

    if (!existsSync(abs)) {
      result.conflicts.push({
        kind: "codegen-file-missing",
        path: relPath,
        message: `El archivo codegen \`${relPath}\` fue borrado fuera de la plataforma; no se recrea automáticamente.`,
      });
      continue;
    }

    const currentHash = sha256(readFileSync(abs, "utf8"));
    if (currentHash !== entry.contentHash) {
      // Human edited inside a codegen zone → conflict, file untouched.
      result.conflicts.push({
        kind: "human-edit-in-codegen-zone",
        path: relPath,
        expectedHash: entry.contentHash ?? "",
        actualHash: currentHash,
        message: `\`${relPath}\` es owned-by-codegen pero fue editado a mano (hash esperado ${entry.contentHash?.slice(0, 12)}…, actual ${currentHash.slice(0, 12)}…). No se sobrescribe; resolución manual requerida.`,
      });
      continue;
    }

    if (currentHash === desiredHash) {
      result.skipped.push(relPath);
      continue;
    }

    writeFileSync(abs, content, "utf8");
    manifest.files[relPath] = { owner: "codegen", contentHash: desiredHash };
    result.written.push(relPath);
  }

  // 2. Orphaned codegen files (spec no longer produces them): delete only if
  //    pristine; a modified orphan is a conflict, never silently removed.
  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (entry.owner !== "codegen" || desired.has(relPath)) continue;
    const abs = join(repoDir, relPath);
    if (!existsSync(abs)) {
      delete manifest.files[relPath];
      continue;
    }
    const currentHash = sha256(readFileSync(abs, "utf8"));
    if (currentHash === entry.contentHash) {
      rmSync(abs);
      delete manifest.files[relPath];
      result.deletedOrphans.push(relPath);
    } else {
      result.conflicts.push({
        kind: "orphan-codegen-modified",
        path: relPath,
        message: `\`${relPath}\` ya no lo genera la spec, pero contiene ediciones manuales; no se borra.`,
      });
    }
  }

  // 3. Human-owned files: never written. Only brand-new pages get a scaffold.
  const scaffolds = renderHumanScaffolds(input);
  for (const [relPath, content] of scaffolds) {
    const abs = join(repoDir, relPath);
    const entry = manifest.files[relPath];
    if (entry || existsSync(abs)) {
      // Existing human file: preserved verbatim, whatever the new spec says.
      result.preserved.push(relPath);
      if (!entry) manifest.files[relPath] = { owner: "human", contentHash: null };
      continue;
    }
    writeFileEnsuringDir(repoDir, relPath, content);
    manifest.files[relPath] = { owner: "human", contentHash: null };
    result.created.push(relPath);
  }
  // Human files for pages no longer in the spec: kept, still human-owned.
  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (entry.owner === "human" && !scaffolds.has(relPath) && existsSync(join(repoDir, relPath))) {
      result.preserved.push(relPath);
    }
  }

  // 4. Binding validation: APPROVED per-page composition artifacts + current
  //    on-disk compositions (as edited by humans) against the NEW collections,
  //    keyed per page. Conflicts are descriptive; nothing is modified.
  result.conflicts.push(...validateBindings(input, repoDir, manifest));

  writeFileSync(join(repoDir, MANIFEST_FILENAME), serializeManifest(manifest), "utf8");

  result.written.sort();
  result.created.sort();
  result.skipped.sort();
  result.preserved = [...new Set(result.preserved)].sort();
  result.deletedOrphans.sort();
  return result;
}

// ---------------------------------------------------------------------------
// Binding validation (shared helper from the artifacts module)
// ---------------------------------------------------------------------------

const COMPOSITIONS_PREFIX = "src/compositions/";

/**
 * `src/compositions/page-<slug>.json` → page key. Files are named by slug;
 * when the slug is in the current sitemap the canonical page path is used
 * (e.g. `terms` → `legal/terms`) so disk findings de-duplicate against the
 * artifact findings of the same page.
 */
function pageLabelFromPath(relPath: string, pagePathBySlug: Map<string, string>): string {
  const slug = relPath
    .slice(COMPOSITIONS_PREFIX.length)
    .replace(/^page-/, "")
    .replace(/\.json$/, "");
  return pagePathBySlug.get(slug) ?? slug;
}

/**
 * Validates CMS bindings against the NEW collections, per page/artifact
 * (keyed), via the SHARED `validateCompositionBindings` helper (§10.2):
 *
 * 1. The APPROVED per-page `page.composition` artifacts (`input.compositions`,
 *    keyed by page path) — the Studio's live truth.
 * 2. The on-disk composition files (human-owned, possibly hand-edited) — both
 *    the current Puck-Data shape and the legacy 1.0 `{ slug, sections }`
 *    shape are accepted; unreadable files become `composition-unreadable`.
 *
 * Identical findings from both sources are de-duplicated. Conflicts are
 * descriptive data; nothing is ever modified (§18.2).
 */
function validateBindings(
  input: GeneratorInput,
  repoDir: string,
  manifest: OwnershipManifest,
): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const key of Object.keys(input.compositions).sort()) {
    conflicts.push(...validateCompositionBindings(input.compositions[key], input.collections, key));
  }

  const pagePathBySlug = new Map(
    flattenSitemap(input.sitemap.pages).map((page) => [page.slug, page.pagePath]),
  );
  const compositionPaths = Object.entries(manifest.files)
    .filter(([p, entry]) => entry.owner === "human" && p.startsWith(COMPOSITIONS_PREFIX))
    .map(([p]) => p)
    .sort();

  for (const relPath of compositionPaths) {
    const abs = join(repoDir, relPath);
    if (!existsSync(abs)) continue;

    let composition = null;
    try {
      composition = parseAnyComposition(JSON.parse(readFileSync(abs, "utf8")));
    } catch {
      composition = null;
    }
    if (!composition) {
      conflicts.push({
        kind: "composition-unreadable",
        path: relPath,
        message: `No se pudo validar \`${relPath}\` como composición de página; revisión manual requerida.`,
      });
      continue;
    }
    conflicts.push(
      ...validateCompositionBindings(
        composition,
        input.collections,
        pageLabelFromPath(relPath, pagePathBySlug),
      ),
    );
  }

  // De-duplicate (an approved composition is also scaffolded on disk).
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = JSON.stringify([
      conflict.kind,
      "path" in conflict ? conflict.path : "",
      "page" in conflict ? [conflict.page, conflict.sectionId, conflict.prop, conflict.collection] : "",
      "field" in conflict ? conflict.field : "",
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
