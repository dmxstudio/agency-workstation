import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  pageCompositionItemSchema,
  specArtifactsSchema,
  type CmsCollectionsPayload,
  type SpecArtifacts,
} from "./schemas";
import {
  MANIFEST_FILENAME,
  parseManifest,
  serializeManifest,
  sha256,
  type OwnershipManifest,
} from "./ownership";
import type { Conflict } from "./conflicts";
import { renderCodegenFiles, renderHumanScaffolds } from "./render";

export interface RegenerateResult {
  /** Codegen files rewritten because the spec changed them. */
  written: string[];
  /** Files created for the first time (new collections/routes/scaffolds). */
  created: string[];
  /** Codegen files whose generated content is identical — untouched. */
  unchanged: string[];
  /** Human-owned files present on disk — never read for diffing, never written. */
  preservedHuman: string[];
  /** Codegen files no longer produced by the spec, deleted (only if pristine). */
  deletedOrphans: string[];
  /** Conflicts reported, never auto-resolved (§18.2). */
  conflicts: Conflict[];
}

/**
 * Partial regeneration (§18.2):
 *  (a) rewrites ONLY codegen-owned files;
 *  (b) a hash mismatch on a codegen file = human edit → conflict, file untouched;
 *  (c) human-owned files (compositions) are never written;
 *  (d) bindings in current (possibly human-edited) compositions are validated
 *      against the NEW collections — a removed field still bound is a
 *      descriptive conflict (page, section, prop, field) and the page is NOT modified;
 *  (e) idempotent: same spec twice → zero diffs (deterministic rendering + hashes).
 */
export function regenerate(rawSpec: unknown, outDir: string): RegenerateResult {
  const spec: SpecArtifacts = specArtifactsSchema.parse(rawSpec);

  const manifestPath = join(outDir, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    throw new Error(`No hay manifest de ownership en \`${outDir}\`; genera primero.`);
  }
  const manifest: OwnershipManifest = parseManifest(readFileSync(manifestPath, "utf8"));

  const result: RegenerateResult = {
    written: [],
    created: [],
    unchanged: [],
    preservedHuman: [],
    deletedOrphans: [],
    conflicts: [],
  };

  // -------------------------------------------------------------------------
  // 1. Codegen-owned files: rewrite only pristine ones; conflicts otherwise.
  // -------------------------------------------------------------------------
  const desired = renderCodegenFiles(spec);

  for (const [relPath, content] of desired) {
    const abs = join(outDir, relPath);
    const entry = manifest.files[relPath];
    const desiredHash = sha256(content);

    if (!entry) {
      // New codegen file (e.g. new collection or new route).
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
      manifest.files[relPath] = { owner: "codegen", contentHash: desiredHash };
      result.created.push(relPath);
      continue;
    }

    if (entry.owner !== "codegen") {
      // Defensive: a path claimed by humans is never written by codegen.
      result.preservedHuman.push(relPath);
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
      result.unchanged.push(relPath);
      continue;
    }

    writeFileSync(abs, content, "utf8");
    manifest.files[relPath] = { owner: "codegen", contentHash: desiredHash };
    result.written.push(relPath);
  }

  // -------------------------------------------------------------------------
  // 2. Orphaned codegen files (spec no longer produces them): delete only if
  //    pristine; a modified orphan is a conflict, never silently removed.
  // -------------------------------------------------------------------------
  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (entry.owner !== "codegen" || desired.has(relPath)) continue;
    const abs = join(outDir, relPath);
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

  // -------------------------------------------------------------------------
  // 3. Human-owned files: never written. Only brand-new pages get a scaffold.
  // -------------------------------------------------------------------------
  const scaffolds = renderHumanScaffolds(spec);
  for (const [relPath, content] of scaffolds) {
    const abs = join(outDir, relPath);
    const entry = manifest.files[relPath];
    if (entry || existsSync(abs)) {
      // Existing human file: preserved verbatim, whatever the new spec says.
      result.preservedHuman.push(relPath);
      if (!entry) manifest.files[relPath] = { owner: "human", contentHash: null };
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    manifest.files[relPath] = { owner: "human", contentHash: null };
    result.created.push(relPath);
  }
  // Human files for pages no longer in the spec: kept, still human-owned.
  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (entry.owner === "human" && !scaffolds.has(relPath) && existsSync(join(outDir, relPath))) {
      result.preservedHuman.push(relPath);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Binding validation: current compositions (as edited by humans, read
  //    from disk) against the NEW collections. Conflicts are descriptive and
  //    the composition files are NOT modified.
  // -------------------------------------------------------------------------
  result.conflicts.push(
    ...validateBindings(outDir, manifest, spec.collections),
  );

  writeFileSync(manifestPath, serializeManifest(manifest), "utf8");

  result.written.sort();
  result.created.sort();
  result.unchanged.sort();
  result.preservedHuman = [...new Set(result.preservedHuman)].sort();
  result.deletedOrphans.sort();
  return result;
}

function validateBindings(
  outDir: string,
  manifest: OwnershipManifest,
  collections: CmsCollectionsPayload,
): Conflict[] {
  const conflicts: Conflict[] = [];
  const fieldsByCollection = new Map<string, Set<string>>(
    collections.collections.map((c) => [c.slug, new Set(c.fields.map((f) => f.name))]),
  );

  const compositionPaths = Object.entries(manifest.files)
    .filter(([path, entry]) => entry.owner === "human" && path.startsWith("compositions/"))
    .map(([path]) => path)
    .sort();

  for (const relPath of compositionPaths) {
    const abs = join(outDir, relPath);
    if (!existsSync(abs)) continue;

    let item;
    try {
      item = pageCompositionItemSchema.parse(JSON.parse(readFileSync(abs, "utf8")));
    } catch {
      conflicts.push({
        kind: "composition-unreadable",
        path: relPath,
        message: `No se pudo validar \`${relPath}\` como composición de página; revisión manual requerida.`,
      });
      continue;
    }

    for (const section of item.sections) {
      for (const [prop, binding] of Object.entries(section.bindings)) {
        const dot = binding.indexOf(".");
        const collectionSlug = dot === -1 ? binding : binding.slice(0, dot);
        const fieldName = dot === -1 ? "" : binding.slice(dot + 1);
        const fields = fieldsByCollection.get(collectionSlug);

        if (!fields) {
          conflicts.push({
            kind: "binding-missing-collection",
            page: item.slug,
            sectionId: section.id,
            prop,
            binding,
            collection: collectionSlug,
            message: `La página \`${item.slug}\`, sección \`${section.id}\`, prop \`${prop}\` está bindeada a \`${binding}\`, pero la colección \`${collectionSlug}\` ya no existe en la spec. La página no se modifica; resuelve el binding o restaura la colección.`,
          });
          continue;
        }
        if (!fields.has(fieldName)) {
          conflicts.push({
            kind: "binding-missing-field",
            page: item.slug,
            sectionId: section.id,
            prop,
            binding,
            collection: collectionSlug,
            field: fieldName,
            message: `La página \`${item.slug}\`, sección \`${section.id}\`, prop \`${prop}\` está bindeada a \`${binding}\`, pero el campo \`${fieldName}\` fue eliminado de la colección \`${collectionSlug}\`. La página no se modifica; resuelve el binding o restaura el campo.`,
          });
        }
      }
    }
  }
  return conflicts;
}
