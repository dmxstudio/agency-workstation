"use server";

import { and, eq, isNull } from "drizzle-orm";
import { ZodError } from "zod";

import { getDb } from "@/db/client";
import {
  artifacts,
  projects,
  type AgentRun,
  type LlmProviderKind,
} from "@/db/schema";
import { getArtifactTypeOrNull } from "@/modules/artifacts/types";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";

import { listKeys } from "../keys/service";
import { getAgentRun, startRun } from "../runtime/runner";
import { bindSkillForRun, getSkill, isSkillName } from "../skills";
import { isAgentsDomainError, isLlmProviderError, type AgentActor } from "../types";
import type {
  AssistantActionResult,
  AssistantArtifactInfo,
  AssistantContextData,
  RunStatusView,
} from "./types";

/**
 * Server actions del asistente contextual único (§9.2). Lanzan runs vía el
 * runtime (`startRun`) y SOLO leen estado para el polling — ninguna ruta de
 * aquí aprueba ni rechaza artefactos (§19: eso vive en las server actions de
 * artifacts y siempre lo hace un humano con rol).
 */

const EDITOR_ROLES = ["admin", "member"] as const;

async function requireEditor(): Promise<AgentActor | null> {
  const user = await getSessionUser();
  if (!user) return null;
  if (!(EDITOR_ROLES as readonly string[]).includes(user.role)) return null;
  return { id: user.id, role: user.role, workspaceId: user.workspaceId };
}

function toRunStatusView(run: AgentRun): RunStatusView {
  return {
    id: run.id,
    status: run.status,
    skill: run.skill,
    skillVersion: run.skillVersion,
    provider: run.provider,
    modelId: run.modelId,
    targetArtifactId: run.targetArtifactId,
    targetType: run.targetType,
    targetKey: run.targetKey,
    instruction: run.instruction,
    validations: run.validations ?? null,
    usage: run.usage ?? null,
    errorDetail: run.errorDetail,
    createdAtIso: run.createdAt.toISOString(),
    finishedAtIso: run.finishedAt ? run.finishedAt.toISOString() : null,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) =>
        issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      )
      .join(" · ");
  }
  if (isAgentsDomainError(error) || isLlmProviderError(error)) {
    return error.message;
  }
  console.error("[agents/assistant] unexpected error:", error);
  return "Error inesperado del asistente.";
}

/** El proyecto debe existir y pertenecer al workspace activo del actor. */
async function assertProjectAccess(projectId: string, actor: AgentActor): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  return rows[0]?.workspaceId === actor.workspaceId;
}

/**
 * Datos frescos para el panel al abrirse: keys del workspace (solo
 * id/label/last4, §19) + estado de los artefactos del proyecto (avisos de
 * draft sin sellar §8.6 y opciones de target).
 */
export async function getAssistantContextAction(
  projectId: string,
): Promise<AssistantActionResult<AssistantContextData>> {
  const actor = await requireEditor();
  if (!actor) {
    return { ok: false, error: "Requiere sesión con rol admin o member." };
  }
  try {
    if (!(await assertProjectAccess(projectId, actor))) {
      return { ok: false, error: "El proyecto no pertenece a tu workspace activo." };
    }

    const db = getDb();
    const [keys, rows] = await Promise.all([
      listKeys(actor.workspaceId, actor),
      db
        .select({
          id: artifacts.id,
          type: artifacts.type,
          key: artifacts.key,
          status: artifacts.status,
          currentVersion: artifacts.currentVersion,
          draftPayload: artifacts.draftPayload,
          proposedByRunId: artifacts.proposedByRunId,
        })
        .from(artifacts)
        .where(and(eq(artifacts.projectId, projectId), isNull(artifacts.deletedAt))),
    ]);

    const artifactInfos: AssistantArtifactInfo[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      key: row.key,
      label: getArtifactTypeOrNull(row.type)?.label ?? row.type,
      status: row.status,
      currentVersion: row.currentVersion,
      hasDraft: row.draftPayload != null,
      proposedByRun: row.proposedByRunId != null,
    }));

    return {
      ok: true,
      data: {
        keys: keys.map((key) => ({
          id: key.id,
          provider: key.provider,
          label: key.label,
          last4: key.last4,
          validated: key.lastValidatedAt != null,
        })),
        artifacts: artifactInfos,
      },
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export interface StartSkillRunInput {
  projectId: string;
  /** Nombre de una de las 5 skills (§9.3) — lista cerrada del registry. */
  skillName: string;
  provider: LlmProviderKind;
  /** Params crudos: los valida el Zod de la skill ANTES de crear nada. */
  params: Record<string, unknown>;
  /** Key concreta del workspace; por defecto la más reciente del proveedor. */
  keyId?: string | null;
}

/**
 * Lanza un agent run: bind de la skill (Zod sobre params) + `startRun`
 * (fila `queued`, ejecución async). La UI hace polling con
 * {@link getAgentRunStatusAction}. El run produce una PROPUESTA (§8.6);
 * aprobarla o rechazarla es SIEMPRE una decisión humana vía artifacts.
 */
export async function startSkillRunAction(
  input: StartSkillRunInput,
): Promise<AssistantActionResult<RunStatusView>> {
  const actor = await requireEditor();
  if (!actor) {
    return { ok: false, error: "Requiere sesión con rol admin o member." };
  }
  if (!isSkillName(input.skillName)) {
    return { ok: false, error: `Skill desconocida: ${input.skillName}.` };
  }
  try {
    const bound = bindSkillForRun(getSkill(input.skillName), input.params);
    const run = await startRun(
      {
        projectId: input.projectId,
        skill: bound.definition,
        provider: input.provider,
        targetType: bound.target.type,
        targetKey: bound.target.key,
        instruction: bound.instruction,
        keyId: input.keyId ?? null,
      },
      actor,
    );
    return { ok: true, data: toRunStatusView(run) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Estado actual de un run (polling ligero del panel, ~1.5 s). */
export async function getAgentRunStatusAction(
  runId: string,
): Promise<AssistantActionResult<RunStatusView>> {
  const actor = await requireEditor();
  if (!actor) {
    return { ok: false, error: "Requiere sesión con rol admin o member." };
  }
  try {
    const run = await getAgentRun(runId);
    if (!run || run.workspaceId !== actor.workspaceId) {
      return { ok: false, error: "El run no existe en tu workspace." };
    }
    return { ok: true, data: toRunStatusView(run) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
