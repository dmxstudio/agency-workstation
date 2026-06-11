/**
 * End-to-end drill of STEP 5 over the DEMO project: release → deploy(preview)
 * → client review by token → rollback → stop (§7.7, §7.8, §8.5, §12.2, §13).
 *
 * Prerequisites: `npm run db:migrate && npm run db:seed`. The seed leaves the
 * demo project with EVERY sitemap composition approved, the generated repo up
 * to date, the §7.8 checklist green and release v1 SEALED (it never deploys).
 * Run with: `npx tsx scripts/e2e-deploy-review.ts`.
 *
 * IMPORTANT: PGlite is single-process — stop the platform dev server before
 * running this script (it opens the same embedded DB).
 *
 * What it does, in order (the same service calls the UI buttons make):
 *  0. If any composition has a pending draft — e.g. the seed's paso-6 agent
 *     proposal on «nosotros» (§8.6) — a HUMAN decision approves it (sealing
 *     origin agent_run + run id) and the repo is regenerated. NOTE: this
 *     consumes the demo's "decide the proposal" moment; re-seed from scratch
 *     (`rm -rf .data`) to get it back.
 *  1. Checklist §7.8 all green (otherwise: re-run the seed).
 *  2. createRelease → seals the NEXT immutable release version (v2 on the
 *     first run after seeding; each run adds one — append-only by design)
 *     with its git tag in the generated repo.
 *  3. deployRelease(preview) through the deploy SERVICE: immutable build from
 *     the tag + detached `next start` on the preview slot (port 4200 /
 *     DEPLOY_PREVIEW_PORT) + `deployments` row + audit.
 *  4. Fetches every page of the release from the running slot: HTTP 200, the
 *     section anchors (`<section id="<blockId>"`) present in the DOM and the
 *     sealed home composition's hero actually served.
 *  5. Review round over the new release: client comment by TOKEN → derived
 *     task §12.2 open → resolveComment → task closed → client approval (§8.5:
 *     never transitions internal artifacts) → closeReviewRequest (the token
 *     stops accepting mutations).
 *  6. ROLLBACK: deploys the PREVIOUS release on the same slot (rollback is
 *     just deploy(previousRelease, slot)) and verifies the slot now serves it.
 *  7. stopSlot → slot stopped for real, ports released.
 *
 * Every process started here is killed before exit (finally block) — both
 * slots end stopped and ports 4100/4200 free.
 *
 * Re-runnable: each run seals one more release and one more (closed) review
 * round; the rollback target always exists (the previous release). The demo's
 * own open round («Cliente Acme — ronda 1») is never touched: the client
 * approval moment there stays available for the user.
 */
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

import { and, eq, isNull } from "drizzle-orm";

import { getDb, type Db } from "../src/db/client";
import {
  artifactVersions,
  auditLog,
  projects,
  tasks,
  users,
  workspaces,
} from "../src/db/schema";
import {
  approve,
  getProjectArtifacts,
  submitForReview,
  type HumanActor,
  type ProjectArtifact,
} from "../src/modules/artifacts/service";
import { formatConflict } from "../src/modules/generator/conflicts";
import { regenerateProject } from "../src/modules/generator/service";
import { pageCompositionPayloadSchema } from "../src/modules/artifacts/types/page-composition";
import {
  flattenSitemap,
  specSitemapPayloadSchema,
} from "../src/modules/artifacts/types/spec-sitemap";
import { getDeployProvider, getSlotPort, getSlotUrl } from "../src/modules/deploy";
import {
  deployRelease,
  listDeployments,
  parseDeploymentDetail,
  stopSlot,
} from "../src/modules/deploy/service";
import { ReviewDomainError } from "../src/modules/review/errors";
import {
  addClientApproval,
  addClientComment,
  closeReviewRequest,
  createRelease,
  createReviewRequest,
  getReviewByToken,
  resolveComment,
  runReleaseChecklist,
} from "../src/modules/review/service";

// Demo identities — must match scripts/seed.ts (not imported: seed.ts runs
// its main() at module load).
const DEMO_EMAIL = "demo@agency.local";
const DEMO_WORKSPACE_SLUG = "demo";
const DEMO_PROJECT_NAME = "Sitio Corporativo Acme";

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

async function fetchText(url: string, timeoutMs = 10_000): Promise<{ status: number; body: string } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, body: await response.text() };
  } catch {
    return null;
  }
}

/** TCP probe: true when NOTHING is listening on 127.0.0.1:<port>. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 1_000 });
    const done = (occupied: boolean) => {
      socket.destroy();
      resolve(!occupied);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function expectReviewError(
  fn: () => Promise<unknown>,
  code: string,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof ReviewDomainError && error.code === code, `${label} (code=${code})`);
    return;
  }
  assert(false, label);
}

/** Sealed (immutable) payload of an artifact version, straight from the DB. */
async function loadSealedPayload(db: Db, artifactId: string, version: number): Promise<unknown> {
  const rows = await db
    .select({ payload: artifactVersions.payload })
    .from(artifactVersions)
    .where(
      and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.version, version)),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error(`No existe la versión sellada v${version} del artefacto ${artifactId}.`);
  }
  return rows[0].payload;
}

function singleton(items: ProjectArtifact[], type: string): ProjectArtifact {
  const item = items.find((i) => i.artifact.type === type && i.artifact.key == null);
  if (!item) throw new Error(`El proyecto demo no tiene el artefacto singleton «${type}».`);
  return item;
}

async function main(): Promise<void> {
  const db = getDb();

  // --- Resolve the demo project (created by npm run db:seed) -----------------
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
    throw new Error("No existe el proyecto demo. Ejecuta antes: npm run db:seed");
  }
  const projectId = projectRows[0].id;
  const actor: HumanActor = { id: userRows[0].id, role: "admin", workspaceId: wsRows[0].id };
  const provider = getDeployProvider();
  console.log(`Proyecto demo: ${projectId}\n`);

  // Clean slate: stop anything OURS left over from a previous interrupted run
  // (the provider only ever signals processes it registered).
  await provider.stop(projectId, "preview");
  await provider.stop(projectId, "production");

  try {
    // -------------------------------------------------------------------------
    // 0. Pending drafts on compositions get the HUMAN decision (§13) before
    //    the checklist: the seed's paso 6 leaves ONE agent proposal on
    //    «nosotros» (revise-artifact, §8.6) precisely so a human decides it.
    //    This drill IS that human: it approves (sealing the version with
    //    origin agent_run + run id when the draft is a run's proposal) and
    //    regenerates so the repo incorporates the new sealed versions.
    const pendingCompositions = (await getProjectArtifacts(projectId)).filter(
      (item) =>
        item.artifact.type === "page.composition" &&
        item.artifact.key != null &&
        item.artifact.draftPayload != null &&
        (item.artifact.status === "draft" || item.artifact.status === "in_review"),
    );
    if (pendingCompositions.length > 0) {
      console.log("# 0. Decisión humana sobre borradores/propuestas pendientes (§8.6/§13)");
      for (const item of pendingCompositions) {
        const wasProposal = item.artifact.proposedByRunId;
        if (item.artifact.status === "draft") {
          await submitForReview(item.artifact.id, actor);
        }
        const sealed = await approve(
          item.artifact.id,
          actor,
          "Aprobada en el drill e2e deploy-review (decisión humana sobre la propuesta pendiente).",
        );
        console.log(
          `  «${item.artifact.key}» aprobada como v${sealed.version.version}` +
            (wasProposal
              ? ` (propuesta del run ${wasProposal} → origin ${sealed.version.origin})`
              : ""),
        );
      }
      const regen = await timed("regenerateProject", () => regenerateProject(projectId, actor));
      if (regen.summary.conflicts.length > 0) {
        throw new Error(
          `La regeneración reportó conflictos (§18.2):\n${regen.summary.conflicts
            .map((conflict) => `  - ${formatConflict(conflict)}`)
            .join("\n")}`,
        );
      }
      console.log(
        `  repo regenerado: ${regen.summary.written.length} reescritos` +
          (regen.summary.commit ? ` (commit ${regen.summary.commit.slice(0, 10)})` : " (sin cambios)"),
      );
    }

    // -------------------------------------------------------------------------
    console.log("# 1. Checklist de release §7.8 en verde");
    const checklist = await runReleaseChecklist(projectId);
    for (const item of checklist) {
      console.log(`  ${item.ok ? "✓" : "✗"} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);
    }
    if (!checklist.every((item) => item.ok)) {
      throw new Error(
        "El checklist no está en verde. El seed lo deja listo: npm run db:seed (con el dev server parado).",
      );
    }
    assert(checklist.length === 5 && checklist.every((i) => i.ok), "checklist §7.8 todo en verde");

    let items = await getProjectArtifacts(projectId);
    const releaseArtifact = singleton(items, "release").artifact;
    const previousVersion = releaseArtifact.currentVersion;
    assert(
      previousVersion >= 1,
      `existe al menos un release sellado previo (v${previousVersion} — lo crea el seed)`,
    );

    // -------------------------------------------------------------------------
    console.log("\n# 2. createRelease — siguiente versión inmutable + git tag");
    const release = await timed("createRelease", () =>
      createRelease(
        projectId,
        `Release del e2e deploy-review (${new Date().toISOString()})`,
        actor,
      ),
    );
    const vNext = release.version.version;
    assert(vNext === previousVersion + 1, `release v${vNext} = v${previousVersion} + 1`);
    assert(release.gitTag === `release-${vNext}`, `tag git ${release.gitTag}`);
    assert(
      release.payload.checklist.length === 5 && release.payload.checklist.every((i) => i.ok),
      "el payload sellado congela el checklist en verde",
    );

    // Pages sealed in this release, resolved to site paths via the SAME sealed
    // sitemap version the release froze.
    const sitemapArtifact = singleton(items, "spec.sitemap").artifact;
    const sitemapPayload = specSitemapPayloadSchema.parse(
      await loadSealedPayload(db, sitemapArtifact.id, release.payload.versions.sitemap),
    );
    const pathByPageKey = new Map(
      flattenSitemap(sitemapPayload.pages).map((page) => [page.pagePath, page.path]),
    );
    const pageKeys = Object.keys(release.payload.versions.compositions).sort();
    assert(pageKeys.length >= 1, `el release sella ${pageKeys.length} composiciones de página`);
    const homeKey =
      pageKeys.find((key) => pathByPageKey.get(key) === "/") ?? pageKeys[0];

    // A real block id from the sealed home composition → DOM anchor + comment.
    const homeComposition = items.find(
      (i) => i.artifact.type === "page.composition" && i.artifact.key === homeKey,
    );
    if (!homeComposition) throw new Error(`No existe la composición de «${homeKey}».`);
    const homeData = pageCompositionPayloadSchema.parse(
      await loadSealedPayload(
        db,
        homeComposition.artifact.id,
        release.payload.versions.compositions[homeKey],
      ),
    );
    const anchorBlock =
      homeData.content.find((b) => b.type !== "Navbar" && b.type !== "Footer") ??
      homeData.content[0];
    const anchorId = typeof anchorBlock?.props?.id === "string" ? anchorBlock.props.id : null;
    const heroTitle = (() => {
      const hero = homeData.content.find((b) => typeof b.props?.title === "string");
      const title = hero?.props?.title;
      // Only assert on copy that serializes verbatim into HTML (no escaping).
      return typeof title === "string" && /^[^&<>"']+$/.test(title) ? title : null;
    })();

    // -------------------------------------------------------------------------
    console.log(`\n# 3. deployRelease(v${vNext}, preview) — build inmutable + slot`);
    const outcome = await timed("deployRelease(preview)", () =>
      deployRelease(projectId, vNext, "preview", actor),
    );
    assert(outcome.deployment.status === "running", "fila deployments en estado running");
    assert(outcome.deployment.releaseVersion === vNext, "la fila registra la versión del release");
    assert(outcome.result.url === getSlotUrl("preview"), `el slot sirve en ${outcome.result.url}`);
    assert(outcome.build.releaseNumber === vNext, "el build inmutable corresponde al release");
    const afterDeploy = outcome.statuses.find((s) => s.slot === "preview");
    assert(
      afterDeploy?.state === "running" && afterDeploy.healthy && afterDeploy.releaseNumber === vNext,
      "status(preview) = running + healthy + release activo (realidad, no solo DB)",
    );
    assert(
      outcome.statuses.find((s) => s.slot === "production")?.state === "stopped",
      "el slot production sigue parado (el e2e solo usa preview)",
    );

    // -------------------------------------------------------------------------
    console.log("\n# 4. El deployment sirve TODAS las páginas del release, con anclas");
    for (const pageKey of pageKeys) {
      const pagePath = pathByPageKey.get(pageKey) ?? `/${pageKey}`;
      const page = await fetchText(`${outcome.result.url}${pagePath === "/" ? "" : pagePath}`);
      assert(page?.status === 200, `GET ${pagePath} → 200`);
    }
    const home = await fetchText(outcome.result.url);
    assert(home != null && /<section id="/.test(home.body), "anclas <section id=…> presentes en el DOM (§7.7)");
    if (anchorId) {
      assert(
        home != null && home.body.includes(`id="${anchorId}"`),
        `el id del bloque sellado «${anchorId}» es un ancla real del DOM`,
      );
    }
    if (heroTitle) {
      assert(
        home != null && home.body.includes(heroTitle),
        `la home sirve el copy sellado del release («${heroTitle.slice(0, 40)}…»)`,
      );
    }

    const deployments1 = await listDeployments(projectId);
    const runningRow = deployments1.find((row) => row.deployment.status === "running");
    assert(
      runningRow != null &&
        runningRow.deployment.slot === "preview" &&
        runningRow.deployment.releaseVersion === vNext,
      "listDeployments refleja el deployment running",
    );
    assert(
      parseDeploymentDetail(runningRow!.deployment.detail).port === getSlotPort("preview"),
      "detail jsonb validado por Zod con el puerto del slot",
    );

    // -------------------------------------------------------------------------
    console.log("\n# 5. Ronda de review por token: comentario → tarea → resolver → aprobar → cerrar");
    const request = await createReviewRequest(
      projectId,
      vNext,
      `E2E deploy-review — release v${vNext}`,
      actor,
    );
    assert(request.status === "open" && request.releaseVersion === vNext, "ronda abierta sobre el release nuevo");
    const surface = await getReviewByToken(request.token);
    assert(
      surface.pages.length === pageKeys.length,
      `la superficie del cliente lista las ${pageKeys.length} páginas selladas`,
    );

    const comment = await addClientComment(request.token, {
      pageKey: homeKey,
      sectionId: anchorId,
      authorName: "Cliente E2E",
      body: "Comentario del drill e2e: validar el ciclo completo de review.",
    });
    assert(comment.status === "open" && comment.authorKind === "client", "comentario de cliente abierto");
    const taskKey = `client-comment:${comment.id}`;
    const openTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, taskKey), isNull(tasks.deletedAt)));
    assert(
      openTasks.length === 1 && openTasks[0].status === "open" && openTasks[0].kind === "derived",
      "tarea derivada §12.2 abierta (visible en el Cockpit)",
    );

    const resolved = await resolveComment(comment.id, actor);
    assert(resolved.status === "resolved", "comentario resuelto por el equipo");
    const closedTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, taskKey), isNull(tasks.deletedAt)));
    assert(closedTasks[0]?.status === "done", "la tarea derivada se cierra al resolver");

    const approval = await addClientApproval(request.token, {
      name: "Cliente E2E",
      comment: "Versión aprobada en el drill e2e.",
    });
    assert(
      approval.releaseVersion === vNext && approval.pageKey === null,
      "aprobación GLOBAL del cliente anclada al release (§8.5)",
    );
    items = await getProjectArtifacts(projectId);
    const releaseAfterApproval = singleton(items, "release").artifact;
    assert(
      releaseAfterApproval.currentVersion === vNext && releaseAfterApproval.status === "approved",
      "la aprobación de cliente NO transiciona artefactos internos (§8.5)",
    );

    const closedRound = await closeReviewRequest(request.id, actor);
    assert(closedRound.status === "closed", "ronda cerrada");
    await expectReviewError(
      () =>
        addClientComment(request.token, {
          pageKey: homeKey,
          authorName: "Cliente E2E",
          body: "tarde",
        }),
      "INVALID_STATE",
      "una ronda cerrada no acepta más comentarios",
    );

    // -------------------------------------------------------------------------
    const vPrev = vNext - 1;
    if (vPrev >= 1) {
      console.log(`\n# 6. Rollback = deploy del release anterior (v${vPrev}) en el mismo slot`);
      const rollback = await timed(`deployRelease(v${vPrev}, preview)`, () =>
        deployRelease(projectId, vPrev, "preview", actor),
      );
      const afterRollback = rollback.statuses.find((s) => s.slot === "preview");
      assert(
        afterRollback?.state === "running" && afterRollback.releaseNumber === vPrev,
        `el slot preview sirve ahora el release v${vPrev}`,
      );
      const rolled = await fetchText(rollback.result.url);
      assert(rolled?.status === 200, "el slot responde 200 tras el rollback");
      const deployments2 = await listDeployments(projectId);
      const oldRow = deployments2.find((row) => row.deployment.id === outcome.deployment.id);
      assert(
        oldRow?.deployment.status === "stopped",
        "el deployment anterior del slot queda marcado stopped en la DB",
      );
    } else {
      // Unreachable with a seeded demo (the seed seals v1 and this run sealed
      // v2+), kept for honesty: without a previous release, "rollback" can
      // only re-deploy the same version.
      console.log("\n# 6. Sin release anterior: re-deploy del mismo release (documentado)");
      await deployRelease(projectId, vNext, "preview", actor);
    }

    // -------------------------------------------------------------------------
    console.log("\n# 7. stopSlot — el slot muere de verdad y los puertos quedan libres");
    const stopResult = await stopSlot(projectId, "preview", actor);
    assert(
      stopResult.statuses.every((s) => s.state === "stopped"),
      "status() reporta ambos slots parados",
    );
    assert(await portIsFree(getSlotPort("preview")), `puerto preview ${getSlotPort("preview")} libre`);
    assert(await portIsFree(getSlotPort("production")), `puerto production ${getSlotPort("production")} libre`);

    // -------------------------------------------------------------------------
    console.log("\n# 8. Audit log de todo el ciclo (§19)");
    const auditRows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.projectId, projectId));
    const actions = new Set(auditRows.map((row) => row.action));
    for (const expected of [
      "release.created",
      "deploy.started",
      "deploy.succeeded",
      "deploy.slot_stopped",
      "review.request_created",
      "review.comment_added",
      "review.comment_resolved",
      "review.client_approved",
      "review.request_closed",
    ]) {
      assert(actions.has(expected), `audit: ${expected}`);
    }

    console.log(`\nE2E DEPLOY-REVIEW OK — ${passed} asserts superados.`);
    console.log(
      `La ronda demo del seed («Cliente Acme — ronda 1») sigue abierta y sin aprobación de cliente.`,
    );
  } finally {
    // Kill EVERYTHING this run started — no servers survive the drill.
    await provider.stop(projectId, "preview").catch(() => undefined);
    await provider.stop(projectId, "production").catch(() => undefined);
    const final = await provider.status(projectId);
    if (final.every((slot) => slot.state === "stopped")) {
      console.log("(slots parados; ningún servidor queda corriendo)");
    } else {
      console.error("AVISO: algún slot sigue corriendo tras la limpieza", final);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nE2E DEPLOY-REVIEW FAILED:", error);
    process.exit(1);
  });
