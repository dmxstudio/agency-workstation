/**
 * End-to-end drill of STEP 6 over the DEMO project: las 5 skills (§9.3) por el
 * camino de PRODUCCIÓN completo con el proveedor MOCK (determinista, $0, sin
 * red) — startRun → proposed → decisión HUMANA → versión sellada con
 * provenance agent_run (§7.9, §8.3, §8.6, §9.6, §13, §19).
 *
 * Prerequisites: `npm run db:migrate && npm run db:seed`.
 * Run with: `npx tsx scripts/e2e-agents.ts`.
 *
 * IMPORTANT: PGlite is single-process — stop the platform dev server first.
 *
 * What it covers, in order:
 *  0. Assert ESTÁTICO §19: ningún archivo de src/modules/agents importa (ni
 *     alcanza) `approve`/`reject` de artifacts ni sus server actions.
 *  1. Por CADA una de las 5 skills, contra el proyecto demo:
 *     bind (Zod de params) → startRun (fila queued, ejecución async) →
 *     proposed (draft del target con proposedByRunId + inputArtifacts con las
 *     versiones EXACTAS leídas + validaciones en verde + usage mock $0) →
 *     computeDiff NO vacío (§8.6) → submitForReview + approve HUMANOS →
 *     versión sellada origin "agent_run" + agentRunId, run approved +
 *     resultVersion + decidedBy/decidedAt, provenance limpiada, audit
 *     completo (queued/started/proposed + draft_proposed + submitted +
 *     approved).
 *  2. compose-page-draft: el Data propuesto usa SOLO componentes del registry
 *     real del Studio y RENDERIZA (renderToString con el `Render` RSC de
 *     Puck + createPuckConfig — el espejo verificado del template).
 *  3. REJECT: una propuesta más (revise-artifact) rechazada con feedback →
 *     run rejected + feedback + decidedBy; el draft sigue editable.
 *  4. AUTH_FAILED: key anthropic falsa (fetch mockeado, sin red real) → run
 *     failed con errorDetail «AUTH_FAILED: …», sin retry, key marcada — y
 *     ESCANEO DE FUGAS: el plaintext de la key no aparece en runs/audit/keys,
 *     ni en ./.data/pglite en disco, ni en el código fuente (src/ y scripts/),
 *     ni en la salida de consola de este proceso.
 *  5. RESTAURACIÓN (re-runnable, demo intacta): re-sella los payloads
 *     originales de los artefactos tocados (versiones nuevas — el historial
 *     es append-only e inmutable, §8.3), revalida los `outdated` que provocó
 *     el drill y verifica la PARIDAD con el estado inicial (payloads, flags,
 *     checklist §7.8 y la propuesta demo pendiente sobre «nosotros», que
 *     jamás se toca).
 *
 * Cada ejecución añade ~7 agent runs y las versiones de la restauración al
 * historial del proyecto demo (append-only by design). No arranca servidores.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

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
  agentRuns,
  artifactVersions,
  artifacts,
  auditLog,
  projects,
  users,
  workspaceLlmKeys,
  workspaces,
  type AgentRun,
  type Artifact,
} from "../src/db/schema";
import { addKey, deleteKey } from "../src/modules/agents/keys/service";
import { MOCK_MODEL_ID } from "../src/modules/agents/runtime/providers/mock";
import { startRun, waitForRunSettled } from "../src/modules/agents/runtime/runner";
import { bindSkillForRun, getSkill } from "../src/modules/agents/skills";
import {
  approve,
  computeDiff,
  getProjectArtifacts,
  reject,
  revalidate,
  saveDraft,
  submitForReview,
  type HumanActor,
} from "../src/modules/artifacts/service";
import type { PageCompositionPayload } from "../src/modules/artifacts/types/page-composition";
import { runReleaseChecklist } from "../src/modules/review/service";
import { createPuckConfig } from "../src/modules/studio/registry";

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

// ---------------------------------------------------------------------------
// Console capture — everything this process writes is scanned for key leaks
// ---------------------------------------------------------------------------

const outputChunks: string[] = [];

function captureStream(stream: NodeJS.WriteStream): void {
  const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  stream.write = ((...args: unknown[]) => {
    const [chunk] = args;
    outputChunks.push(
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk),
    );
    return original(...args);
  }) as typeof stream.write;
}
captureStream(process.stdout);
captureStream(process.stderr);

// ---------------------------------------------------------------------------
// Assert ESTÁTICO §19 — agents jamás importa/alcanza approve|reject
// ---------------------------------------------------------------------------

const FORBIDDEN_ARTIFACT_IMPORTS = new Set(["approve", "reject"]);

function listAgentsSourceFiles(): string[] {
  const base = path.join(root, "src", "modules", "agents");
  return readdirSync(base, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => path.join(base, file));
}

function assertAgentsNeverImportApprove(): void {
  const offenders: string[] = [];
  for (const file of listAgentsSourceFiles()) {
    const source = readFileSync(file, "utf8");
    const rel = path.relative(root, file);

    const namedImport = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
    for (const match of source.matchAll(namedImport)) {
      const [, names, sourcePath] = match;
      if (!sourcePath.includes("artifacts")) continue;
      for (const raw of names.split(",")) {
        const name = raw.replace(/\btype\b/g, "").split(/\s+as\s+/)[0].trim();
        if (FORBIDDEN_ARTIFACT_IMPORTS.has(name)) {
          offenders.push(`${rel}: import nombrado prohibido \`${name}\` de ${sourcePath}`);
        }
      }
    }
    if (/from\s+["'][^"']*artifacts\/actions["']/.test(source)) {
      offenders.push(`${rel}: import de las server actions de artifacts`);
    }
    const nsImport = /import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']*artifacts[^"']*)["']/g;
    for (const match of source.matchAll(nsImport)) {
      const ns = match[1];
      const reach = new RegExp(
        `${ns}\\s*\\.\\s*(approve|reject)\\b|${ns}[^\\n]*\\[\\s*["'](approve|reject)["']\\s*\\]`,
      );
      if (reach.test(source)) {
        offenders.push(`${rel}: acceso a approve/reject vía namespace \`${ns}\``);
      }
    }
  }
  assert(
    offenders.length === 0,
    `§19 estático: ningún archivo de agents importa/alcanza approve|reject de artifacts${
      offenders.length > 0 ? ` — ${offenders.join("; ")}` : ""
    }`,
  );
}

// ---------------------------------------------------------------------------
// fetch mock for the AUTH_FAILED phase — no real network ever leaves here
// ---------------------------------------------------------------------------

const FAKE_ANTHROPIC_KEY = "sk-ant-e2e-fake-key-7777";

let messagesPostCount = 0;
const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock(): void {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    // addKey validation passes (the platform believes the key) …
    if (url === "https://api.anthropic.com/v1/models") {
      void init;
      return jsonResponse(200, { data: [] });
    }
    // … and the API rejects it on the actual run (401, no retry).
    if (url === "https://api.anthropic.com/v1/messages") {
      messagesPostCount += 1;
      return jsonResponse(401, {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
        request_id: "req_e2e_agents_auth",
      });
    }
    throw new Error(`e2e-agents: fetch inesperado a ${url} (la red real está prohibida aquí)`);
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Leak scan helpers
// ---------------------------------------------------------------------------

/** Files under `dir` whose BYTES contain the secret (binary-safe). */
function scanDirForSecret(dir: string, secret: string): string[] {
  if (!existsSync(dir)) return [];
  const needle = Buffer.from(secret, "utf8");
  const hits: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && readFileSync(full).includes(needle)) hits.push(full);
    }
  };
  walk(dir);
  return hits;
}

/** Source files (src/ + scripts/) containing the secret, minus this script. */
function scanSourceForSecret(secret: string): string[] {
  const selfPath = path.join(root, "scripts", "e2e-agents.ts");
  const hits: string[] = [];
  for (const base of ["src", "scripts"]) {
    const dir = path.join(root, base);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx|mts|css|json|md)$/.test(file)) continue;
      const full = path.join(dir, file);
      if (full === selfPath) continue;
      if (readFileSync(full, "utf8").includes(secret)) hits.push(path.relative(root, full));
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

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

interface ArtifactSnapshot {
  id: string;
  type: string;
  key: string | null;
  currentVersion: number;
  status: string;
  outdated: boolean;
  rejected: boolean;
  proposedByRunId: string | null;
  /** Sealed payload of `currentVersion` (null when never sealed). */
  approvedPayload: unknown;
  /** Pending draft payload at snapshot time (null when none). */
  draftPayload: unknown;
}

async function snapshotArtifact(db: Db, artifact: Artifact): Promise<ArtifactSnapshot> {
  return {
    id: artifact.id,
    type: artifact.type,
    key: artifact.key,
    currentVersion: artifact.currentVersion,
    status: artifact.status,
    outdated: artifact.outdated,
    rejected: artifact.rejected,
    proposedByRunId: artifact.proposedByRunId,
    approvedPayload:
      artifact.currentVersion > 0
        ? await loadSealedPayload(db, artifact.id, artifact.currentVersion)
        : null,
    draftPayload: artifact.draftPayload ?? null,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = getDb();

  console.log("\n# 0. Asserts estáticos (§19, sin DB)");
  assertAgentsNeverImportApprove();

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
  const workspaceId = wsRows[0].id;
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.name, DEMO_PROJECT_NAME),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (!projectRows[0]) {
    throw new Error("No existe el proyecto demo. Ejecuta antes: npm run db:seed");
  }
  const projectId = projectRows[0].id;
  const actor: HumanActor = { id: userRows[0].id, role: "admin", workspaceId };
  console.log(`\nProyecto demo: ${projectId}`);

  const artifactRow = async (id: string): Promise<Artifact> => {
    const rows = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
    if (!rows[0]) throw new Error(`El artefacto ${id} no existe.`);
    return rows[0];
  };
  const runRow = async (id: string): Promise<AgentRun> => {
    const rows = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
    if (!rows[0]) throw new Error(`El run ${id} no existe.`);
    return rows[0];
  };

  // --- Initial state snapshot (the drill must leave the demo as found) ------
  console.log("\n# 1. Snapshot del estado inicial (paridad al final)");
  const initialItems = await getProjectArtifacts(projectId);
  const findArtifact = (type: string, key: string | null = null): Artifact => {
    const item = initialItems.find(
      (entry) => entry.artifact.type === type && entry.artifact.key === key,
    );
    if (!item) {
      throw new Error(
        `El proyecto demo no tiene el artefacto ${type}${key ? `:${key}` : ""}. Re-siembra: npm run db:seed`,
      );
    }
    return item.artifact;
  };

  const strategyArt = findArtifact("spec.strategy");
  const cmsArt = findArtifact("cms.collections");
  const contentArt = findArtifact("content.page");
  const composeArt = findArtifact("page.composition", "blog");
  const intakeArt = findArtifact("spec.intake");
  const nosotrosArt = initialItems.find(
    (entry) => entry.artifact.type === "page.composition" && entry.artifact.key === "nosotros",
  )?.artifact;

  const touched = [strategyArt, cmsArt, contentArt, composeArt];
  for (const artifact of touched) {
    if (artifact.currentVersion === 0 || artifact.status === "in_review" || artifact.status === "locked") {
      throw new Error(
        `El artefacto ${artifact.type}${artifact.key ? `:${artifact.key}` : ""} no está en un estado sellado y decidible (${artifact.status} v${artifact.currentVersion}). Re-siembra la demo.`,
      );
    }
  }
  const snapshots = new Map<string, ArtifactSnapshot>();
  for (const artifact of [...touched, intakeArt]) {
    snapshots.set(artifact.id, await snapshotArtifact(db, artifact));
  }
  const nosotrosBefore = nosotrosArt ? await snapshotArtifact(db, nosotrosArt) : null;
  const initiallyOutdated = new Set(
    initialItems.filter((entry) => entry.artifact.outdated).map((entry) => entry.artifact.id),
  );
  const initialChecklist = await runReleaseChecklist(projectId);
  assert(initialChecklist.length === 5, "checklist §7.8 inicial evaluado (5 items)");
  if (nosotrosBefore?.proposedByRunId) {
    console.log(
      `  (propuesta demo pendiente sobre «nosotros» del run ${nosotrosBefore.proposedByRunId} — este drill NO la toca)`,
    );
  }

  // -------------------------------------------------------------------------
  // The production path for ONE skill: bind → startRun → proposed asserts.
  // -------------------------------------------------------------------------
  const runProposal = async (
    skillName: string,
    rawParams: Record<string, unknown>,
    targetArtifact: Artifact,
  ): Promise<{ run: AgentRun; payload: unknown }> => {
    const bound = bindSkillForRun(getSkill(skillName), rawParams);
    const queued = await startRun(
      {
        projectId,
        skill: bound.definition,
        provider: "mock",
        targetType: bound.target.type,
        targetKey: bound.target.key,
        instruction: bound.instruction,
      },
      actor,
    );
    assert(
      queued.status === "queued" && queued.skill === skillName,
      `${skillName}: startRun crea la fila queued sin bloquear`,
    );
    const settled = await waitForRunSettled(queued.id);
    assert(
      settled.status === "proposed",
      `${skillName}: el run asienta en proposed${settled.errorDetail ? ` — ${settled.errorDetail}` : ""}`,
    );
    assert(
      settled.modelId === MOCK_MODEL_ID &&
        settled.keyRef === null &&
        settled.usage != null &&
        settled.usage.costUsd === 0,
      `${skillName}: mock determinista (modelId ${MOCK_MODEL_ID}, sin keyRef, coste $0)`,
    );
    const inputs = settled.inputArtifacts ?? [];
    assert(
      inputs.length > 0 &&
        inputs.every(
          (input) =>
            typeof input.type === "string" &&
            input.version >= 0 &&
            (input.source === "approved" || input.source === "draft"),
        ),
      `${skillName}: inputArtifacts registra las versiones EXACTAS leídas (§9.6): ${inputs
        .map((input) => `${input.type}${input.key ? `:${input.key}` : ""}@v${input.version}`)
        .join(", ")}`,
    );
    const validations = settled.validations ?? [];
    const failedValidations = validations.filter((validation) => !validation.ok);
    assert(
      validations.length > 0 && failedValidations.length === 0,
      `${skillName}: validaciones de la skill en verde (${validations
        .map((validation) => validation.key)
        .join(", ")})${
        failedValidations.length > 0
          ? ` — fallan: ${failedValidations.map((f) => `${f.key}: ${f.detail ?? ""}`).join("; ")}`
          : ""
      }`,
    );
    const target = await artifactRow(targetArtifact.id);
    assert(
      target.status === "draft" &&
        target.proposedByRunId === queued.id &&
        target.draftPayload != null,
      `${skillName}: la propuesta es un DRAFT con proposedByRunId — jamás approved (§19)`,
    );
    const diff = await computeDiff(targetArtifact.id);
    assert(
      diff.changes.length > 0 && diff.to.kind === "draft",
      `${skillName}: diff estructural NO vacío (${diff.changes.length} cambios, §8.6)`,
    );
    return { run: settled, payload: target.draftPayload };
  };

  /** The HUMAN decision: approve via artifacts; §8.3 provenance asserts. */
  const approveProposal = async (
    skillName: string,
    run: AgentRun,
    targetArtifact: Artifact,
  ): Promise<number> => {
    await submitForReview(targetArtifact.id, actor);
    const sealed = await approve(
      targetArtifact.id,
      actor,
      `Propuesta de ${skillName} aprobada en el drill e2e (decisión humana §13).`,
    );
    assert(
      sealed.version.origin === "agent_run" && sealed.version.agentRunId === run.id,
      `${skillName}: la versión sellada lleva origin agent_run + agentRunId (§8.3)`,
    );
    assert(
      sealed.approval.approvedBy === actor.id,
      `${skillName}: la aprobación es un acto humano auditado (§8.5)`,
    );
    const decided = await runRow(run.id);
    assert(
      decided.status === "approved" &&
        decided.resultVersion === sealed.version.version &&
        decided.decidedBy === actor.id &&
        decided.decidedAt != null,
      `${skillName}: run approved + resultVersion v${sealed.version.version} + decidedBy/decidedAt (§9.6)`,
    );
    const target = await artifactRow(targetArtifact.id);
    assert(
      target.proposedByRunId === null && target.status === "approved",
      `${skillName}: tras aprobar, la provenance se limpia y el artefacto queda approved`,
    );
    return sealed.version.version;
  };

  // -------------------------------------------------------------------------
  console.log("\n# 2. Skill 1/5 — generate-spec-draft → spec.strategy");
  const strategyCycle = await runProposal("generate-spec-draft", { target: "strategy" }, strategyArt);
  assert(
    (strategyCycle.run.inputArtifacts ?? []).some(
      (input) => input.type === "spec.intake" && input.source === "approved" && input.version >= 1,
    ),
    "generate-spec-draft: leyó el spec.intake APROBADO (contrato §9.1)",
  );
  await approveProposal("generate-spec-draft", strategyCycle.run, strategyArt);

  // Audit completo del ciclo (run + artefacto), §9.6/§19.
  const runAudit = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, "agent_run"), eq(auditLog.entityId, strategyCycle.run.id)));
  const runActions = new Set(runAudit.map((row) => row.action));
  assert(
    runActions.has("agent_run.queued") &&
      runActions.has("agent_run.started") &&
      runActions.has("agent_run.proposed"),
    "audit del run: queued + started + proposed",
  );
  const artifactAudit = await db
    .select({ action: auditLog.action, actorId: auditLog.actorId })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, "artifact"), eq(auditLog.entityId, strategyArt.id)));
  const proposedEntries = artifactAudit.filter((row) => row.action === "artifact.draft_proposed");
  assert(
    proposedEntries.length > 0 && proposedEntries.every((row) => row.actorId === null),
    "audit del artefacto: draft_proposed con actorId null (el run nunca suplanta a un humano)",
  );
  assert(
    artifactAudit.some((row) => row.action === "artifact.submitted_for_review") &&
      artifactAudit.some((row) => row.action === "artifact.approved"),
    "audit del artefacto: submitted_for_review + approved (decisión humana)",
  );

  // -------------------------------------------------------------------------
  console.log("\n# 3. Skill 2/5 — generate-cms-schema → cms.collections");
  const cmsCycle = await runProposal("generate-cms-schema", {}, cmsArt);
  await approveProposal("generate-cms-schema", cmsCycle.run, cmsArt);

  // -------------------------------------------------------------------------
  console.log("\n# 4. Skill 3/5 — write-page-copy → content.page");
  const copyCycle = await runProposal("write-page-copy", {}, contentArt);
  await approveProposal("write-page-copy", copyCycle.run, contentArt);

  // -------------------------------------------------------------------------
  console.log("\n# 5. Skill 4/5 — compose-page-draft → page.composition:blog");
  const composeCycle = await runProposal("compose-page-draft", { pageKey: "blog" }, composeArt);
  const composition = composeCycle.payload as PageCompositionPayload;
  const puckConfig = createPuckConfig();
  const realComponentNames = new Set(Object.keys(puckConfig.components));
  assert(
    composition.content.length >= 3 &&
      composition.content.every((block) => realComponentNames.has(block.type)),
    `compose: el Data usa SOLO componentes del registry real (${composition.content
      .map((block) => block.type)
      .join(", ")})`,
  );
  const blockIds = composition.content.map((block) => block.props.id);
  assert(
    new Set(blockIds).size === blockIds.length,
    `compose: ids de bloque únicos (${blockIds.join(", ")})`,
  );
  // Render real con el renderer espejo del template (RSC de Puck): el Data
  // propuesto por el agente sirve tal cual en el sitio generado.
  {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { Render } = await import("@puckeditor/core/rsc");
    type RenderProps = Parameters<typeof Render>[0];
    const html = renderToString(
      createElement(Render, {
        config: puckConfig,
        data: composition,
      } as RenderProps),
    );
    const firstBlock = composition.content[0];
    const firstTitle =
      typeof firstBlock.props.title === "string" ? (firstBlock.props.title as string) : null;
    assert(
      html.length > 0 && /<section id="/.test(html),
      "compose: el Data renderiza en el renderer del template con anclas de sección",
    );
    if (firstTitle && /^[^&<>"']+$/.test(firstTitle)) {
      assert(
        html.includes(firstTitle),
        `compose: el HTML servido contiene el copy propuesto («${firstTitle.slice(0, 40)}…»)`,
      );
    }
  }
  await approveProposal("compose-page-draft", composeCycle.run, composeArt);

  // -------------------------------------------------------------------------
  console.log("\n# 6. Skill 5/5 — revise-artifact → spec.strategy (instrucción dirigida)");
  const reviseInstruction = "Haz el tono más directo y menciona los plazos de entrega";
  const reviseCycle = await runProposal(
    "revise-artifact",
    { instruction: reviseInstruction, targetType: "spec.strategy" },
    strategyArt,
  );
  assert(
    reviseCycle.run.instruction === reviseInstruction,
    "revise-artifact: la instrucción queda auditada en la fila del run",
  );
  await approveProposal("revise-artifact", reviseCycle.run, strategyArt);

  // -------------------------------------------------------------------------
  console.log("\n# 7. REJECT con feedback — el run queda rejected y el draft sigue editable");
  const rejectCycle = await runProposal(
    "revise-artifact",
    { instruction: "Añade un mensaje clave sobre sostenibilidad", targetType: "content.page" },
    contentArt,
  );
  await submitForReview(contentArt.id, actor);
  const feedback = "El mensaje no encaja con el posicionamiento; revisar con el cliente.";
  await reject(contentArt.id, feedback, actor);
  const rejectedRun = await runRow(rejectCycle.run.id);
  assert(
    rejectedRun.status === "rejected" &&
      rejectedRun.feedback === feedback &&
      rejectedRun.decidedBy === actor.id &&
      rejectedRun.resultVersion === null,
    "reject: run rejected + feedback + decidedBy, sin resultVersion (§8.6/§9.6)",
  );
  let contentRow = await artifactRow(contentArt.id);
  assert(
    contentRow.status === "draft" &&
      contentRow.rejected &&
      contentRow.proposedByRunId === null &&
      contentRow.draftPayload != null,
    "reject: el artefacto vuelve a draft con flag rejected y provenance limpiada (§8.2)",
  );
  // El draft sigue siendo editable por un humano (saveDraft no falla).
  await saveDraft(contentArt.id, contentRow.draftPayload, actor);
  contentRow = await artifactRow(contentArt.id);
  assert(
    contentRow.status === "draft" && contentRow.proposedByRunId === null,
    "reject: el draft rechazado sigue editable (saveDraft humano OK)",
  );

  // -------------------------------------------------------------------------
  console.log("\n# 8. AUTH_FAILED — key anthropic falsa, fetch mockeado, CERO fugas");
  installFetchMock();
  let tempKeyId: string | null = null;
  try {
    const tempKey = await addKey(
      {
        workspaceId,
        provider: "anthropic",
        label: "E2E key temporal (falsa)",
        apiKey: FAKE_ANTHROPIC_KEY,
      },
      actor,
    );
    tempKeyId = tempKey.id;
    assert(
      tempKey.last4 === FAKE_ANTHROPIC_KEY.slice(-4) && !JSON.stringify(tempKey).includes(FAKE_ANTHROPIC_KEY),
      "addKey: la key se guarda cifrada y la respuesta pública solo lleva last4",
    );

    const bound = bindSkillForRun(getSkill("revise-artifact"), {
      instruction: "Resume el objetivo en una frase",
      targetType: "spec.intake",
    });
    messagesPostCount = 0;
    const authRun = await startRun(
      {
        projectId,
        skill: bound.definition,
        provider: "anthropic",
        targetType: bound.target.type,
        targetKey: bound.target.key,
        instruction: bound.instruction,
        keyId: tempKey.id,
      },
      actor,
    );
    const settled = await waitForRunSettled(authRun.id);
    assert(settled.status === "failed", "el run con key inválida asienta en failed");
    assert(
      (settled.errorDetail ?? "").startsWith("AUTH_FAILED:"),
      `errorDetail diferenciado §16: «${settled.errorDetail?.slice(0, 60)}…»`,
    );
    assert(messagesPostCount === 1, "401 NO se reintenta (exactamente 1 POST)");
    assert(settled.keyRef === tempKey.id, "el run registra la key POR REFERENCIA (id), nunca el valor");
    const keyRows = await db
      .select()
      .from(workspaceLlmKeys)
      .where(eq(workspaceLlmKeys.id, tempKey.id))
      .limit(1);
    assert(keyRows[0].lastValidatedAt === null, "la key queda marcada tras el 401 (lastValidatedAt null)");
    const intakeAfter = await artifactRow(intakeArt.id);
    const intakeBefore = snapshots.get(intakeArt.id)!;
    assert(
      intakeAfter.status === intakeBefore.status &&
        intakeAfter.currentVersion === intakeBefore.currentVersion &&
        intakeAfter.draftPayload == null,
      "el artefacto objetivo queda INTACTO tras el fallo (sin draft fantasma)",
    );

    // --- escaneo de fugas: el plaintext no existe en ningún sitio ----------
    const allRuns = await db.select().from(agentRuns).where(eq(agentRuns.projectId, projectId));
    const allAudit = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId));
    const allKeys = await db
      .select()
      .from(workspaceLlmKeys)
      .where(eq(workspaceLlmKeys.workspaceId, workspaceId));
    const dbDump =
      JSON.stringify({ allRuns, allAudit }) +
      JSON.stringify(allKeys.map((key) => ({ ...key, encryptedKey: "<omitted>" })));
    assert(
      !dbDump.includes(FAKE_ANTHROPIC_KEY),
      "fugas: ni runs, ni audit, ni metadatos de keys contienen el plaintext",
    );
    assert(
      allKeys.every((key) => !key.encryptedKey.includes(FAKE_ANTHROPIC_KEY)),
      "fugas: el ciphertext AES-256-GCM en DB no contiene el plaintext",
    );
    const pgliteHits = scanDirForSecret(path.join(root, ".data", "pglite"), FAKE_ANTHROPIC_KEY);
    assert(
      pgliteHits.length === 0,
      `fugas: los archivos de la DB en disco (./.data/pglite) no contienen el plaintext${
        pgliteHits.length > 0 ? ` — ${pgliteHits.join(", ")}` : ""
      }`,
    );
    const sourceHits = scanSourceForSecret(FAKE_ANTHROPIC_KEY);
    assert(
      sourceHits.length === 0,
      `fugas: grep del repo (src/ + scripts/) sin rastro del plaintext${
        sourceHits.length > 0 ? ` — ${sourceHits.join(", ")}` : ""
      }`,
    );
  } finally {
    globalThis.fetch = realFetch;
    if (tempKeyId) {
      await deleteKey(tempKeyId, actor);
    }
  }
  assert(
    (await db
      .select({ id: workspaceLlmKeys.id })
      .from(workspaceLlmKeys)
      .where(
        and(
          eq(workspaceLlmKeys.workspaceId, workspaceId),
          eq(workspaceLlmKeys.provider, "anthropic"),
          isNull(workspaceLlmKeys.deletedAt),
        ),
      )).length === 0,
    "la key temporal del drill queda soft-borrada (el workspace demo no acumula keys falsas)",
  );

  // -------------------------------------------------------------------------
  console.log("\n# 9. Restauración — la demo queda como estaba (re-runnable, §13 reversible)");
  for (const artifact of touched) {
    const before = snapshots.get(artifact.id)!;
    const current = await artifactRow(artifact.id);
    const currentPayload =
      current.currentVersion > 0
        ? await loadSealedPayload(db, artifact.id, current.currentVersion)
        : null;
    const needsRestore =
      !isDeepStrictEqual(currentPayload, before.approvedPayload) || current.draftPayload != null;
    if (!needsRestore) continue;
    await saveDraft(artifact.id, before.approvedPayload, actor);
    await submitForReview(artifact.id, actor);
    await approve(
      artifact.id,
      actor,
      "Restauración del payload original de la demo tras el drill e2e de agentes.",
    );
    console.log(
      `  ${artifact.type}${artifact.key ? `:${artifact.key}` : ""}: payload original re-sellado (versión nueva — el historial es inmutable).`,
    );
  }

  // Revalidar los outdated provocados por el drill (jamás los preexistentes).
  for (let pass = 0; pass < 3; pass += 1) {
    const current = await getProjectArtifacts(projectId);
    const toRevalidate = current.filter(
      (entry) => entry.artifact.outdated && !initiallyOutdated.has(entry.artifact.id),
    );
    if (toRevalidate.length === 0) break;
    for (const entry of toRevalidate) {
      await revalidate(entry.artifact.id, actor);
    }
    console.log(
      `  revalidados ${toRevalidate.length} artefacto(s) marcados outdated por el drill (la propagación marca, nunca regenera — §8.4).`,
    );
  }

  // --- paridad con el estado inicial ----------------------------------------
  const finalItems = await getProjectArtifacts(projectId);
  for (const artifact of touched) {
    const before = snapshots.get(artifact.id)!;
    const after = finalItems.find((entry) => entry.artifact.id === artifact.id)!.artifact;
    const sealedNow = await loadSealedPayload(db, artifact.id, after.currentVersion);
    assert(
      isDeepStrictEqual(sealedNow, before.approvedPayload) &&
        after.status === "approved" &&
        !after.rejected &&
        after.draftPayload == null,
      `paridad: ${artifact.type}${artifact.key ? `:${artifact.key}` : ""} sellado con el payload ORIGINAL (v${after.currentVersion}, historial completo conservado)`,
    );
  }
  const finalOutdated = finalItems
    .filter((entry) => entry.artifact.outdated)
    .map((entry) => entry.artifact.id);
  assert(
    finalOutdated.every((id) => initiallyOutdated.has(id)),
    "paridad: ningún flag outdated nuevo queda pendiente",
  );
  if (nosotrosBefore) {
    const nosotrosAfter = finalItems.find(
      (entry) => entry.artifact.id === nosotrosBefore.id,
    )!.artifact;
    assert(
      nosotrosAfter.proposedByRunId === nosotrosBefore.proposedByRunId &&
        nosotrosAfter.status === nosotrosBefore.status &&
        nosotrosAfter.currentVersion === nosotrosBefore.currentVersion &&
        isDeepStrictEqual(nosotrosAfter.draftPayload ?? null, nosotrosBefore.draftPayload),
      "paridad: la propuesta demo pendiente sobre «nosotros» queda EXACTAMENTE como estaba",
    );
  }
  const finalChecklist = await runReleaseChecklist(projectId);
  assert(
    JSON.stringify(finalChecklist.map((item) => `${item.key}:${item.ok}`)) ===
      JSON.stringify(initialChecklist.map((item) => `${item.key}:${item.ok}`)),
    "paridad: el checklist de release §7.8 queda en el mismo estado que al empezar",
  );

  // --- salida de consola sin fugas (se evalúa al final, sobre TODO lo impreso)
  assert(
    !outputChunks.join("").includes(FAKE_ANTHROPIC_KEY),
    "fugas: la salida de consola de todo el drill no contiene el plaintext de la key",
  );

  console.log(`\nE2E AGENTS OK — ${passed} asserts superados.`);
  console.log(
    "El historial del proyecto demo conserva los runs y versiones del drill (append-only, auditable y reversible).",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nE2E AGENTS FAILED:", error);
    console.error(
      "(el drill pudo dejar versiones/flags intermedios: re-ejecuta tras arreglar la causa o re-siembra la demo)",
    );
    process.exit(1);
  });
