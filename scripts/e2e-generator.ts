/**
 * End-to-end drill of the Generator over the DEMO project (§7.3, §18.2).
 *
 * Prerequisites: `npm run db:migrate && npm run db:seed` (the seed leaves the
 * demo project "Sitio Corporativo Acme" with the three required artifacts
 * approved). Run with: `npx tsx scripts/e2e-generator.ts`.
 *
 * What it does, in order (same service calls the UI buttons make):
 *  1. generateProject  → git repo in `.data/projects/<projectId>/` with the
 *     codegen rendered from the REAL approved artifacts (status success).
 *  2. Conflict drill: hand-edits a codegen file + approves a cms.collections
 *     v2 that removes the bound field `case-studies.summary` → regenerate →
 *     status `conflicts` with `human-edit-in-codegen-zone` AND
 *     `binding-missing-field` reported as data (the Generator screen reads
 *     them from the `generations` table).
 *  3. Resolution: reverts the hand edit (git checkout) + approves v3 (= v1)
 *     → regenerate → status `success`. The LAST history entry is a success,
 *     so the demo ends in a clean state.
 *
 * Re-runnable: if the demo repo already exists it is recreated from scratch
 * (the platform DB keeps the previous generation history — it is append-only
 * by design). The hand edit is the script's own and is always reverted.
 *
 * It never runs `npm install`/`npm run dev` in the generated project: that is
 * the user's step (see README — Generator).
 */
import { execFileSync } from "node:child_process";
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
import { artifactVersions, projects, users, workspaces } from "../src/db/schema";
import {
  approve,
  getProjectArtifacts,
  saveDraft,
  submitForReview,
  type HumanActor,
} from "../src/modules/artifacts/service";
import type { CmsCollectionsPayload } from "../src/modules/artifacts/types/cms-collections";
import { formatConflict } from "../src/modules/generator/conflicts";
import { gitLog } from "../src/modules/generator/git";
import { MANIFEST_FILENAME } from "../src/modules/generator/ownership";
import { getProjectRepoDir } from "../src/modules/generator/paths";
import {
  generateProject,
  getGenerations,
  regenerateProject,
} from "../src/modules/generator/service";

// Demo identities — must match scripts/seed.ts (not imported: seed.ts runs
// its main() at module load).
const DEMO_EMAIL = "demo@agency.local";
const DEMO_WORKSPACE_SLUG = "demo";
const DEMO_PROJECT_NAME = "Sitio Corporativo Acme";

/** Codegen file the drill edits by hand (must exist in the demo collections). */
const HAND_EDITED_FILE = "src/collections/job-openings.ts";
/** Bound field removed in v2 → `binding-missing-field` (seeded composition). */
const BOUND_COLLECTION = "case-studies";
const BOUND_FIELD = "summary";

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

  if (existsSync(repoDir)) {
    console.log("(el repo demo ya existía; se recrea desde cero)\n");
    rmSync(repoDir, { recursive: true, force: true });
  }

  // --- 1. generateProject ----------------------------------------------------
  console.log("# 1. generateProject — artefactos aprobados reales → repo git");
  const gen = await timed("generate", () => generateProject(projectId, actor));
  assert(gen.generation.status === "success", "generación inicial con status=success");
  assert(gen.summary.commit != null, "commit inicial creado");
  const mustExist = [
    "package.json",
    "site.config.ts",
    "src/generated/tokens.css",
    "src/generated/navigation.ts",
    "src/collections/case-studies.ts",
    "src/collections/job-openings.ts",
    "src/collections/testimonials.ts",
    "src/collections/index.ts",
    "src/seed/content.json",
    "src/compositions/page-servicios.json",
    MANIFEST_FILENAME,
  ];
  assert(
    mustExist.every((p) => existsSync(path.join(repoDir, p))),
    "archivos codegen + manifest presentes en el repo",
  );
  const pkg = JSON.parse(readFileSync(path.join(repoDir, "package.json"), "utf8")) as {
    name: string;
  };
  assert(pkg.name === "sitio-corporativo-acme", "package.json#name = slug del proyecto");
  const seedJson = JSON.parse(
    readFileSync(path.join(repoDir, "src/seed/content.json"), "utf8"),
  ) as { collections: Record<string, unknown[]>; pages: { path: string }[] };
  assert(
    Object.keys(seedJson.collections).length === 3 && seedJson.pages.length === 6,
    "content.json: 3 colecciones con fixtures + 6 páginas compuestas",
  );
  const log1 = await gitLog(repoDir);
  assert(log1.length === 1 && log1[0].includes("generate: initial project"), "git log: commit inicial descriptivo");

  // --- 2. Conflict drill ------------------------------------------------------
  console.log("\n# 2. Edición humana en zona codegen + cms.collections v2 (campo bindeado eliminado)");
  const editedPath = path.join(repoDir, HAND_EDITED_FILE);
  writeFileSync(editedPath, readFileSync(editedPath, "utf8") + "\n// hack manual fuera de la plataforma\n");

  const artifacts = await getProjectArtifacts(projectId);
  const collectionsArt = artifacts.find((a) => a.artifact.type === "cms.collections");
  if (!collectionsArt) throw new Error("El proyecto demo no tiene artefacto cms.collections.");
  const sealedRows = await db
    .select({ payload: artifactVersions.payload })
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifactId, collectionsArt.artifact.id),
        eq(artifactVersions.version, collectionsArt.artifact.currentVersion),
      ),
    )
    .limit(1);
  const v1 = sealedRows[0]?.payload as CmsCollectionsPayload;
  const v2: CmsCollectionsPayload = {
    collections: v1.collections.map((collection) =>
      collection.slug === BOUND_COLLECTION
        ? {
            ...collection,
            fields: [
              ...collection.fields.filter((field) => field.name !== BOUND_FIELD),
              {
                name: "excerpt",
                label: "Extracto",
                type: "richText",
                required: false,
                hasMany: false,
              },
            ],
          }
        : collection,
    ),
  };
  await saveDraft(collectionsArt.artifact.id, v2, actor);
  await submitForReview(collectionsArt.artifact.id, actor);
  await approve(
    collectionsArt.artifact.id,
    actor,
    "v2: «summary» se sustituye por «excerpt» en casos de éxito.",
  );
  console.log("  cms.collections v2 aprobada (summary eliminado, excerpt añadido).");

  const regen1 = await timed("regenerate (conflictos)", () => regenerateProject(projectId, actor));
  assert(regen1.generation.status === "conflicts", "regeneración con status=conflicts");
  console.log("  Conflictos reportados (los mismos que pinta la pantalla Generator):");
  for (const conflict of regen1.summary.conflicts) {
    console.log(`    - ${formatConflict(conflict)}`);
  }
  const handEdit = regen1.summary.conflicts.find((c) => c.kind === "human-edit-in-codegen-zone");
  assert(
    handEdit != null && "path" in handEdit && handEdit.path === HAND_EDITED_FILE,
    "conflicto human-edit-in-codegen-zone sobre el archivo editado a mano",
  );
  assert(
    readFileSync(editedPath, "utf8").includes("hack manual"),
    "el archivo editado a mano queda intacto (no se sobrescribe)",
  );
  const bindingConflict = regen1.summary.conflicts.find((c) => c.kind === "binding-missing-field");
  assert(
    bindingConflict != null &&
      bindingConflict.kind === "binding-missing-field" &&
      bindingConflict.page === "servicios" &&
      bindingConflict.sectionId === "caso-destacado" &&
      bindingConflict.prop === "body" &&
      bindingConflict.collection === BOUND_COLLECTION &&
      bindingConflict.field === BOUND_FIELD,
    "conflicto binding-missing-field descriptivo (página/sección/prop/colección/campo)",
  );
  const caseStudiesTs = readFileSync(path.join(repoDir, "src/collections/case-studies.ts"), "utf8");
  assert(
    caseStudiesTs.includes("excerpt") && !caseStudiesTs.includes(`"${BOUND_FIELD}"`),
    "case-studies.ts (prístino) sí se reescribió a v2",
  );

  // --- 3. Resolution → clean final state --------------------------------------
  console.log("\n# 3. Resolución: revertir el hack + aprobar v3 (= v1) → regenerar");
  execFileSync("git", ["checkout", "--", HAND_EDITED_FILE], { cwd: repoDir });
  await saveDraft(collectionsArt.artifact.id, v1, actor);
  await submitForReview(collectionsArt.artifact.id, actor);
  await approve(
    collectionsArt.artifact.id,
    actor,
    "v3: se restaura «summary» (el binding de «Servicios» lo usa).",
  );
  const regen2 = await timed("regenerate (resolución)", () => regenerateProject(projectId, actor));
  assert(regen2.generation.status === "success", "regeneración final con status=success");
  assert(regen2.summary.conflicts.length === 0, "sin conflictos tras la resolución");

  const history = await getGenerations(projectId);
  assert(
    history[0]?.generation.status === "success",
    "la última entrada del historial es success (estado limpio para la demo)",
  );
  const log3 = await gitLog(repoDir);
  console.log("\nHistorial git del proyecto generado:");
  for (const line of log3) console.log(`  ${line}`);
  console.log(`\nHistorial de generaciones (tabla generations): ${history.length} entradas`);
  for (const { generation } of [...history].reverse()) {
    console.log(`  ${generation.id}  ${generation.kind.padEnd(10)} ${generation.status}`);
  }

  console.log(`\nE2E OK — ${passed} asserts superados.`);
  console.log("\nPara correr el proyecto generado (pasos del usuario, no de la plataforma):");
  console.log(`  cd ${path.relative(root, repoDir)}`);
  console.log("  npm install && npm run generate:types && npm run seed && npm run dev");
  console.log("  → http://localhost:4000  (admin: /admin, editor: /edit)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nE2E FAILED:", error);
    process.exit(1);
  });
