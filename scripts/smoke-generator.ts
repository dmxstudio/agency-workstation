/**
 * Smoke test of the generator module against the local DB (§7.3, §18.2).
 *
 * Exercises the full cycle validated by the regen spike, now over the real
 * platform: project with APPROVED artifacts → generate (template copy +
 * codegen + manifest + git repo) → human edits a composition + hand-edits a
 * codegen file → new approved `cms.collections` version (field removed +
 * fields added) → regenerate → conflicts detected (`binding-missing-field`,
 * `human-edit-in-codegen-zone`), human files preserved byte-identical →
 * second regenerate is idempotent → conflict resolution by reverting the
 * hand edit unblocks only that file.
 *
 * Run with:  npm run db:migrate && npx tsx scripts/smoke-generator.ts
 *
 * Isolation: writes generated repos under `.data/smoke-generator/` (via
 * GENERATED_PROJECTS_DIR) and cleans up after itself. If the real template
 * (`templates/project-base`) does not exist yet, a mini-template fixture is
 * created and used via PROJECT_TEMPLATE_DIR (declared in the output).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

// Isolate generated output BEFORE importing the generator module (paths are
// resolved at call time, but being explicit keeps the smoke self-contained).
const SMOKE_DIR = path.join(root, ".data", "smoke-generator");
process.env.GENERATED_PROJECTS_DIR = path.join(SMOKE_DIR, "projects");

import { eq, inArray } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { newId } from "../src/db/ids";
import { auditLog, projects, users, workspaceMembers, workspaces } from "../src/db/schema";
import {
  approve,
  ensureProjectArtifacts,
  saveDraft,
  submitForReview,
  type HumanActor,
} from "../src/modules/artifacts/service";
import { GeneratorDomainError } from "../src/modules/generator/errors";
import { gitLog } from "../src/modules/generator/git";
import { parseManifest, sha256, MANIFEST_FILENAME } from "../src/modules/generator/ownership";
import { getProjectRepoDir } from "../src/modules/generator/paths";
import {
  generateProject,
  getGenerationRequirements,
  getGenerations,
  regenerateProject,
} from "../src/modules/generator/service";

let passed = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`ASSERT FAIL: ${label}`);
  }
  passed += 1;
  console.log(`  ok - ${label}`);
}

async function expectGeneratorError(
  fn: () => Promise<unknown>,
  code: string,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(
      error instanceof GeneratorDomainError && error.code === code,
      `${label} (code=${code})`,
    );
    return;
  }
  assert(false, label);
}

// ---------------------------------------------------------------------------
// Template: use the real one if present; otherwise a mini-template fixture
// ---------------------------------------------------------------------------

function ensureTemplate(): string {
  const realTemplate = path.join(root, "templates", "project-base");
  if (existsSync(path.join(realTemplate, "package.json"))) {
    console.log(`(template: real templates/project-base)`);
    return "real";
  }
  const fixture = path.join(SMOKE_DIR, "template-fixture");
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(path.join(fixture, "src", "app"), { recursive: true });
  // Excluded dirs must NOT be copied into generated repos:
  mkdirSync(path.join(fixture, "node_modules", "dummy"), { recursive: true });
  mkdirSync(path.join(fixture, ".next"), { recursive: true });
  writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ name: "project-base-fixture", private: true }, null, 2) + "\n",
  );
  writeFileSync(
    path.join(fixture, ".gitignore"),
    ["node_modules", ".next", ".data", ""].join("\n"),
  );
  writeFileSync(path.join(fixture, "README.md"), "# Mini-template fixture (smoke)\n");
  writeFileSync(
    path.join(fixture, "src", "app", "layout.tsx"),
    "export default function Layout() {\n  return null;\n}\n",
  );
  writeFileSync(path.join(fixture, "node_modules", "dummy", "x.js"), "// must not be copied\n");
  writeFileSync(path.join(fixture, ".next", "junk.txt"), "must not be copied\n");
  process.env.PROJECT_TEMPLATE_DIR = fixture;
  console.log(`(template: mini-template FIXTURE — templates/project-base not found)`);
  return "fixture";
}

// ---------------------------------------------------------------------------
// Artifact payloads (v1)
// ---------------------------------------------------------------------------

const sitemapV1 = {
  pages: [
    { title: "Inicio", slug: "home", children: [] },
    { title: "Blog", slug: "blog", children: [] },
    {
      title: "Legal",
      slug: "legal",
      children: [{ title: "Términos", slug: "terms", children: [] }],
    },
  ],
  navigation: { header: ["home", "blog"], footer: ["legal", "terms"] },
};

const collectionsV1 = {
  collections: [
    {
      slug: "posts",
      label: "Posts",
      fields: [
        { name: "title", label: "Título", type: "text", required: true },
        { name: "subtitle", label: "Subtítulo", type: "text", required: false },
        { name: "excerpt", label: "Extracto", type: "richText", required: false },
        {
          name: "author",
          label: "Autor",
          type: "relation",
          relationTo: "authors",
          hasMany: false,
          required: false,
        },
      ],
      timestamps: true,
    },
    {
      slug: "authors",
      label: "Autores",
      fields: [{ name: "name", label: "Nombre", type: "text", required: true }],
      timestamps: true,
    },
  ],
};

/** v2: posts loses `subtitle` (bound!), gains `heroImage`; authors gains `avatar`. */
const collectionsV2 = {
  collections: [
    {
      slug: "posts",
      label: "Posts",
      fields: [
        { name: "title", label: "Título", type: "text", required: true },
        { name: "heroImage", label: "Imagen de cabecera", type: "image", required: false },
        { name: "excerpt", label: "Extracto", type: "richText", required: false },
        {
          name: "author",
          label: "Autor",
          type: "relation",
          relationTo: "authors",
          hasMany: false,
          required: false,
        },
      ],
      timestamps: true,
    },
    {
      slug: "authors",
      label: "Autores",
      fields: [
        { name: "name", label: "Nombre", type: "text", required: true },
        { name: "avatar", label: "Avatar", type: "image", required: false },
      ],
      timestamps: true,
    },
  ],
};

const tokensV1 = {
  colors: {
    "brand-200": "#c7d2fe",
    "brand-500": "#6366f1",
    "brand-600": "#4f46e5",
    "brand-700": "#4338ca",
  },
  typography: { fontFamilies: { sans: "Inter, sans-serif" }, baseSizePx: 16 },
  spacing: { md: "1rem" },
  radii: { sm: "0.25rem" },
  components: ["Hero", "ContentSection"],
};

const contentV1 = {
  keyMessages: ["Confianza", "Rapidez"],
  pages: [
    {
      slug: "home",
      title: "Inicio",
      sections: [{ id: "intro", heading: "Bienvenido", body: "Texto de portada." }],
      seo: { title: "Inicio", description: "Página de inicio", keywords: [] },
    },
  ],
};

const compositionsV1 = {
  pages: [
    {
      slug: "home",
      sections: [
        {
          id: "intro",
          component: "Hero",
          props: { heading: "Bienvenido" },
          // `posts.subtitle` exists in v1 and disappears in v2 → conflict.
          bindings: { subtitle: "posts.subtitle" },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

async function approveArtifact(
  artifactId: string,
  payload: unknown,
  actor: HumanActor,
): Promise<void> {
  await saveDraft(artifactId, payload, actor);
  await submitForReview(artifactId, actor);
  await approve(artifactId, actor);
}

async function main(): Promise<void> {
  const db = getDb();
  const templateKind = ensureTemplate();

  console.log("\n# Setup");
  const workspaceId = newId.workspace();
  const adminId = newId.user();
  const clientId = newId.user();
  const projectId = newId.project();
  const stamp = Date.now();

  await db.insert(users).values([
    {
      id: adminId,
      email: `smoke-gen-admin-${stamp}@example.com`,
      passwordHash: "x",
      name: "Smoke Generator Admin",
    },
    {
      id: clientId,
      email: `smoke-gen-client-${stamp}@example.com`,
      passwordHash: "x",
      name: "Smoke Generator Client",
    },
  ]);
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `smoke-gen-${stamp}`,
    name: "Smoke Generator Workspace",
  });
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: adminId, role: "admin" },
    { workspaceId, userId: clientId, role: "client" },
  ]);
  await db
    .insert(projects)
    .values({ id: projectId, workspaceId, name: "Proyecto Smoke Generador" });

  const admin: HumanActor = { id: adminId, role: "admin", workspaceId };
  const client: HumanActor = { id: clientId, role: "client", workspaceId };
  const repoDir = getProjectRepoDir(projectId);

  try {
    const artifacts = await ensureProjectArtifacts(projectId, admin);
    const byType = new Map(artifacts.map((a) => [a.type, a]));
    const sitemapArt = byType.get("spec.sitemap")!;
    const collectionsArt = byType.get("cms.collections")!;
    const tokensArt = byType.get("design.tokens")!;
    const contentArt = byType.get("content.page")!;
    const compositionArt = byType.get("page.composition")!;
    // page.composition depends on sitemap+collections+tokens; content on strategy.
    const strategyArt = byType.get("spec.strategy")!;

    // -----------------------------------------------------------------------
    console.log("\n# getGenerationRequirements — checklist antes de aprobar");
    let requirements = await getGenerationRequirements(projectId);
    assert(requirements.length === 5, "lista 5 artefactos de entrada (3 requeridos + 2 opcionales)");
    assert(
      requirements.filter((r) => r.required).length === 3 &&
        requirements.every((r) => !r.ok),
      "ningún requisito ok mientras todo está empty",
    );
    await expectGeneratorError(
      () => generateProject(projectId, admin),
      "REQUIREMENTS_NOT_MET",
      "generate sin artefactos aprobados falla",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Aprobación de artefactos (ciclo humano §13)");
    await approveArtifact(sitemapArt.id, sitemapV1, admin);
    await approveArtifact(collectionsArt.id, collectionsV1, admin);
    await approveArtifact(tokensArt.id, tokensV1, admin);
    await approveArtifact(
      strategyArt.id,
      {
        audiences: [{ name: "PYMEs", needs: ["confianza"] }],
        positioning: "Partner técnico",
        valueProposition: "Entrega rápida",
        differentiators: ["experiencia"],
        toneOfVoice: { attributes: ["cercano"] },
      },
      admin,
    );
    await approveArtifact(contentArt.id, contentV1, admin);
    await approveArtifact(compositionArt.id, compositionsV1, admin);

    requirements = await getGenerationRequirements(projectId);
    assert(
      requirements.every((r) => r.ok),
      "todos los requisitos ok tras aprobar (requeridos y opcionales)",
    );

    await expectGeneratorError(
      () => generateProject(projectId, client),
      "FORBIDDEN",
      "un rol client NO puede generar",
    );

    // -----------------------------------------------------------------------
    console.log("\n# generateProject — template + codegen + manifest + git");
    const gen = await generateProject(projectId, admin);
    assert(gen.generation.kind === "generate", "registra generación kind=generate");
    assert(gen.generation.status === "success", "status=success (sin conflictos)");
    assert(gen.repoDir === repoDir, "repo en .data (GENERATED_PROJECTS_DIR)/projects/<projectId>");

    const mustExist = [
      "package.json", // template
      "site.config.ts",
      "src/generated/tokens.css",
      "src/generated/navigation.ts",
      "src/collections/posts.ts",
      "src/collections/authors.ts",
      "src/collections/index.ts",
      "src/seed/content.json",
      "src/compositions/page-home.json",
      "src/compositions/page-blog.json",
      "src/compositions/page-legal.json",
      "src/compositions/page-terms.json",
      MANIFEST_FILENAME,
    ];
    assert(
      mustExist.every((p) => existsSync(path.join(repoDir, p))),
      "archivos del contrato presentes (template + codegen + composiciones)",
    );
    assert(
      !existsSync(path.join(repoDir, "node_modules")) &&
        !existsSync(path.join(repoDir, ".next")),
      "node_modules/.next del template NO se copian",
    );
    if (templateKind === "real") {
      assert(
        !existsSync(path.join(repoDir, "src/collections/testimonials.ts")),
        "los placeholders @generated-example del template se purgan",
      );
    }

    const tokensCss = readFileSync(path.join(repoDir, "src/generated/tokens.css"), "utf8");
    assert(
      tokensCss.includes("--brand-600: #4f46e5;") && tokensCss.includes("@generated"),
      "tokens.css emite las variables del artefacto con header @generated",
    );
    const postsTs = readFileSync(path.join(repoDir, "src/collections/posts.ts"), "utf8");
    assert(
      postsTs.includes(`name: "subtitle"`) && postsTs.includes("CollectionConfig"),
      "collections/posts.ts contiene el campo subtitle (v1) como CollectionConfig",
    );
    const seed = JSON.parse(
      readFileSync(path.join(repoDir, "src/seed/content.json"), "utf8"),
    ) as {
      keyMessages: string[];
      collections: Record<string, Record<string, unknown>[]>;
      pages: { path: string; content: { type: string; props: Record<string, unknown> }[] }[];
    };
    assert(
      seed.keyMessages.length === 2 &&
        seed.pages[0].path === "home" &&
        seed.pages[0].content.some(
          (block) => block.type === "Hero" && block.props.title === "Bienvenido",
        ) &&
        seed.collections.posts.length === 3 &&
        seed.collections.authors.length === 3,
      "seed/content.json: fixtures por colección + páginas Puck desde los artefactos",
    );
    const generatedPkg = JSON.parse(
      readFileSync(path.join(repoDir, "package.json"), "utf8"),
    ) as { name: string };
    assert(
      generatedPkg.name === "proyecto-smoke-generador",
      "package.json#name = slug del proyecto (única escritura fuera del manifest)",
    );
    const homeComposition = readFileSync(
      path.join(repoDir, "src/compositions/page-home.json"),
      "utf8",
    );
    assert(
      JSON.parse(homeComposition).sections[0].bindings.subtitle === "posts.subtitle",
      "composición de home proviene del artefacto page.composition aprobado",
    );
    assert(
      JSON.parse(readFileSync(path.join(repoDir, "src/compositions/page-blog.json"), "utf8"))
        .sections.length === 0,
      "página sin composición ni contenido → scaffold mínimo",
    );

    const manifest = parseManifest(readFileSync(path.join(repoDir, MANIFEST_FILENAME), "utf8"));
    const manifestEntries = Object.entries(manifest.files);
    assert(
      manifestEntries
        .filter(([, e]) => e.owner === "codegen")
        .every(
          ([p, e]) => e.contentHash === sha256(readFileSync(path.join(repoDir, p), "utf8")),
        ),
      "manifest sha256 coincide con el contenido real de cada archivo codegen",
    );
    assert(
      manifestEntries.filter(([p, e]) => e.owner === "human" && p.startsWith("src/compositions/"))
        .length === 4,
      "las 4 composiciones quedan owned-by-human (hash null)",
    );
    assert(
      !(("package.json" as string) in manifest.files),
      "los archivos del template NO se trackean (territorio humano implícito)",
    );

    const log1 = await gitLog(repoDir);
    assert(
      log1.length === 1 && log1[0].includes("generate: initial project"),
      `repo git con commit inicial descriptivo (${log1[0]?.slice(41, 80)}…)`,
    );

    await expectGeneratorError(
      () => generateProject(projectId, admin),
      "ALREADY_GENERATED",
      "segundo generate sobre el mismo repo falla (usar regenerate)",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Edición humana + cambio de spec");
    // (a) Human edits the composition (human-owned: always preserved).
    const compositionPath = path.join(repoDir, "src/compositions/page-home.json");
    const editedComposition = JSON.parse(readFileSync(compositionPath, "utf8"));
    editedComposition.sections.push({
      id: "cta",
      component: "CtaBanner",
      props: { label: "Contacto" },
      bindings: {},
    });
    writeFileSync(compositionPath, JSON.stringify(editedComposition, null, 2) + "\n");
    const editedCompositionBytes = readFileSync(compositionPath, "utf8");

    // (b) Human hand-edits a codegen file (codegen zone → conflict on regen).
    const authorsPath = path.join(repoDir, "src/collections/authors.ts");
    const authorsOriginal = readFileSync(authorsPath, "utf8");
    writeFileSync(authorsPath, authorsOriginal + "\n// hack manual fuera de la plataforma\n");

    // (c) New approved cms.collections version (v2: subtitle removed, fields added).
    await saveDraft(collectionsArt.id, collectionsV2, admin);
    await submitForReview(collectionsArt.id, admin);
    await approve(collectionsArt.id, admin);

    // -----------------------------------------------------------------------
    console.log("\n# regenerateProject — solo codegen, conflictos como dato");
    const regen1 = await regenerateProject(projectId, admin);
    assert(regen1.generation.status === "conflicts", "status=conflicts (reportados, no resueltos)");
    assert(
      regen1.summary.written.includes("src/collections/posts.ts"),
      "reescribe collections/posts.ts (campo eliminado + añadido)",
    );
    const postsTs2 = readFileSync(path.join(repoDir, "src/collections/posts.ts"), "utf8");
    assert(
      postsTs2.includes("heroImage") && !postsTs2.includes("subtitle"),
      "posts.ts v2: heroImage presente, subtitle ausente",
    );
    assert(
      readFileSync(compositionPath, "utf8") === editedCompositionBytes,
      "la composición editada por el humano queda byte-idéntica (§18.2)",
    );
    const humanEditConflict = regen1.summary.conflicts.find(
      (c) => c.kind === "human-edit-in-codegen-zone",
    );
    assert(
      humanEditConflict != null &&
        "path" in humanEditConflict &&
        humanEditConflict.path === "src/collections/authors.ts",
      "edición manual en zona codegen → conflicto, archivo intacto",
    );
    assert(
      readFileSync(authorsPath, "utf8").includes("hack manual"),
      "authors.ts conserva el hack humano (no se sobrescribe)",
    );
    const bindingConflict = regen1.summary.conflicts.find(
      (c) => c.kind === "binding-missing-field",
    );
    assert(
      bindingConflict != null &&
        bindingConflict.kind === "binding-missing-field" &&
        bindingConflict.page === "home" &&
        bindingConflict.sectionId === "intro" &&
        bindingConflict.prop === "subtitle" &&
        bindingConflict.collection === "posts" &&
        bindingConflict.field === "subtitle",
      "binding a campo eliminado → conflicto descriptivo (página/sección/prop/campo)",
    );
    assert(regen1.summary.commit != null, "regeneración con cambios → commit");
    const log2 = await gitLog(repoDir);
    assert(
      log2.length === 2 && log2[0].includes("regenerate:"),
      "commit 'regenerate: …' encima del inicial",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Idempotencia — segunda regeneración sin cambios");
    const treeHash = (): string =>
      sha256(
        Object.keys(parseManifest(readFileSync(path.join(repoDir, MANIFEST_FILENAME), "utf8")).files)
          .sort()
          .map((p) =>
            existsSync(path.join(repoDir, p))
              ? `${p}:${sha256(readFileSync(path.join(repoDir, p), "utf8"))}`
              : `${p}:missing`,
          )
          .join("|"),
      );
    const before = treeHash();
    const regen2 = await regenerateProject(projectId, admin);
    assert(
      regen2.summary.written.length === 0 &&
        regen2.summary.created.length === 0 &&
        regen2.summary.deletedOrphans.length === 0,
      "misma spec → 0 written, 0 created, 0 orphans",
    );
    assert(regen2.summary.commit === null, "sin cambios → sin commit nuevo");
    assert(treeHash() === before, "árbol trackeado byte-idéntico tras regenerar dos veces");
    assert(
      regen2.summary.conflicts.length === regen1.summary.conflicts.length,
      "los conflictos pendientes se re-reportan estables",
    );
    assert((await gitLog(repoDir)).length === 2, "el historial git no crece sin cambios");

    // -----------------------------------------------------------------------
    console.log("\n# Resolución del conflicto codegen — revertir desbloquea el archivo");
    execFileSync("git", ["checkout", "--", "src/collections/authors.ts"], { cwd: repoDir });
    const regen3 = await regenerateProject(projectId, admin);
    assert(
      regen3.summary.written.includes("src/collections/authors.ts"),
      "revertido el hack, la regeneración aplica el cambio pendiente (avatar)",
    );
    assert(
      readFileSync(authorsPath, "utf8").includes("avatar"),
      "authors.ts ahora contiene el campo avatar (v2)",
    );
    assert(
      regen3.summary.conflicts.every((c) => c.kind !== "human-edit-in-codegen-zone"),
      "el conflicto de zona codegen desaparece; el de binding persiste",
    );

    // -----------------------------------------------------------------------
    console.log("\n# getGenerations + audit log");
    const history = await getGenerations(projectId);
    assert(history.length === 4, "4 generaciones registradas (1 generate + 3 regenerate)");
    assert(
      history[0].generation.kind === "regenerate" &&
        history[3].generation.kind === "generate",
      "historial ordenado descendente por fecha",
    );
    assert(
      history.every((h) => h.actorName === "Smoke Generator Admin"),
      "cada generación es atribuible al humano que la lanzó",
    );
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.workspaceId, workspaceId));
    const generationAudits = auditRows.filter((row) => row.entityType === "generation");
    assert(
      generationAudits.length === 4,
      `audit log en cada generación (${generationAudits.length} eventos generation)`,
    );

    console.log(`\nSMOKE OK — ${passed} asserts superados.`);
    if (templateKind === "fixture") {
      console.log(
        "NOTA: se usó el mini-template fixture; re-ejecutar cuando exista templates/project-base.",
      );
    }
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(inArray(users.id, [adminId, clientId]));
    rmSync(SMOKE_DIR, { recursive: true, force: true });
    console.log("Cleanup completado (workspace smoke + repos generados eliminados).");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSMOKE FAILED:", error);
    process.exit(1);
  });
