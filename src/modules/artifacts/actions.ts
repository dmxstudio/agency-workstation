"use server";

import { getSessionUser } from "@/modules/platform-core/auth/adapter";

import { ArtifactValidationError, isArtifactDomainError, type ArtifactErrorCode, type ValidationIssue } from "./errors";
import {
  approve,
  computeDiff,
  ensureProjectArtifacts,
  getArtifactWithHistory,
  getPhaseGates,
  getProjectArtifacts,
  lockArtifact,
  reject,
  revalidate,
  saveDraft,
  submitForReview,
  syncCompositionArtifacts,
  unlockArtifact,
  type ApproveResult,
  type ArtifactWithHistory,
  type ComputeDiffOptions,
  type ComputedDiff,
  type HumanActor,
  type PhaseGate,
  type ProjectArtifact,
  type SyncCompositionsResult,
} from "./service";
import type { Artifact } from "@/db/schema";

/**
 * Thin server actions over the artifacts service (§19.5: screens never hit
 * the DB directly). The actor is ALWAYS the authenticated session user from
 * the platform-core auth adapter — agent runs have no way in here, which is
 * what makes "an agent run can never approve" true by construction.
 *
 * Cache revalidation (`revalidatePath`) is intentionally left to the calling
 * screens, which know their own routes.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: ArtifactErrorCode; issues?: ValidationIssue[] };

async function requireActor(): Promise<HumanActor | null> {
  const user = await getSessionUser();
  return user ?? null;
}

async function run<T>(fn: (actor: HumanActor) => Promise<T>): Promise<ActionResult<T>> {
  const actor = await requireActor();
  if (!actor) {
    return { ok: false, error: "No has iniciado sesión.", code: "FORBIDDEN" };
  }
  try {
    return { ok: true, data: await fn(actor) };
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      return { ok: false, error: error.message, code: error.code, issues: error.issues };
    }
    if (isArtifactDomainError(error)) {
      return { ok: false, error: error.message, code: error.code };
    }
    console.error("[artifacts] unexpected error:", error);
    return { ok: false, error: "Error inesperado al operar sobre el artefacto." };
  }
}

/** Instancia el grafo MVP de artefactos para un proyecto (idempotente). */
export async function ensureProjectArtifactsAction(
  projectId: string,
): Promise<ActionResult<Artifact[]>> {
  return run((actor) => ensureProjectArtifacts(projectId, actor));
}

/**
 * Deriva los artefactos `page.composition` (uno por página, keyed por path)
 * del sitemap APROBADO: crea los que falten y marca como `outdated` (con
 * tarea derivada) los de páginas que salieron del sitemap — nunca los borra.
 */
export async function syncCompositionArtifactsAction(
  projectId: string,
): Promise<ActionResult<SyncCompositionsResult>> {
  return run((actor) => syncCompositionArtifacts(projectId, actor));
}

/** Valida (Zod) y guarda el borrador; `empty|approved → draft`. */
export async function saveDraftAction(
  artifactId: string,
  payload: unknown,
): Promise<ActionResult<Artifact>> {
  return run((actor) => saveDraft(artifactId, payload, actor));
}

/** `draft → in_review` + tarea derivada de revisión. */
export async function submitForReviewAction(artifactId: string): Promise<ActionResult<Artifact>> {
  return run((actor) => submitForReview(artifactId, actor));
}

/**
 * Aprueba (solo humano con rol admin|member): sella versión inmutable,
 * propaga `outdated` a dependientes (marca, nunca regenera) y cierra tareas.
 */
export async function approveArtifactAction(
  artifactId: string,
  comment?: string,
): Promise<ActionResult<ApproveResult>> {
  return run((actor) => approve(artifactId, actor, comment));
}

/** `in_review → draft` con flag `rejected` y feedback en el audit log. */
export async function rejectArtifactAction(
  artifactId: string,
  feedback: string,
): Promise<ActionResult<Artifact>> {
  return run((actor) => reject(artifactId, feedback, actor));
}

/** "Revalidar sin cambios" (§17-R6): limpia `outdated` y cierra su tarea. */
export async function revalidateArtifactAction(
  artifactId: string,
): Promise<ActionResult<Artifact>> {
  return run((actor) => revalidate(artifactId, actor));
}

/** Bloquea un artefacto aprobado (gate de fase o lock manual, §8.2). */
export async function lockArtifactAction(
  artifactId: string,
  lockedBy?: string,
): Promise<ActionResult<Artifact>> {
  return run((actor) => lockArtifact(artifactId, actor, lockedBy));
}

/** Desbloqueo explícito: vuelve a `approved` y marca dependientes `outdated`. */
export async function unlockArtifactAction(artifactId: string): Promise<ActionResult<Artifact>> {
  return run((actor) => unlockArtifact(artifactId, actor));
}

/** Artefacto + versiones inmutables + aprobaciones (historial). */
export async function getArtifactWithHistoryAction(
  artifactId: string,
): Promise<ActionResult<ArtifactWithHistory>> {
  return run(() => getArtifactWithHistory(artifactId));
}

/** Artefactos del proyecto con estados, flags y aristas (Cockpit). */
export async function getProjectArtifactsAction(
  projectId: string,
): Promise<ActionResult<ProjectArtifact[]>> {
  return run(() => getProjectArtifacts(projectId));
}

/** Diff estructural draft↔última versión aprobada, o entre dos versiones. */
export async function computeDiffAction(
  artifactId: string,
  options?: ComputeDiffOptions,
): Promise<ActionResult<ComputedDiff>> {
  return run(() => computeDiff(artifactId, options));
}

/** Gates de fase (§8.5) para el Cockpit. */
export async function getPhaseGatesAction(projectId: string): Promise<ActionResult<PhaseGate[]>> {
  return run(() => getPhaseGates(projectId));
}
