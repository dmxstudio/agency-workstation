import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb, type Db } from "@/db/client";
import { newId } from "@/db/ids";
import {
  agentRuns,
  artifacts,
  projects,
  workspaceLlmKeys,
  type AgentRun,
  type LlmProviderKind,
  type Project,
} from "@/db/schema";
import { logAudit } from "@/modules/platform-core/audit";

import { getProjectContext } from "../context";
import { getDecryptedKey, markKeyAuthFailed } from "../keys/service";
import {
  AgentsDomainError,
  isAgentsDomainError,
  isLlmProviderError,
  type AgentActor,
  type LlmProvider,
  type SkillDefinition,
  type SkillPromptInput,
} from "../types";
import { buildUsage } from "./cost";
import { saveDraftProposal } from "./proposal-writer";
import { getAgentRunQueue } from "./queue";
import {
  ANTHROPIC_PRICES_USD_PER_MTOK,
  createAnthropicProvider,
} from "./providers/anthropic";
import { createMockProvider } from "./providers/mock";
import { createOpenAiProvider } from "./providers/openai";

/**
 * Agent run runner (§7.9, §13): queued → running → proposed | failed.
 *
 * §19 GUARANTEE, BY CONSTRUCTION: this file produces a PROPOSAL — the target
 * artifact's draft (with `proposedByRunId` provenance) + validations + diff.
 * It contains NO call into any approval path; `approved`/`rejected` on a run
 * only ever record a HUMAN decision made through the artifacts module.
 *
 * Decrypted API keys exist exclusively as local variables of the provider
 * construction below — never on the run row, never in audit entries, never
 * in error details, never in logs.
 */

export interface StartRunParams {
  projectId: string;
  /**
   * Resolved skill definition. Mapping a skill NAME to its definition is the
   * caller's job (skills registry in `src/modules/agents/skills/`).
   */
  skill: SkillDefinition;
  provider: LlmProviderKind;
  /** Must equal `skill.writes`. */
  targetType: string;
  /** Instance key for multi-instance targets (e.g. page path); null for singletons. */
  targetKey?: string | null;
  /** Optional user directive (e.g. revise-artifact: "tono más premium"). */
  instruction?: string | null;
  /** Specific workspace key to use; defaults to the newest one for the provider. */
  keyId?: string | null;
  /** Model override. Anthropic ids are restricted to the known June-2026 list. */
  modelId?: string | null;
}

const EDITOR_ROLES = ["admin", "member"] as const;

function assertEditor(actor: AgentActor): void {
  if (!(EDITOR_ROLES as readonly string[]).includes(actor.role)) {
    throw new AgentsDomainError(
      "FORBIDDEN",
      "No tienes permisos para lanzar agent runs: requiere rol admin o member.",
    );
  }
}

async function loadProject(db: Db, projectId: string): Promise<Project> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!rows[0]) {
    throw new AgentsDomainError("PROJECT_NOT_FOUND", "El proyecto no existe.");
  }
  return rows[0];
}

/**
 * Creates the run (status `queued`), audits it and schedules the async
 * execution WITHOUT blocking the caller (the server action returns
 * immediately; the UI polls run state in the DB). Returns the queued row.
 */
export async function startRun(params: StartRunParams, actor: AgentActor): Promise<AgentRun> {
  assertEditor(actor);
  const db = getDb();

  const project = await loadProject(db, params.projectId);
  if (project.workspaceId !== actor.workspaceId) {
    throw new AgentsDomainError(
      "FORBIDDEN",
      "El proyecto no pertenece a tu workspace activo.",
    );
  }

  if (params.skill.writes !== params.targetType) {
    throw new AgentsDomainError(
      "INVALID_STATE",
      `La skill «${params.skill.name}» escribe «${params.skill.writes}», no «${params.targetType}».`,
    );
  }
  if (
    params.provider === "anthropic" &&
    params.modelId &&
    !(params.modelId in ANTHROPIC_PRICES_USD_PER_MTOK)
  ) {
    throw new AgentsDomainError(
      "INVALID_STATE",
      `Modelo de Anthropic desconocido: ${params.modelId}.`,
    );
  }

  // Resolve the target artifact now: a run without target is meaningless.
  const targetKey = params.targetKey ?? null;
  const targetRows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.projectId, params.projectId), isNull(artifacts.deletedAt)));
  const target = targetRows.find(
    (artifact) => artifact.type === params.targetType && artifact.key === targetKey,
  );
  if (!target) {
    throw new AgentsDomainError(
      "TARGET_NOT_FOUND",
      `No existe el artefacto objetivo (${params.targetType}${targetKey ? `:${targetKey}` : ""}) en este proyecto.`,
    );
  }
  // Fail fast on states the proposal could never be saved into (§8.2).
  if (target.status === "locked") {
    throw new AgentsDomainError(
      "INVALID_STATE",
      "El artefacto objetivo está bloqueado; desbloquéalo antes de lanzar la skill.",
    );
  }
  if (target.status === "in_review") {
    throw new AgentsDomainError(
      "INVALID_STATE",
      "El artefacto objetivo está en revisión; apruébalo o recházalo antes de lanzar la skill.",
    );
  }

  const inserted = await db
    .insert(agentRuns)
    .values({
      id: newId.agentRun(),
      workspaceId: project.workspaceId,
      projectId: project.id,
      skill: params.skill.name,
      skillVersion: params.skill.version,
      status: "queued",
      targetArtifactId: target.id,
      targetType: params.targetType,
      targetKey,
      instruction: params.instruction ?? null,
      inputArtifacts: [],
      provider: params.provider,
      modelId: null,
      keyRef: null,
      createdBy: actor.id,
    })
    .returning();
  const run = inserted[0];

  await logAudit(
    {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: actor.id,
      action: "agent_run.queued",
      entityType: "agent_run",
      entityId: run.id,
      detail: {
        skill: params.skill.name,
        skillVersion: params.skill.version,
        provider: params.provider,
        targetArtifactId: target.id,
        targetType: params.targetType,
        targetKey,
      },
    },
    db,
  );

  // Async execution — the caller (server action) is NOT blocked.
  getAgentRunQueue().enqueue(run.id, () =>
    executeRun(run.id, params.skill, params.modelId ?? null, params.keyId ?? null),
  );

  return run;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async function updateRun(
  db: Db,
  runId: string,
  values: Partial<typeof agentRuns.$inferInsert>,
): Promise<AgentRun> {
  const rows = await db.update(agentRuns).set(values).where(eq(agentRuns.id, runId)).returning();
  return rows[0];
}

async function executeRun(
  runId: string,
  skill: SkillDefinition,
  modelIdOverride: string | null,
  keyIdOverride: string | null,
): Promise<void> {
  const db = getDb();
  const runRows = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  const run = runRows[0];
  if (!run || run.status !== "queued") return; // settled/cancelled elsewhere

  await updateRun(db, runId, { status: "running" });
  await logAudit(
    {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      actorId: run.createdBy,
      action: "agent_run.started",
      entityType: "agent_run",
      entityId: runId,
      detail: { skill: run.skill },
    },
    db,
  );

  let keyRef: string | null = null;
  try {
    // --- key resolution (BYOK §16; mock needs no key) -----------------------
    if (run.provider !== "mock") {
      keyRef = await resolveKeyRef(db, run.workspaceId, run.provider, keyIdOverride);
      await updateRun(db, runId, { keyRef });
    }

    // --- project context (§9.4) + audit of exactly what was read (§9.6) ----
    if (!run.targetArtifactId) {
      throw new AgentsDomainError("TARGET_NOT_FOUND", "El run perdió su artefacto objetivo.");
    }
    const context = await getProjectContext(run.projectId, skill.reads, {
      targetArtifactId: run.targetArtifactId,
    });
    const inputArtifacts = context.artifacts.map((artifact) => ({
      type: artifact.type,
      key: artifact.key,
      version: artifact.version,
      source: artifact.source,
    }));
    await updateRun(db, runId, { inputArtifacts });

    const promptInput: SkillPromptInput = {
      context,
      target: {
        artifactId: run.targetArtifactId,
        type: run.targetType,
        key: run.targetKey,
      },
      instruction: run.instruction,
    };

    // --- provider call (decrypted key: LOCAL variables only) ---------------
    const prompt = skill.buildPrompt(promptInput);
    let provider: LlmProvider;
    if (run.provider === "mock") {
      provider = createMockProvider({
        buildProposal: () => skill.buildMockProposal(promptInput),
      });
    } else {
      const decrypted = await getDecryptedKey(keyRef as string, db);
      provider =
        run.provider === "anthropic"
          ? createAnthropicProvider({
              apiKey: decrypted.apiKey,
              modelId: modelIdOverride ?? undefined,
            })
          : createOpenAiProvider({
              apiKey: decrypted.apiKey,
              modelId: modelIdOverride ?? undefined,
            });
    }
    const result = await provider.complete(prompt);

    // --- parse + validate (skill Zod first, type Zod again on write) -------
    let payload: unknown;
    try {
      payload = skill.parseProposal(result.json, promptInput);
    } catch (error) {
      throw new AgentsDomainError(
        "INVALID_STATE",
        `La propuesta del modelo no supera la validación de la skill: ${error instanceof Error ? error.message : "payload inválido"}`,
      );
    }
    const validations = skill.validate(payload, promptInput);

    // --- persist the PROPOSAL: target draft with run provenance (§8.6) -----
    await saveDraftProposal({
      artifactId: run.targetArtifactId,
      payload,
      agentRunId: runId,
    });

    const usage = buildUsage(run.provider, result.modelId, result.usage);
    await updateRun(db, runId, {
      status: "proposed",
      modelId: result.modelId,
      validations,
      usage,
      finishedAt: new Date(),
    });
    await logAudit(
      {
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        actorId: null, // the proposal is the run's, not a human's
        action: "agent_run.proposed",
        entityType: "agent_run",
        entityId: runId,
        detail: {
          skill: run.skill,
          targetArtifactId: run.targetArtifactId,
          modelId: result.modelId,
          usage,
          validations: validations.map(({ key, ok }) => ({ key, ok })),
          inputArtifacts,
        },
      },
      db,
    );
  } catch (error) {
    await failRun(db, runId, run.workspaceId, run.projectId, keyRef, error);
  }
}

/** Newest non-deleted workspace key for the provider, or the explicit one. */
async function resolveKeyRef(
  db: Db,
  workspaceId: string,
  provider: LlmProviderKind,
  keyIdOverride: string | null,
): Promise<string> {
  const conditions = [
    eq(workspaceLlmKeys.workspaceId, workspaceId),
    eq(workspaceLlmKeys.provider, provider),
    isNull(workspaceLlmKeys.deletedAt),
  ];
  if (keyIdOverride) {
    conditions.push(eq(workspaceLlmKeys.id, keyIdOverride));
  }
  const rows = await db
    .select({ id: workspaceLlmKeys.id })
    .from(workspaceLlmKeys)
    .where(and(...conditions))
    .orderBy(desc(workspaceLlmKeys.createdAt))
    .limit(1);
  if (!rows[0]) {
    throw new AgentsDomainError(
      "NO_KEY",
      `El workspace no tiene una API key de ${provider}. Añádela en Ajustes → API keys (BYOK) o usa el proveedor mock.`,
    );
  }
  return rows[0].id;
}

/**
 * Marks the run `failed` with a readable, DIFFERENTIATED detail (§16:
 * auth/quota/refusal handled explicitly). On provider 401 the key is flagged.
 */
async function failRun(
  db: Db,
  runId: string,
  workspaceId: string,
  projectId: string,
  keyRef: string | null,
  error: unknown,
): Promise<void> {
  let errorCode = "UNEXPECTED";
  let message = "Error inesperado durante el run.";
  if (isLlmProviderError(error)) {
    errorCode = error.code;
    message = error.message;
    if (error.code === "AUTH_FAILED" && keyRef) {
      await markKeyAuthFailed(keyRef, db);
    }
  } else if (isAgentsDomainError(error)) {
    errorCode = error.code;
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message;
  }
  const errorDetail = `${errorCode}: ${message}`;

  try {
    await updateRun(db, runId, {
      status: "failed",
      errorDetail,
      finishedAt: new Date(),
    });
    await logAudit(
      {
        workspaceId,
        projectId,
        actorId: null,
        action: "agent_run.failed",
        entityType: "agent_run",
        entityId: runId,
        detail: { errorCode },
      },
      db,
    );
  } catch (persistError) {
    console.error(`[agents] could not persist failure of run ${runId}:`, persistError);
  }
}

// ---------------------------------------------------------------------------
// Reads (polling) + test helper
// ---------------------------------------------------------------------------

export async function getAgentRun(runId: string): Promise<AgentRun | null> {
  const db = getDb();
  const rows = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  return rows[0] ?? null;
}

/** Runs of a project, newest first (run log listing). */
export async function listAgentRuns(projectId: string, limit = 20): Promise<AgentRun[]> {
  const db = getDb();
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.projectId, projectId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
}

/**
 * Awaits the async execution and returns the settled run. For tests/e2e
 * scripts ONLY — the UI polls `getAgentRun` instead.
 */
export async function waitForRunSettled(runId: string): Promise<AgentRun> {
  await getAgentRunQueue().waitFor(runId);
  const run = await getAgentRun(runId);
  if (!run) {
    throw new AgentsDomainError("RUN_NOT_FOUND", "El run no existe.");
  }
  return run;
}
