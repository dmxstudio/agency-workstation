/**
 * Smoke test of the review/release module against the local DB (§7.7, §7.8,
 * §8.5, §12.2).
 *
 * Full cycle: approved inputs → generate → checklist FAILS with an unapproved
 * composition → approve it → release v1 (immutable version + git tag) →
 * review round (client token) → client comment → derived task exists →
 * resolve → task closed → client approval (never touches internal artifacts)
 * → close round → release v2 (the release's own `outdated` does not block).
 *
 * Run with:  npm run db:migrate && npx tsx scripts/smoke-review.ts
 *
 * Isolation: generated repos under `.data/smoke-review/` (own template
 * fixture) and a throwaway workspace, both cleaned up at the end.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

// Isolate generated output BEFORE using the generator (paths resolve at call
// time, but being explicit keeps the smoke self-contained).
const SMOKE_DIR = path.join(root, ".data", "smoke-review");
process.env.GENERATED_PROJECTS_DIR = path.join(SMOKE_DIR, "projects");

import { and, eq, inArray, isNull, like } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { newId } from "../src/db/ids";
import {
  auditLog,
  projects,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "../src/db/schema";
import {
  approve,
  ensureProjectArtifacts,
  saveDraft,
  submitForReview,
  syncCompositionArtifacts,
  type HumanActor,
} from "../src/modules/artifacts/service";
import type { PageCompositionPayload } from "../src/modules/artifacts/types/page-composition";
import { gitListTags } from "../src/modules/generator/git";
import { getProjectRepoDir } from "../src/modules/generator/paths";
import { generateProject } from "../src/modules/generator/service";
import { ReviewDomainError } from "../src/modules/review/errors";
import {
  addClientApproval,
  addClientComment,
  addTeamComment,
  closeReviewRequest,
  createRelease,
  createReviewRequest,
  getReviewByToken,
  listReviewRequests,
  resolveComment,
  runReleaseChecklist,
} from "../src/modules/review/service";

let passed = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`ASSERT FAIL: ${label}`);
  }
  passed += 1;
  console.log(`  ok - ${label}`);
}

async function expectReviewError(
  fn: () => Promise<unknown>,
  code: string,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(
      error instanceof ReviewDomainError && error.code === code,
      `${label} (code=${code})`,
    );
    return;
  }
  assert(false, label);
}

// ---------------------------------------------------------------------------
// Mini-template fixture (the smoke never depends on the real template)
// ---------------------------------------------------------------------------

function ensureTemplateFixture(): void {
  const fixture = path.join(SMOKE_DIR, "template-fixture");
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(path.join(fixture, "src", "app"), { recursive: true });
  writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ name: "project-base-fixture", private: true }, null, 2) + "\n",
  );
  writeFileSync(path.join(fixture, ".gitignore"), ["node_modules", ".next", ".data", ""].join("\n"));
  writeFileSync(path.join(fixture, "README.md"), "# Mini-template fixture (smoke-review)\n");
  writeFileSync(
    path.join(fixture, "src", "app", "layout.tsx"),
    "export default function Layout() {\n  return null;\n}\n",
  );
  process.env.PROJECT_TEMPLATE_DIR = fixture;
}

// ---------------------------------------------------------------------------
// Approved input payloads
// ---------------------------------------------------------------------------

const sitemapV1 = {
  pages: [
    { title: "Inicio", slug: "home", children: [] },
    { title: "Servicios", slug: "servicios", children: [] },
  ],
  navigation: { header: ["home", "servicios"], footer: ["home"] },
};

const collectionsV1 = {
  collections: [
    {
      slug: "posts",
      label: "Posts",
      fields: [
        { name: "title", label: "Título", type: "text", required: true },
        { name: "excerpt", label: "Extracto", type: "richText", required: false },
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
  components: ["Hero"],
};

/** Home: incluye un binding VIVO válido (snapshot `title` existe en `posts`). */
const homeComposition: PageCompositionPayload = {
  root: { props: { title: "Inicio", description: "Página de inicio" } },
  content: [
    {
      type: "Hero",
      props: { id: "hero-home", title: "Bienvenido", tone: "light" },
    },
    {
      type: "PostFeature",
      props: {
        id: "post-destacado",
        post: { collection: "posts", docId: 1, title: "Título 1" },
      },
    },
  ],
  zones: {},
};

const serviciosComposition: PageCompositionPayload = {
  root: { props: { title: "Servicios", description: "Qué hacemos" } },
  content: [
    {
      type: "Hero",
      props: { id: "hero-servicios", title: "Servicios", tone: "dark" },
    },
  ],
  zones: {},
};

const serviciosCompositionV2: PageCompositionPayload = {
  ...serviciosComposition,
  content: [
    {
      type: "Hero",
      props: { id: "hero-servicios", title: "Servicios y consultoría", tone: "dark" },
    },
  ],
};

async function approveArtifact(
  artifactId: string,
  payload: unknown,
  actor: HumanActor,
): Promise<void> {
  await saveDraft(artifactId, payload, actor);
  await submitForReview(artifactId, actor);
  await approve(artifactId, actor);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = getDb();
  ensureTemplateFixture();

  console.log("\n# Setup");
  const workspaceId = newId.workspace();
  const adminId = newId.user();
  const clientUserId = newId.user();
  const projectId = newId.project();
  const stamp = Date.now();

  await db.insert(users).values([
    {
      id: adminId,
      email: `smoke-review-admin-${stamp}@example.com`,
      passwordHash: "x",
      name: "Smoke Review Admin",
    },
    {
      id: clientUserId,
      email: `smoke-review-client-${stamp}@example.com`,
      passwordHash: "x",
      name: "Smoke Review Client",
    },
  ]);
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `smoke-review-${stamp}`,
    name: "Smoke Review Workspace",
  });
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: adminId, role: "admin" },
    { workspaceId, userId: clientUserId, role: "client" },
  ]);
  await db.insert(projects).values({ id: projectId, workspaceId, name: "Smoke Review Project" });

  const admin: HumanActor = { id: adminId, role: "admin", workspaceId };
  const clientRole: HumanActor = { id: clientUserId, role: "client", workspaceId };

  try {
    // -----------------------------------------------------------------------
    console.log("\n# Preparación: inputs aprobados + composiciones + generación");
    const created = await ensureProjectArtifacts(projectId, admin);
    const byType = new Map(created.map((a) => [a.type, a]));
    const releaseArtifactId = byType.get("release")!.id;

    await approveArtifact(byType.get("spec.sitemap")!.id, sitemapV1, admin);
    await approveArtifact(byType.get("cms.collections")!.id, collectionsV1, admin);
    await approveArtifact(byType.get("design.tokens")!.id, tokensV1, admin);

    const sync = await syncCompositionArtifacts(projectId, admin);
    assert(sync.compositions.length === 2, "sitemap aprobado → 2 composiciones (home, servicios)");
    const homeComp = sync.compositions.find((a) => a.key === "home")!;
    const serviciosComp = sync.compositions.find((a) => a.key === "servicios")!;
    await approveArtifact(homeComp.id, homeComposition, admin);

    await generateProject(projectId, admin);
    assert(existsSync(getProjectRepoDir(projectId)), "el repo del proyecto existe tras generar");

    // -----------------------------------------------------------------------
    console.log("\n# runReleaseChecklist — falla con composición sin aprobar (§7.8)");
    const checklist1 = await runReleaseChecklist(projectId);
    assert(checklist1.length === 5, "el checklist tiene 5 validaciones automáticas");
    const item = (list: typeof checklist1, key: string) => list.find((i) => i.key === key)!;
    assert(item(checklist1, "generator-inputs-approved").ok, "inputs del generator aprobados");
    assert(
      !item(checklist1, "compositions-approved").ok &&
        (item(checklist1, "compositions-approved").detail ?? "").includes("servicios"),
      "composiciones NO ok: el detalle nombra a «servicios»",
    );
    assert(item(checklist1, "bindings-valid").ok, "cero bindings rotos (binding vivo válido)");
    assert(item(checklist1, "generation-up-to-date").ok, "generación al día (manifest + success)");
    assert(item(checklist1, "no-pending-outdated").ok, "sin re-validaciones pendientes");

    await expectReviewError(
      () => createRelease(projectId, "intento prematuro", admin),
      "CHECKLIST_NOT_PASSED",
      "createRelease exige el checklist todo en verde",
    );
    await expectReviewError(
      () => createRelease(projectId, "sin permisos", clientRole),
      "FORBIDDEN",
      "un rol client no puede crear releases",
    );

    // -----------------------------------------------------------------------
    console.log("\n# createRelease — versión inmutable + git tag (§7.8)");
    await approveArtifact(serviciosComp.id, serviciosComposition, admin);
    const checklist2 = await runReleaseChecklist(projectId);
    assert(checklist2.every((i) => i.ok), "checklist todo en verde tras aprobar «servicios»");

    const release1 = await createRelease(projectId, "Primer release del sitio", admin);
    assert(release1.artifact.id === releaseArtifactId, "sella el artefacto singleton release");
    assert(
      release1.artifact.status === "approved" && release1.artifact.currentVersion === 1,
      "release v1 = versión inmutable 1 del artefacto (approved)",
    );
    assert(release1.payload.releaseNumber === 1, "payload.releaseNumber = 1");
    assert(release1.gitTag === "release-1", "git tag release-1");
    assert(
      release1.payload.versions.sitemap === 1 &&
        release1.payload.versions.cms === 1 &&
        release1.payload.versions.tokens === 1 &&
        release1.payload.versions.content === 0,
      "sella las versiones de los inputs (content 0 = opcional sin aprobar)",
    );
    assert(
      release1.payload.versions.compositions.home === 1 &&
        release1.payload.versions.compositions.servicios === 1,
      "sella la versión de cada composición por pageKey",
    );
    assert(
      release1.payload.checklist.length === 5 && release1.payload.checklist.every((i) => i.ok),
      "el payload congela el checklist evaluado",
    );
    const tags = await gitListTags(getProjectRepoDir(projectId));
    assert(tags.includes("release-1"), "el repo generado tiene el tag release-1");

    // -----------------------------------------------------------------------
    console.log("\n# createReviewRequest + getReviewByToken (§7.7, R8)");
    const request = await createReviewRequest(projectId, 1, "Cliente Acme — ronda 1", admin);
    assert(request.status === "open" && request.releaseVersion === 1, "ronda abierta sobre release v1");
    assert(request.token.length >= 24, "token url-safe largo");
    assert(/^[A-Za-z0-9_-]+$/.test(request.token), "token sin caracteres no url-safe");

    await expectReviewError(
      () => createReviewRequest(projectId, 99, "ronda inválida", admin),
      "RELEASE_NOT_FOUND",
      "no se puede abrir ronda sobre una versión de release inexistente",
    );
    await expectReviewError(
      () => getReviewByToken("token-falso"),
      "INVALID_TOKEN",
      "un token inválido se rechaza SIEMPRE contra la DB",
    );

    const surface = await getReviewByToken(request.token);
    assert(surface.project.name === "Smoke Review Project", "superficie con nombre de proyecto");
    assert(surface.release.releaseNumber === 1, "superficie anclada al release de la ronda");
    assert(
      surface.pages.length === 2 &&
        surface.pages.map((p) => p.pageKey).join(",") === "home,servicios",
      "páginas del release (compositionVersions) visibles para el cliente",
    );
    const homePage = surface.pages.find((p) => p.pageKey === "home")!;
    assert(homePage.path === "/" && homePage.title === "Inicio", "home resuelve path `/` y título");

    // -----------------------------------------------------------------------
    console.log("\n# Comentario de cliente → tarea derivada (§12.2)");
    const comment = await addClientComment(request.token, {
      pageKey: "servicios",
      sectionId: "hero-servicios",
      authorName: "María Cliente",
      body: "El titular del hero no refleja la propuesta de valor.",
    });
    assert(
      comment.authorKind === "client" && comment.status === "open" && comment.authorUserId === null,
      "comentario de cliente abierto, sin usuario de plataforma",
    );
    const taskKey = `client-comment:${comment.id}`;
    const commentTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, taskKey), isNull(tasks.deletedAt)));
    assert(
      commentTasks.length === 1 &&
        commentTasks[0].status === "open" &&
        commentTasks[0].kind === "derived" &&
        commentTasks[0].title.includes("Resolver comentario de cliente"),
      "tarea derivada «Resolver comentario de cliente…» abierta (dedupeKey por comentario)",
    );
    assert(commentTasks[0].artifactId === serviciosComp.id, "la tarea enlaza la composición de la página");

    await expectReviewError(
      () =>
        addClientComment(request.token, {
          pageKey: "no-existe",
          authorName: "María Cliente",
          body: "x",
        }),
      "VALIDATION_FAILED",
      "comentario sobre página fuera del release se rechaza",
    );
    await expectReviewError(
      () =>
        addClientComment(request.token, {
          pageKey: "home",
          authorName: "  ",
          body: "sin nombre",
        }),
      "VALIDATION_FAILED",
      "el cliente debe escribir su nombre (su identidad es label + nombre)",
    );

    const reply = await addTeamComment(
      request.id,
      { pageKey: "servicios", parentId: comment.id, body: "Lo revisamos hoy mismo." },
      admin,
    );
    assert(
      reply.authorKind === "team" && reply.authorUserId === adminId && reply.parentId === comment.id,
      "respuesta del equipo en hilo (parentId), atribuida al usuario de sesión",
    );
    const teamTaskRows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, `client-comment:${reply.id}`), isNull(tasks.deletedAt)));
    assert(teamTaskRows.length === 0, "los comentarios del equipo NO derivan tareas");

    // -----------------------------------------------------------------------
    console.log("\n# resolveComment — cierra la tarea derivada");
    await expectReviewError(
      () => resolveComment(comment.id, clientRole),
      "FORBIDDEN",
      "resolver comentarios es exclusivo del equipo (admin|member)",
    );
    const resolved = await resolveComment(comment.id, admin);
    assert(
      resolved.status === "resolved" && resolved.resolvedBy === adminId,
      "comentario resuelto y atribuible",
    );
    const taskAfter = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, taskKey), isNull(tasks.deletedAt)));
    assert(taskAfter[0].status === "done", "la tarea derivada se cierra al resolver");
    await expectReviewError(
      () => resolveComment(comment.id, admin),
      "INVALID_STATE",
      "no se puede resolver dos veces",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Aprobación de cliente (§8.5) — tipo distinto, jamás transiciona artefactos");
    const approval = await addClientApproval(request.token, {
      name: "María Cliente",
      comment: "Aprobado para publicar.",
    });
    assert(
      approval.releaseVersion === 1 && approval.pageKey === null,
      "aprobación GLOBAL de la ronda anclada a release v1",
    );
    assert(approval.approvedName === "María Cliente", "identidad = nombre que escribe el cliente");

    const pageApproval = await addClientApproval(request.token, {
      name: "María Cliente",
      pageKey: "home",
    });
    assert(pageApproval.pageKey === "home", "aprobación por página también soportada");

    // Los artefactos internos NO se tocan (§8.5): misma versión, mismo estado.
    const surface2 = await getReviewByToken(request.token);
    assert(surface2.approvals.length === 2, "las aprobaciones aparecen en la superficie");
    const releaseRows = await db.query.artifacts.findFirst({
      where: (a, { eq: eqOp }) => eqOp(a.id, releaseArtifactId),
    });
    assert(
      releaseRows!.currentVersion === 1 && releaseRows!.status === "approved",
      "la aprobación de cliente NO transiciona el artefacto release",
    );

    // -----------------------------------------------------------------------
    console.log("\n# closeReviewRequest — el token deja de mutar, la lectura sigue");
    await expectReviewError(
      () => closeReviewRequest(request.id, clientRole),
      "FORBIDDEN",
      "cerrar la ronda es exclusivo del equipo",
    );
    const closed = await closeReviewRequest(request.id, admin);
    assert(closed.status === "closed" && closed.closedAt != null, "ronda cerrada con timestamp");
    await expectReviewError(
      () =>
        addClientComment(request.token, {
          pageKey: "home",
          authorName: "María Cliente",
          body: "tarde",
        }),
      "INVALID_STATE",
      "una ronda cerrada no acepta comentarios",
    );
    await expectReviewError(
      () => addClientApproval(request.token, { name: "María Cliente" }),
      "INVALID_STATE",
      "una ronda cerrada no acepta aprobaciones",
    );
    const readAfterClose = await getReviewByToken(request.token);
    assert(readAfterClose.request.status === "closed", "la lectura por token sigue disponible");

    const summaries = await listReviewRequests(projectId);
    assert(
      summaries.length === 1 &&
        summaries[0].commentCount === 2 &&
        summaries[0].openCommentCount === 1 &&
        summaries[0].approvalCount === 2,
      "listado interno con contadores (2 comentarios, 1 abierto del equipo, 2 aprobaciones)",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Release v2 — el outdated PROPIO del release no bloquea el checklist");
    await approveArtifact(serviciosComp.id, serviciosCompositionV2, admin);
    const releaseAfterComp = await db.query.artifacts.findFirst({
      where: (a, { eq: eqOp }) => eqOp(a.id, releaseArtifactId),
    });
    assert(
      releaseAfterComp!.outdated,
      "nueva versión de composición → release marcado outdated (§8.4: marca, no regenera)",
    );
    const checklist3 = await runReleaseChecklist(projectId);
    assert(
      checklist3.every((i) => i.ok),
      "el checklist excluye la tarea outdated del propio release (es lo que el release resuelve)",
    );
    const release2 = await createRelease(projectId, "Ajuste del hero de servicios", admin);
    assert(
      release2.payload.releaseNumber === 2 &&
        release2.gitTag === "release-2" &&
        release2.payload.versions.compositions.servicios === 2,
      "release v2 sella la composición v2 y tagea release-2",
    );
    assert(!release2.artifact.outdated, "sellar el release limpia su flag outdated");
    const outdatedReleaseTask = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, `outdated:${releaseArtifactId}`), isNull(tasks.deletedAt)));
    assert(
      outdatedReleaseTask.length === 0 || outdatedReleaseTask[0].status === "done",
      "la tarea outdated del release queda cerrada al sellar v2",
    );
    const tags2 = await gitListTags(getProjectRepoDir(projectId));
    assert(
      tags2.includes("release-1") && tags2.includes("release-2"),
      "ambos tags conviven en el repo generado",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Audit log en toda mutación (§19)");
    const auditRows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.workspaceId, workspaceId));
    const actions = new Set(auditRows.map((row) => row.action));
    for (const expected of [
      "release.created",
      "review.request_created",
      "review.comment_added",
      "review.comment_resolved",
      "review.client_approved",
      "review.request_closed",
    ]) {
      assert(actions.has(expected), `audit: ${expected}`);
    }

    // Las tareas derivadas abiertas tipo outdated quedaron en cero al final.
    const openOutdated = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, "open"),
          like(tasks.dedupeKey, "outdated:%"),
          isNull(tasks.deletedAt),
        ),
      );
    assert(openOutdated.length === 0, "sin tareas outdated abiertas tras el ciclo completo");

    console.log(`\nSMOKE OK — ${passed} asserts superados.`);
  } finally {
    // Cleanup: cascades remove project, artifacts, rounds, comments,
    // approvals, tasks and audit entries.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(inArray(users.id, [adminId, clientUserId]));
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
