/**
 * Smoke test of the artifacts domain module against the local DB.
 *
 * Exercises the full canonical cycle (§13): instantiate graph → drafts →
 * review → approve (immutable version) → `outdated` propagation to
 * dependents → revalidate without changes → gates. Prints asserts.
 *
 * Run with:  npm run db:migrate && npx tsx scripts/smoke-artifacts.ts
 * Cleans up after itself (deletes its own workspace; cascades take the rest).
 */
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

import { and, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { newId } from "../src/db/ids";
import {
  artifactDependencies,
  artifactVersions,
  artifacts,
  auditLog,
  projects,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "../src/db/schema";
import { diffPayloads } from "../src/modules/artifacts/diff";
import {
  ArtifactDomainError,
  ArtifactValidationError,
} from "../src/modules/artifacts/errors";
import {
  approve,
  computeDiff,
  ensureProjectArtifacts,
  getArtifactWithHistory,
  getPhaseGates,
  getProjectArtifacts,
  reject,
  revalidate,
  saveDraft,
  submitForReview,
  syncCompositionArtifacts,
  type HumanActor,
} from "../src/modules/artifacts/service";
import type { PageCompositionPayload } from "../src/modules/artifacts/types/page-composition";

let passed = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`ASSERT FAIL: ${label}`);
  }
  passed += 1;
  console.log(`  ok - ${label}`);
}

async function expectDomainError(
  fn: () => Promise<unknown>,
  code: string,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(
      error instanceof ArtifactDomainError && error.code === code,
      `${label} (code=${code})`,
    );
    return;
  }
  assert(false, label);
}

async function main(): Promise<void> {
  const db = getDb();

  // -------------------------------------------------------------------------
  // Fixtures: workspace + users + project (cleaned up at the end)
  // -------------------------------------------------------------------------
  console.log("\n# Setup");
  const workspaceId = newId.workspace();
  const adminId = newId.user();
  const clientId = newId.user();
  const projectId = newId.project();
  const stamp = Date.now();

  await db.insert(users).values([
    {
      id: adminId,
      email: `smoke-admin-${stamp}@example.com`,
      passwordHash: "x",
      name: "Smoke Admin",
    },
    {
      id: clientId,
      email: `smoke-client-${stamp}@example.com`,
      passwordHash: "x",
      name: "Smoke Client",
    },
  ]);
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `smoke-${stamp}`,
    name: "Smoke Workspace",
  });
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: adminId, role: "admin" },
    { workspaceId, userId: clientId, role: "client" },
  ]);
  await db.insert(projects).values({ id: projectId, workspaceId, name: "Smoke Project" });

  const admin: HumanActor = { id: adminId, role: "admin", workspaceId };
  const client: HumanActor = { id: clientId, role: "client", workspaceId };

  try {
    // -----------------------------------------------------------------------
    console.log("\n# ensureProjectArtifacts — grafo MVP instanciado");
    const created = await ensureProjectArtifacts(projectId, admin);
    assert(
      created.length === 7,
      "crea los 7 artefactos singleton (page.composition es multi-instancia y se deriva del sitemap)",
    );
    assert(
      created.every((a) => a.type !== "page.composition"),
      "no instancia page.composition como singleton",
    );
    assert(
      created.every((a) => a.status === "empty" && a.currentVersion === 0 && a.key === null),
      "todos nacen en estado empty, version 0, sin key",
    );
    const again = await ensureProjectArtifacts(projectId, admin);
    assert(again.length === 7, "es idempotente (segunda llamada → siguen siendo 7)");

    const ids = created.map((a) => a.id);
    const edges = await db
      .select()
      .from(artifactDependencies)
      .where(inArray(artifactDependencies.fromArtifactId, ids));
    assert(
      edges.length === 3,
      "instancia las 3 aristas entre singletons (§8.4); las de page.* llegan con el sync",
    );

    const byType = new Map(created.map((a) => [a.type, a]));
    const intake = byType.get("spec.intake")!;
    const strategy = byType.get("spec.strategy")!;
    const sitemap = byType.get("spec.sitemap")!;
    const contentPage = byType.get("content.page")!;
    const release = byType.get("release")!;

    await expectDomainError(
      () => syncCompositionArtifacts(projectId, admin),
      "SITEMAP_NOT_APPROVED",
      "sync de composiciones sin sitemap aprobado falla",
    );

    // -----------------------------------------------------------------------
    console.log("\n# saveDraft — validación Zod en cada escritura");
    let validationFailed = false;
    try {
      await saveDraft(intake.id, { objective: "" }, admin);
    } catch (error) {
      validationFailed =
        error instanceof ArtifactValidationError && error.issues.length > 0;
    }
    assert(validationFailed, "payload inválido → ArtifactValidationError con issues");

    const intakeV1 = {
      objective: "Lanzar el sitio corporativo de Acme",
      client: { name: "Acme S.A.", industry: "Industrial" },
      scope: {
        inScope: ["Sitio corporativo de 5 páginas"],
        outOfScope: ["E-commerce"],
      },
      constraints: { technical: ["Next.js"], legal: [] },
      brandInputs: { hasLogo: true, hasStyleGuide: false },
      successCriteria: ["Publicado en producción"],
    };
    const drafted = await saveDraft(intake.id, intakeV1, admin);
    assert(drafted.status === "draft" && drafted.draftPayload != null, "draft válido guardado → estado draft");

    await expectDomainError(
      () => saveDraft(intake.id, intakeV1, client),
      "FORBIDDEN",
      "un rol client no puede editar artefactos",
    );

    // -----------------------------------------------------------------------
    console.log("\n# submitForReview — tarea derivada de revisión (§7.10)");
    const inReview = await submitForReview(intake.id, admin);
    assert(inReview.status === "in_review", "draft → in_review");
    const reviewTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, `review:${intake.id}`), isNull(tasks.deletedAt)));
    assert(
      reviewTasks.length === 1 && reviewTasks[0].status === "open" && reviewTasks[0].kind === "derived",
      "crea UNA tarea derivada de revisión (dedupeKey)",
    );

    await expectDomainError(
      () => saveDraft(intake.id, intakeV1, admin),
      "INVALID_STATE",
      "el draft queda congelado mientras está en revisión",
    );

    // -----------------------------------------------------------------------
    console.log("\n# approve — solo humanos con rol (§8.6, §13)");
    await expectDomainError(
      () => approve(intake.id, client),
      "FORBIDDEN",
      "un rol client NO puede aprobar",
    );

    const approveResult = await approve(intake.id, admin, "Visto bueno inicial");
    assert(approveResult.artifact.status === "approved", "in_review → approved");
    assert(approveResult.artifact.currentVersion === 1, "currentVersion = 1");
    assert(
      approveResult.version.version === 1 && approveResult.version.origin === "human",
      "versión inmutable v1 sellada con origin human",
    );
    assert(approveResult.approval.approvedBy === adminId, "approval registrada con el aprobador");
    assert(approveResult.artifact.draftPayload === null, "el draft promovido se limpia");
    assert(
      approveResult.outdatedDependentIds.length === 0,
      "dependientes vacíos (empty) NO se marcan outdated",
    );
    const reviewTaskAfter = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, `review:${intake.id}`), isNull(tasks.deletedAt)));
    assert(reviewTaskAfter[0].status === "done", "la tarea de revisión se resuelve al aprobar");

    // -----------------------------------------------------------------------
    console.log("\n# Ciclo en dependiente + propagación outdated (§8.4)");
    const strategyPayload = {
      audiences: [{ name: "PYMEs industriales", needs: ["confianza", "rapidez"] }],
      positioning: "El partner técnico de confianza",
      valueProposition: "Entrega rápida con calidad de agencia",
      differentiators: ["15 años de experiencia"],
      toneOfVoice: { attributes: ["cercano", "experto"] },
    };
    await saveDraft(strategy.id, strategyPayload, admin);
    await submitForReview(strategy.id, admin);
    await approve(strategy.id, admin);

    const intakeV2 = {
      ...intakeV1,
      objective: "Lanzar el sitio corporativo y captar leads",
      successCriteria: ["Publicado en producción", "20 leads/mes"],
    };
    const redrafted = await saveDraft(intake.id, intakeV2, admin);
    assert(redrafted.status === "draft", "editar un approved abre el draft de la siguiente versión");

    const diff = await computeDiff(intake.id);
    assert(
      diff.from.kind === "version" && diff.from.version === 1 && diff.to.kind === "draft",
      "computeDiff por defecto: draft vs última versión aprobada",
    );
    assert(
      diff.changes.some((c) => c.path === "objective" && c.type === "changed"),
      "el diff estructural detecta `objective` cambiado",
    );
    assert(
      diff.changes.some((c) => c.path === "successCriteria[1]" && c.type === "added"),
      "el diff estructural detecta el criterio añadido",
    );

    await submitForReview(intake.id, admin);
    const secondApprove = await approve(intake.id, admin);
    assert(secondApprove.artifact.currentVersion === 2, "segunda aprobación → v2");
    assert(
      secondApprove.outdatedDependentIds.length === 1 &&
        secondApprove.outdatedDependentIds[0] === strategy.id,
      "propaga outdated SOLO al dependiente con contenido (strategy)",
    );

    const strategyAfter = (await getProjectArtifacts(projectId)).find(
      (item) => item.artifact.id === strategy.id,
    )!;
    assert(
      strategyAfter.artifact.outdated && strategyAfter.artifact.status === "approved",
      "strategy queda approved + outdated simultáneamente (§8.2)",
    );
    const contentAfter = (await getProjectArtifacts(projectId)).find(
      (item) => item.artifact.id === contentPage.id,
    )!;
    assert(!contentAfter.artifact.outdated, "content.page (empty) no se marca outdated");

    const outdatedTask = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, `outdated:${strategy.id}`), isNull(tasks.deletedAt)));
    assert(
      outdatedTask.length === 1 && outdatedTask[0].status === "open",
      "se crea la tarea derivada de re-validación",
    );
    assert(
      strategyAfter.artifact.currentVersion === 1,
      "la propagación MARCA, nunca regenera: strategy sigue en v1",
    );

    // -----------------------------------------------------------------------
    console.log("\n# reject — vuelta a draft con flag rejected (§8.2)");
    const sitemapPayload = {
      pages: [
        { title: "Home", slug: "home", children: [] },
        {
          title: "Servicios",
          slug: "servicios",
          children: [{ title: "Consultoría", slug: "consultoria", children: [] }],
        },
      ],
      navigation: { header: ["home", "servicios"], footer: ["home"] },
    };
    await saveDraft(sitemap.id, sitemapPayload, admin);
    await submitForReview(sitemap.id, admin);
    const rejected = await reject(sitemap.id, "Falta la página de contacto", admin);
    assert(
      rejected.status === "draft" && rejected.rejected,
      "in_review → draft con flag rejected",
    );

    const sitemapPayload2 = {
      ...sitemapPayload,
      pages: [...sitemapPayload.pages, { title: "Contacto", slug: "contacto", children: [] }],
    };
    await saveDraft(sitemap.id, sitemapPayload2, admin);
    await submitForReview(sitemap.id, admin);
    const reopenedTask = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, `review:${sitemap.id}`), isNull(tasks.deletedAt)));
    assert(
      reopenedTask.length === 1 && reopenedTask[0].status === "open",
      "re-submit reabre la MISMA tarea derivada (sin duplicados)",
    );
    const sitemapApproved = await approve(sitemap.id, admin);
    assert(
      sitemapApproved.artifact.status === "approved" && !sitemapApproved.artifact.rejected,
      "aprobar limpia el flag rejected",
    );

    // -----------------------------------------------------------------------
    console.log("\n# syncCompositionArtifacts — composiciones por página (§7.4)");
    // Sitemap aprobado: home, servicios (+ hija consultoria), contacto.
    const sync1 = await syncCompositionArtifacts(projectId, admin);
    assert(
      sync1.created.length === 4 && sync1.compositions.length === 4,
      "sitemap aprobado (4 páginas) → 4 artefactos page.composition",
    );
    assert(
      sync1.created
        .map((a) => a.key)
        .sort()
        .join(",") === "contacto,home,servicios,servicios/consultoria",
      "keys = paths de página (anidadas incluidas: servicios/consultoria)",
    );
    assert(
      sync1.created.every((a) => a.status === "empty" && a.type === "page.composition"),
      "todas nacen empty con tipo page.composition",
    );
    const consultoriaComp = sync1.compositions.find((a) => a.key === "servicios/consultoria")!;
    assert(
      consultoriaComp.label === "Composición: Consultoría",
      'label humano "Composición: <título>"',
    );
    const compEdges = await db
      .select()
      .from(artifactDependencies)
      .where(eq(artifactDependencies.fromArtifactId, consultoriaComp.id));
    assert(
      compEdges.length === 3,
      "aristas §8.4 por instancia: sitemap/cms/tokens → page.composition",
    );
    const releaseEdges = await db
      .select()
      .from(artifactDependencies)
      .where(
        and(
          eq(artifactDependencies.fromArtifactId, release.id),
          eq(artifactDependencies.toArtifactId, consultoriaComp.id),
        ),
      );
    assert(releaseEdges.length === 1, "arista §8.4: page.composition → release");

    const sync2 = await syncCompositionArtifacts(projectId, admin);
    assert(
      sync2.created.length === 0 && sync2.orphaned.length === 0,
      "el sync es idempotente (segunda llamada → 0 creadas, 0 huérfanas)",
    );

    // Ciclo §13 sobre UNA composición (payload = Data de Puck del template).
    const serviciosComp = sync1.compositions.find((a) => a.key === "servicios")!;
    const serviciosData: PageCompositionPayload = {
      root: { props: { title: "Servicios", description: "Página de servicios" } },
      content: [
        {
          type: "Hero",
          props: { id: "hero-servicios", title: "Servicios", tone: "light" },
        },
      ],
      zones: {},
    };
    await expectDomainError(
      () => saveDraft(serviciosComp.id, { pages: [] }, admin),
      "VALIDATION_FAILED",
      "el payload legado { pages: [] } ya NO valida (schema v2 = Data de Puck)",
    );
    await saveDraft(serviciosComp.id, serviciosData, admin);
    await submitForReview(serviciosComp.id, admin);
    const compApproved = await approve(serviciosComp.id, admin, "Composición de servicios OK");
    assert(
      compApproved.artifact.currentVersion === 1 && compApproved.artifact.key === "servicios",
      "la composición keyed se aprueba con el MISMO ciclo §13 (versión inmutable v1)",
    );

    // Página eliminada del sitemap → la composición se MARCA, nunca se borra.
    const sitemapV2 = {
      ...sitemapPayload2,
      pages: sitemapPayload2.pages.map((page) =>
        page.slug === "servicios" ? { ...page, children: [] } : page,
      ),
    };
    await saveDraft(sitemap.id, sitemapV2, admin);
    await submitForReview(sitemap.id, admin);
    await approve(sitemap.id, admin, "IA v2: consultoría se fusiona en servicios");
    const sync3 = await syncCompositionArtifacts(projectId, admin);
    assert(
      sync3.created.length === 0 &&
        sync3.orphaned.length === 1 &&
        sync3.orphaned[0].id === consultoriaComp.id,
      "página fuera del sitemap → SOLO esa composición queda huérfana",
    );
    const orphanRows = await getProjectArtifacts(projectId);
    const orphan = orphanRows.find((item) => item.artifact.id === consultoriaComp.id)!;
    assert(
      orphan.artifact.outdated && orphan.artifact.deletedAt === null,
      "la huérfana se marca outdated y NO se borra (marca, nunca destruye §8.4)",
    );
    const orphanTask = await db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.dedupeKey, `outdated:${consultoriaComp.id}`), isNull(tasks.deletedAt)),
      );
    assert(
      orphanTask.length === 1 &&
        orphanTask[0].status === "open" &&
        orphanTask[0].title.includes("fuera del sitemap"),
      'tarea derivada "página fuera del sitemap" abierta',
    );
    const serviciosAfterSitemapV2 = orphanRows.find(
      (item) => item.artifact.id === serviciosComp.id,
    )!;
    assert(
      serviciosAfterSitemapV2.artifact.outdated &&
        serviciosAfterSitemapV2.artifact.status === "approved",
      "la composición con contenido queda approved+outdated por la propagación del sitemap v2",
    );
    assert(
      serviciosAfterSitemapV2.label === "Composición: Servicios",
      "el listado del proyecto usa el label por instancia",
    );
    await revalidate(serviciosComp.id, admin); // deja servicios limpio para los gates

    // -----------------------------------------------------------------------
    console.log("\n# revalidate — revalidar sin cambios (§17-R6)");
    const revalidated = await revalidate(strategy.id, admin);
    assert(!revalidated.outdated, "revalidate limpia outdated sin tocar contenido");
    assert(revalidated.currentVersion === 1, "el contenido no cambió (sigue v1)");
    const outdatedTaskAfter = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, `outdated:${strategy.id}`), isNull(tasks.deletedAt)));
    assert(outdatedTaskAfter[0].status === "done", "cierra la tarea derivada de re-validación");
    await expectDomainError(
      () => revalidate(strategy.id, admin),
      "NOT_OUTDATED",
      "revalidar algo no-outdated falla",
    );

    // -----------------------------------------------------------------------
    console.log("\n# getPhaseGates — gates por fase (§8.5)");
    const gates = await getPhaseGates(projectId);
    const gate = (phase: string) => gates.find((g) => g.phase === phase)!;
    assert(gates.length === 8, "devuelve las 8 fases en orden canónico");
    assert(gate("intake").closable, "gate intake cerrable (approved sin outdated)");
    assert(gate("strategy").closable, "gate strategy cerrable tras revalidar");
    assert(gate("ia").closable, "gate ia cerrable (sitemap aprobado)");
    assert(!gate("content").closable, "gate content NO cerrable (artefacto empty)");
    assert(
      gate("content").pendingTypes.includes("content.page"),
      "el gate reporta qué tipos bloquean",
    );

    // -----------------------------------------------------------------------
    console.log("\n# getArtifactWithHistory — versiones inmutables");
    const history = await getArtifactWithHistory(intake.id);
    assert(history.versions.length === 2, "historial con 2 versiones");
    assert(
      history.versions[0].version === 2 && history.versions[1].version === 1,
      "versiones ordenadas descendente",
    );
    const v1Payload = history.versions[1].payload as typeof intakeV1;
    assert(
      v1Payload.objective === intakeV1.objective,
      "v1 permanece inmutable tras aprobar v2",
    );
    assert(history.approvals.length === 2, "2 aprobaciones registradas");
    assert(
      history.approvals.every((a) => a.approver.id === adminId),
      "cada aprobación es atribuible a un humano (§13)",
    );
    assert(history.definition?.label === "Intake del proyecto", "definición resuelta del registry");

    const versionDiff = await computeDiff(intake.id, { fromVersion: 1, toVersion: 2 });
    assert(
      versionDiff.changes.some((c) => c.path === "objective" && c.type === "changed"),
      "diff entre dos versiones selladas",
    );

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.workspaceId, workspaceId));
    assert(auditRows.length >= 12, `audit log en toda mutación (${auditRows.length} eventos)`);

    // -----------------------------------------------------------------------
    console.log("\n# diff.ts — alineación de arrays");
    const keyed = diffPayloads(
      { items: [{ id: "a", v: 1 }, { id: "b", v: 2 }] },
      { items: [{ id: "b", v: 3 }, { id: "c", v: 4 }] },
    );
    assert(
      keyed.some((c) => c.path === "items[id=a]" && c.type === "removed"),
      "array con id: item eliminado alineado por clave",
    );
    assert(
      keyed.some((c) => c.path === "items[id=b].v" && c.type === "changed"),
      "array con id: cambio anidado alineado por clave",
    );
    assert(
      keyed.some((c) => c.path === "items[id=c]" && c.type === "added"),
      "array con id: item añadido alineado por clave",
    );
    const indexed = diffPayloads({ list: [1, 2, 3] }, { list: [1, 5] });
    assert(
      indexed.some((c) => c.path === "list[1]" && c.type === "changed") &&
        indexed.some((c) => c.path === "list[2]" && c.type === "removed"),
      "array sin clave: alineación por índice",
    );
    const nested = diffPayloads({ a: {} }, { a: { b: { c: 1 } } });
    assert(
      nested.length === 1 && nested[0].path === "a.b" && nested[0].type === "added",
      "subárbol añadido → un único cambio con el subárbol completo",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Migración del singleton legado page.composition (pre multi-instancia)");
    // Proyecto que simula una DB seedeada ANTES del modelo keyed: un artefacto
    // page.composition sin key, approved v1 con el payload legado 1.0.
    const legacyProjectId = newId.project();
    await db
      .insert(projects)
      .values({ id: legacyProjectId, workspaceId, name: "Smoke Legacy Composition" });
    const legacyArts = await ensureProjectArtifacts(legacyProjectId, admin);
    const legacySitemap = legacyArts.find((a) => a.type === "spec.sitemap")!;
    const legacyRows = await db
      .insert(artifacts)
      .values({
        id: newId.artifact(),
        projectId: legacyProjectId,
        type: "page.composition",
        schemaVersion: "1.0",
        status: "approved",
        currentVersion: 1,
      })
      .returning();
    const legacySingleton = legacyRows[0];
    await db.insert(artifactVersions).values({
      id: newId.artifactVersion(),
      artifactId: legacySingleton.id,
      version: 1,
      payload: { pages: [{ slug: "home", sections: [] }] },
      origin: "human",
      authorId: adminId,
    });

    await saveDraft(legacySitemap.id, sitemapPayload, admin);
    await submitForReview(legacySitemap.id, admin);
    await approve(legacySitemap.id, admin);
    const legacySync = await syncCompositionArtifacts(legacyProjectId, admin);
    assert(
      legacySync.migratedLegacyId === legacySingleton.id,
      "el singleton legado migra su rol en el primer sync",
    );
    const migrated = legacySync.compositions.find((a) => a.id === legacySingleton.id)!;
    assert(
      migrated.key === "home" && migrated.label === "Composición: Home",
      "pasa a ser la composición de la HOME (key + label)",
    );
    assert(
      migrated.outdated && migrated.status === "approved" && migrated.currentVersion === 1,
      "su contenido legado (schema 1.0) se MARCA outdated; las versiones selladas no se tocan",
    );
    const migrationTask = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, `outdated:${legacySingleton.id}`), isNull(tasks.deletedAt)));
    assert(
      migrationTask.length === 1 &&
        migrationTask[0].status === "open" &&
        migrationTask[0].title.includes("Migrar"),
      "tarea derivada de migración al esquema v2 abierta",
    );
    assert(
      legacySync.created.length === 2 &&
        legacySync.created
          .map((a) => a.key)
          .sort()
          .join(",") === "servicios,servicios/consultoria",
      "las demás páginas del sitemap se crean keyed (la home ya la cubre el legado)",
    );

    console.log(`\nSMOKE OK — ${passed} asserts superados.`);
  } finally {
    // Cleanup: cascades remove projects, artifacts, versions, tasks, audit.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(inArray(users.id, [adminId, clientId]));
    console.log("Cleanup completado (workspace smoke eliminado).");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSMOKE FAILED:", error);
    process.exit(1);
  });
