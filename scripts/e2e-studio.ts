/**
 * End-to-end drill of the Visual Studio step (§7.4, §11.2, §13): from a
 * composition edit to the change being SERVED by the generated site.
 *
 * Prerequisites: `npm run db:migrate && npm run db:seed` (demo project
 * "Sitio Corporativo Acme": `page.composition[inicio|servicios]` approved v1,
 * `nosotros` in draft). Run with: `npx tsx scripts/e2e-studio.ts`.
 *
 * What it does, in order:
 *  1. RENDER-COMPAT CONTRACT (static): the Studio registry mirrors the
 *     template registry — verbatim section sources, same component set.
 *  2. STUDIO CYCLE on `page.composition[servicios]` via the SAME artifact
 *     services the editor's server actions call: builds a new `Stats` section
 *     from the STUDIO registry's defaultProps (what dragging the component
 *     into the canvas produces) → `saveDraft` → `computeDiff` shows the
 *     section as `added` (aligned by stable `props.id`, §8.3) →
 *     `submitForReview` → `approve` seals the next immutable version.
 *  3. GENERATION: recreates the demo repo (`generateProject`) — the
 *     composition scaffold AND the seed fixtures carry the new section — and
 *     `regenerateProject` right after is a no-op (idempotency §18.2).
 *  4. RENDER-COMPAT CONTRACT (dynamic): introspects the TEMPLATE's Puck
 *     config inside the generated repo (its own node_modules + tsconfig) and
 *     compares it against the Studio's `createPuckConfig`: same components,
 *     categories, field keys/types and defaultProps — modulo the documented
 *     divergences (CMS binding field `external`→`custom`; Navbar/Footer
 *     defaults sourced from codegen vs. approved sitemap).
 *  5. THE SITE RUNS: clones node_modules from the template (APFS clonefile,
 *     fallback plain copy), `npm run generate:types` + `npm run seed` +
 *     `npm run build` inside the generated repo, `next start` on a scratch
 *     port, and asserts `/servicios` serves the NEW section plus the CMS-bound
 *     testimonial, and `/` serves the approved home composition. The server is
 *     killed immediately after (no long-running processes).
 *
 * Re-runnable: each run seals one more `page.composition[servicios]` version
 * (immutable history is append-only by design); the injected e2e section gets
 * a version-suffixed id so the diff always shows a clean `added`. The demo
 * repo is recreated from scratch.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { artifactVersions, projects, users, workspaces, type Artifact } from "../src/db/schema";
import {
  approve,
  computeDiff,
  getPhaseGates,
  getProjectArtifacts,
  reject,
  saveDraft,
  submitForReview,
  type HumanActor,
} from "../src/modules/artifacts/service";
import type { CmsCollectionsPayload } from "../src/modules/artifacts/types/cms-collections";
import {
  pageCompositionPayloadSchema,
  type PageCompositionPayload,
} from "../src/modules/artifacts/types/page-composition";
import type { SpecSitemapPayload } from "../src/modules/artifacts/types/spec-sitemap";
import { compositionFilePath } from "../src/modules/generator/render";
import { getProjectRepoDir, getTemplateDir } from "../src/modules/generator/paths";
import { generateProject, regenerateProject } from "../src/modules/generator/service";
import { createPuckConfig } from "../src/modules/studio/registry";
import { buildStudioNavDefaults } from "../src/modules/studio/editor/nav-defaults";

// Demo identities — must match scripts/seed.ts (not imported: seed.ts runs
// its main() at module load).
const DEMO_EMAIL = "demo@agency.local";
const DEMO_WORKSPACE_SLUG = "demo";
const DEMO_PROJECT_NAME = "Sitio Corporativo Acme";

const PAGE_KEY = "servicios";
/** Version-suffixed per run so the diff is always a clean `added`. */
const E2E_BLOCK_ID_PREFIX = "Stats-servicios-e2e";
/** Unique marker the final curl asserts on the served page. */
const E2E_STAT_LABEL = "repuestos originales en stock";
const SITE_PORT = 4123;

let passed = 0;
function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`ASSERT FAIL: ${label}`);
  passed += 1;
  console.log(`  ok - ${label}`);
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  console.log(`  (${label}: ${Math.round(performance.now() - start)} ms)`);
  return result;
}

/** JSON stringify with recursively sorted object keys (order-insensitive). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const body = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

// ---------------------------------------------------------------------------
// 1. Render-compat contract — static: the Studio registry mirrors the template
// ---------------------------------------------------------------------------

/** Sources copied verbatim from the template (modulo comments/blank lines). */
const VERBATIM_REGISTRY_FILES = [
  "primitives.tsx",
  "sections/structure.tsx",
  "sections/heroes.tsx",
  "sections/content.tsx",
  "sections/marketing.tsx",
];

/** Comments don't affect render compat; code must match byte for byte. */
function normalizeSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, "").trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
}

function assertVerbatimRegistry(): void {
  for (const file of VERBATIM_REGISTRY_FILES) {
    const studio = readFileSync(
      path.join(root, "src/modules/studio/registry", file),
      "utf8",
    );
    const template = readFileSync(
      path.join(getTemplateDir(), "src/puck", file),
      "utf8",
    );
    assert(
      normalizeSource(studio) === normalizeSource(template),
      `registry verbatim — ${file} idéntico al template (módulo comentarios)`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Render-compat contract — dynamic: template config vs Studio config
// ---------------------------------------------------------------------------

interface ConfigSnapshot {
  components: Record<string, { fields: Record<string, string | null>; defaultProps: unknown }>;
  categories: unknown;
  rootFields: string[];
  rootDefaultProps: unknown;
}

/**
 * Temp script executed INSIDE the generated repo (its node_modules + tsconfig
 * paths resolve `@site-config`/`@/generated/*`), printing the template's Puck
 * config as data. Written and deleted by this drill.
 */
const INTROSPECT_FILENAME = ".e2e-studio-introspect.mts";
const INTROSPECT_SOURCE = `// Temp file written by scripts/e2e-studio.ts (platform). Safe to delete.
import { puckConfig } from "./src/puck/config";

type AnyComponent = { fields?: Record<string, { type?: string }>; defaultProps?: unknown };
const components: Record<string, unknown> = {};
for (const [name, config] of Object.entries(puckConfig.components as Record<string, AnyComponent>)) {
  components[name] = {
    fields: Object.fromEntries(
      Object.entries(config.fields ?? {}).map(([key, field]) => [key, field?.type ?? null]),
    ),
    defaultProps: config.defaultProps ?? null,
  };
}
console.log(
  JSON.stringify({
    components,
    categories: puckConfig.categories ?? null,
    rootFields: Object.keys(puckConfig.root?.fields ?? {}).sort(),
    rootDefaultProps: puckConfig.root?.defaultProps ?? null,
  }),
);
`;

function snapshotTemplateConfig(repoDir: string): ConfigSnapshot {
  const scriptPath = path.join(repoDir, INTROSPECT_FILENAME);
  writeFileSync(scriptPath, INTROSPECT_SOURCE, "utf8");
  try {
    const stdout = execFileSync(path.join(root, "node_modules/.bin/tsx"), [INTROSPECT_FILENAME], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout) as ConfigSnapshot;
  } finally {
    rmSync(scriptPath, { force: true });
  }
}

function snapshotStudioConfig(
  cmsCollections: CmsCollectionsPayload,
  sitemap: SpecSitemapPayload,
): ConfigSnapshot {
  const config = createPuckConfig({
    cmsCollections,
    nav: buildStudioNavDefaults(DEMO_PROJECT_NAME, sitemap),
  });
  const components: ConfigSnapshot["components"] = {};
  for (const [name, component] of Object.entries(config.components)) {
    const typed = component as { fields?: Record<string, { type?: string }>; defaultProps?: unknown };
    components[name] = {
      fields: Object.fromEntries(
        Object.entries(typed.fields ?? {}).map(([key, field]) => [key, field?.type ?? null]),
      ),
      defaultProps: typed.defaultProps ?? null,
    };
  }
  return {
    components,
    categories: config.categories ?? null,
    rootFields: Object.keys(config.root?.fields ?? {}).sort(),
    rootDefaultProps: (config.root as { defaultProps?: unknown })?.defaultProps ?? null,
  };
}

/**
 * Documented divergences (src/modules/studio/registry/README.md): everything
 * else must be IDENTICAL — the template is the source of truth of the shape.
 *
 * - CMS binding props use Puck's `external` field in the template and the
 *   platform's schema-driven `custom` field in the Studio (same stored shape).
 * - Navbar/Footer defaultProps come from `site.config.ts` + codegen in the
 *   template and from the approved sitemap in the Studio. They only affect
 *   NEW insertions; the sitemap-derived parts (brand/links/columns/legal)
 *   must still match the codegen exactly.
 */
const BINDING_FIELD_DIVERGENCE = new Set([
  "TestimonialQuote.testimonial",
  "TestimonialWall.items",
  "PostFeature.post",
  "BlogPosts.items",
]);
const NAV_DEFAULT_EXCLUSIONS: Record<string, Set<string>> = {
  Navbar: new Set(["ctaLabel", "ctaHref"]),
  Footer: new Set(["tagline"]),
};

function omitKeys(value: unknown, keys: Set<string>): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([key]) => !keys.has(key)),
  );
}

function assertConfigCompat(template: ConfigSnapshot, studio: ConfigSnapshot): void {
  const templateNames = Object.keys(template.components).sort();
  const studioNames = Object.keys(studio.components).sort();
  assert(
    templateNames.length === 34 && stableStringify(templateNames) === stableStringify(studioNames),
    `mismos ${templateNames.length} componentes Puck en template y Studio`,
  );
  assert(
    stableStringify(template.categories) === stableStringify(studio.categories),
    "mismas categorías (títulos y asignación de componentes)",
  );
  assert(
    stableStringify(template.rootFields) === stableStringify(studio.rootFields) &&
      stableStringify(template.rootDefaultProps) === stableStringify(studio.rootDefaultProps),
    "mismo root (fields + defaultProps de título/descripción SEO)",
  );

  const fieldTypeDrift: string[] = [];
  const defaultPropsDrift: string[] = [];
  for (const name of templateNames) {
    const templateComponent = template.components[name];
    const studioComponent = studio.components[name];
    const templateFieldKeys = Object.keys(templateComponent.fields).sort();
    const studioFieldKeys = Object.keys(studioComponent.fields).sort();
    if (stableStringify(templateFieldKeys) !== stableStringify(studioFieldKeys)) {
      fieldTypeDrift.push(`${name}: claves de fields distintas`);
      continue;
    }
    for (const key of templateFieldKeys) {
      const templateType = templateComponent.fields[key];
      const studioType = studioComponent.fields[key];
      if (templateType === studioType) continue;
      if (
        BINDING_FIELD_DIVERGENCE.has(`${name}.${key}`) &&
        ((templateType === "external" && studioType === "custom") ||
          (templateType === "array" && studioType === "array"))
      ) {
        continue;
      }
      fieldTypeDrift.push(`${name}.${key}: ${templateType} ≠ ${studioType}`);
    }

    const exclusions = NAV_DEFAULT_EXCLUSIONS[name] ?? new Set<string>();
    const templateDefaults = omitKeys(templateComponent.defaultProps, exclusions);
    const studioDefaults = omitKeys(studioComponent.defaultProps, exclusions);
    if (stableStringify(templateDefaults) !== stableStringify(studioDefaults)) {
      defaultPropsDrift.push(name);
    }
  }
  if (fieldTypeDrift.length > 0) {
    console.log(`  drift de fields: ${fieldTypeDrift.join(" | ")}`);
  }
  assert(fieldTypeDrift.length === 0, "fields por componente: mismas claves y tipos (módulo external→custom)");
  if (defaultPropsDrift.length > 0) {
    console.log(`  drift de defaultProps: ${defaultPropsDrift.join(", ")}`);
  }
  assert(
    defaultPropsDrift.length === 0,
    "defaultProps idénticos (Navbar/Footer derivados del sitemap = codegen, módulo divergencias documentadas)",
  );
}

// ---------------------------------------------------------------------------
// 5. The generated site runs and serves the change
// ---------------------------------------------------------------------------

function cloneNodeModules(repoDir: string): void {
  const source = path.join(getTemplateDir(), "node_modules");
  const target = path.join(repoDir, "node_modules");
  if (!existsSync(source)) {
    throw new Error(
      "El template no tiene node_modules; ejecuta `npm install` en templates/project-base primero.",
    );
  }
  rmSync(target, { recursive: true, force: true });
  try {
    // APFS clonefile: copy-on-write, takes ~1s for 700+ MB.
    execFileSync("cp", ["-cR", source, target], { stdio: "ignore" });
  } catch {
    execFileSync("cp", ["-R", source, target], { stdio: "ignore" });
  }
}

function runInRepo(repoDir: string, label: string, command: string, args: string[]): void {
  const start = performance.now();
  // NODE_ENV must not leak into the generated project (next build sets its own).
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete (env as Record<string, string | undefined>).NODE_ENV;
  execFileSync(command, args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  console.log(`  (${label}: ${Math.round(performance.now() - start)} ms)`);
}

async function fetchOk(url: string, timeoutMs = 2000): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function withSiteServer<T>(
  repoDir: string,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const baseUrl = `http://127.0.0.1:${SITE_PORT}`;
  if ((await fetchOk(`${baseUrl}/`, 500)) != null) {
    throw new Error(
      `El puerto ${SITE_PORT} ya está en uso; libéralo antes de correr el e2e del Studio.`,
    );
  }

  let child: ChildProcess | null = null;
  try {
    child = spawn(path.join(repoDir, "node_modules/.bin/next"), ["start", "-p", String(SITE_PORT)], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if ((await fetchOk(`${baseUrl}/`, 1500)) != null) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("El sitio generado no respondió en 60 s (next start).");

    return await fn(baseUrl);
  } finally {
    if (child?.pid != null) {
      // next start may fork the actual server: kill the whole process group.
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers over the demo DB
// ---------------------------------------------------------------------------

async function loadSealedPayload(artifact: Artifact): Promise<PageCompositionPayload> {
  const db = getDb();
  const rows = await db
    .select({ payload: artifactVersions.payload })
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifactId, artifact.id),
        eq(artifactVersions.version, artifact.currentVersion),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error(`No existe la versión sellada v${artifact.currentVersion} de ${artifact.id}.`);
  }
  return pageCompositionPayloadSchema.parse(rows[0].payload);
}

async function loadApprovedSingleton<T>(projectId: string, type: string): Promise<T> {
  const db = getDb();
  const items = await getProjectArtifacts(projectId);
  const item = items.find((entry) => entry.artifact.type === type && entry.artifact.key == null);
  if (!item || item.artifact.currentVersion === 0) {
    throw new Error(`El proyecto demo no tiene «${type}» aprobado; ejecuta npm run db:seed.`);
  }
  const rows = await db
    .select({ payload: artifactVersions.payload })
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifactId, item.artifact.id),
        eq(artifactVersions.version, item.artifact.currentVersion),
      ),
    )
    .limit(1);
  return rows[0]?.payload as T;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = getDb();

  // --- Resolve the demo project (created by npm run db:seed) ----------------
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, DEMO_EMAIL), isNull(users.deletedAt)))
    .limit(1);
  const wsRows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.slug, DEMO_WORKSPACE_SLUG), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!userRows[0] || !wsRows[0]) {
    throw new Error("No existe el workspace demo. Ejecuta antes: npm run db:migrate && npm run db:seed");
  }
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, wsRows[0].id),
        eq(projects.name, DEMO_PROJECT_NAME),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (!projectRows[0]) {
    throw new Error(`No existe el proyecto demo "${DEMO_PROJECT_NAME}". Ejecuta npm run db:seed.`);
  }
  const projectId = projectRows[0].id;
  const actor: HumanActor = { id: userRows[0].id, role: "admin", workspaceId: wsRows[0].id };
  const repoDir = getProjectRepoDir(projectId);
  console.log(`Proyecto demo: ${projectId}\nRepo: ${repoDir}\n`);

  // --- 1. Render-compat (static) --------------------------------------------
  console.log("# 1. Contrato de compatibilidad — fuentes verbatim del registry");
  assertVerbatimRegistry();

  // --- 2. Studio cycle over page.composition[servicios] ----------------------
  console.log("\n# 2. Ciclo Studio: sección nueva → diff → aprobación (ciclo §13)");
  const artifacts = await getProjectArtifacts(projectId);
  const servicios = artifacts.find(
    (item) => item.artifact.type === "page.composition" && item.artifact.key === PAGE_KEY,
  );
  if (!servicios) {
    throw new Error(`No existe page.composition[${PAGE_KEY}]; ejecuta npm run db:seed.`);
  }
  if (servicios.artifact.status === "in_review") {
    // Leftover of an interrupted run: a rejection returns it to draft (§8.2).
    await reject(servicios.artifact.id, "Reset del drill e2e del Studio.", actor);
  }
  if (servicios.artifact.currentVersion === 0) {
    throw new Error("page.composition[servicios] no tiene versión aprobada; ejecuta npm run db:seed.");
  }

  const prevVersion = servicios.artifact.currentVersion;
  const sealed = await loadSealedPayload(servicios.artifact);
  const cmsCollections = await loadApprovedSingleton<CmsCollectionsPayload>(
    projectId,
    "cms.collections",
  );
  const sitemap = await loadApprovedSingleton<SpecSitemapPayload>(projectId, "spec.sitemap");

  // The new section EXACTLY as the Studio canvas would create it: the
  // defaultProps of the platform registry (drag&drop insertion), then the
  // human edits its fields.
  const studioConfig = createPuckConfig({
    cmsCollections,
    nav: buildStudioNavDefaults(DEMO_PROJECT_NAME, sitemap),
  });
  const statsDefaults = structuredClone(
    (studioConfig.components.Stats as { defaultProps?: Record<string, unknown> }).defaultProps,
  ) as Record<string, unknown>;
  const newBlockId = `${E2E_BLOCK_ID_PREFIX}-v${prevVersion + 1}`;
  const newBlock = {
    type: "Stats",
    props: {
      ...statsDefaults,
      id: newBlockId,
      title: "El servicio en cifras",
      stats: [
        { value: "1.200+", label: E2E_STAT_LABEL },
        { value: "24 h", label: "SLA de asistencia técnica" },
        { value: "40", label: "años fabricando en España" },
      ],
    },
  };

  const draft: PageCompositionPayload = {
    ...sealed,
    content: sealed.content.filter(
      (block) => !block.props.id.startsWith(E2E_BLOCK_ID_PREFIX),
    ),
  };
  const ctaIndex = draft.content.findIndex((block) => block.type === "Cta");
  draft.content.splice(ctaIndex === -1 ? draft.content.length : ctaIndex, 0, newBlock);

  const afterSave = await saveDraft(servicios.artifact.id, draft, actor);
  assert(afterSave.status === "draft", "saveDraft deja el artefacto en draft (propuesta de versión nueva)");

  const diff = await computeDiff(servicios.artifact.id);
  assert(
    diff.from.kind === "version" && diff.from.version === prevVersion && diff.to.kind === "draft",
    `computeDiff compara draft vs v${prevVersion} aprobada`,
  );
  const added = diff.changes.find(
    (change) => change.path === `content[id=${newBlockId}]` && change.type === "added",
  );
  assert(
    added != null &&
      (added.after as { type?: string } | undefined)?.type === "Stats",
    "el diff estructural muestra la sección nueva como `added` (alineada por props.id estable)",
  );

  await submitForReview(servicios.artifact.id, actor);
  const approval = await approve(
    servicios.artifact.id,
    actor,
    "Sección de métricas añadida desde el Visual Studio (drill e2e).",
  );
  assert(
    approval.version.version === prevVersion + 1 && approval.version.origin === "human",
    `approve sella v${prevVersion + 1} inmutable con origin=human`,
  );
  assert(
    approval.artifact.status === "approved" && approval.artifact.draftPayload == null,
    "el artefacto queda approved y el borrador promovido a la versión sellada",
  );

  const gates = await getPhaseGates(projectId);
  const compositionGate = gates.find((gate) => gate.phase === "composition");
  assert(
    compositionGate != null &&
      !compositionGate.closable &&
      compositionGate.pendingTypes.includes("page.composition"),
    "el gate de composición sigue bloqueado (quedan instancias sin aprobar) — el Cockpit cuenta multi-instancia",
  );

  // --- 3. Generation ----------------------------------------------------------
  console.log("\n# 3. Generación: el repo refleja la composición aprobada");
  if (existsSync(repoDir)) {
    console.log("(el repo demo ya existía; se recrea desde cero)");
    rmSync(repoDir, { recursive: true, force: true });
  }
  const gen = await timed("generateProject", () => generateProject(projectId, actor));
  assert(gen.generation.status === "success", "generación inicial con status=success");
  assert(
    gen.summary.compositionVersions?.[PAGE_KEY] === prevVersion + 1,
    `la generación consume page.composition[${PAGE_KEY}] v${prevVersion + 1}`,
  );

  const compositionFile = readFileSync(
    path.join(repoDir, compositionFilePath(PAGE_KEY)),
    "utf8",
  );
  assert(
    compositionFile.includes(newBlockId) && compositionFile.includes(E2E_STAT_LABEL),
    "src/compositions/page-servicios.json (scaffold) refleja la sección nueva",
  );
  const seedJson = JSON.parse(readFileSync(path.join(repoDir, "src/seed/content.json"), "utf8")) as {
    pages: { path: string; content: { type: string; props: { id: string } }[] }[];
  };
  const serviciosSeedPage = seedJson.pages.find((page) => page.path === PAGE_KEY);
  assert(
    serviciosSeedPage != null &&
      serviciosSeedPage.content.some((block) => block.props.id === newBlockId),
    "src/seed/content.json (fixtures) lleva la sección nueva en «servicios»",
  );

  const regen = await timed("regenerateProject (idempotencia)", () =>
    regenerateProject(projectId, actor),
  );
  assert(
    regen.generation.status === "success" &&
      regen.summary.written.length === 0 &&
      regen.summary.created.length === 0 &&
      regen.summary.deletedOrphans.length === 0 &&
      regen.summary.conflicts.length === 0 &&
      regen.summary.commit === null,
    "regenerar sin cambios de spec es un no-op (idempotencia §18.2; la composición es preserved)",
  );

  // --- 4. Render-compat (dynamic) ---------------------------------------------
  console.log("\n# 4. Contrato de compatibilidad — config del template vs Studio");
  await timed("clonar node_modules del template", async () => cloneNodeModules(repoDir));
  const templateSnapshot = snapshotTemplateConfig(repoDir);
  const studioSnapshot = snapshotStudioConfig(cmsCollections, sitemap);
  assertConfigCompat(templateSnapshot, studioSnapshot);

  // --- 5. The generated site runs and serves the change -----------------------
  console.log("\n# 5. El sitio generado corre: seed + build + next start + curl");
  runInRepo(repoDir, "npm run generate:types", "npm", ["run", "generate:types"]);
  runInRepo(repoDir, "npm run seed", "npm", ["run", "seed"]);
  runInRepo(repoDir, "npm run build", "npm", ["run", "build"]);
  assert(true, "npm run seed + npm run build en verde dentro del proyecto generado");

  await withSiteServer(repoDir, async (baseUrl) => {
    const serviciosHtml = await fetchOk(`${baseUrl}/servicios`, 15_000);
    assert(serviciosHtml != null, "GET /servicios responde 200");
    const html = serviciosHtml as string;
    assert(
      html.includes(E2E_STAT_LABEL) && html.includes("El servicio en cifras"),
      "/servicios contiene la sección nueva aprobada en el Studio",
    );
    assert(
      html.includes("Un único proveedor para toda la vida útil de su maquinaria"),
      "/servicios conserva el hero de la composición v1",
    );
    assert(
      html.includes("Contenido de ejemplo (1) para «Cita»"),
      "/servicios renderiza el testimonio bindeado al CMS ($seedRef resuelto por el seed del template)",
    );

    const homeHtml = await fetchOk(`${baseUrl}/`, 15_000);
    assert(
      homeHtml != null && homeHtml.includes("Maquinaria de envasado que no se detiene"),
      "GET / sirve la composición aprobada de «inicio» (artefacto por página)",
    );
  });
  console.log("  (servidor next start detenido)");

  console.log(`\nE2E STUDIO OK — ${passed} asserts superados.`);
  console.log(
    `page.composition[${PAGE_KEY}] quedó en v${prevVersion + 1}; cada ejecución sella una versión más (historial inmutable por diseño).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nE2E STUDIO FAILED:", error);
    process.exit(1);
  });
