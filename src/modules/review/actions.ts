"use server";

import type { ClientApproval, ReviewComment, ReviewRequest } from "@/db/schema";
import { isArtifactDomainError, type ReleaseChecklistItem } from "@/modules/artifacts";
import { isGeneratorDomainError } from "@/modules/generator";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";

import { isReviewDomainError } from "./errors";
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
  type AddClientApprovalInput,
  type AddClientCommentInput,
  type AddTeamCommentInput,
  type CreateReleaseResult,
  type HumanActor,
  type ReviewRequestSummary,
  type ReviewSurface,
} from "./service";

/**
 * Server actions of the review module (§19.5: screens never hit the DB).
 *
 * TWO surfaces, deliberately separated (§13):
 * - INTERNAL: the actor is ALWAYS the authenticated session user (auth
 *   adapter) with role enforcement in the service. Sealing releases runs
 *   through the artifacts service — an agent run can never reach it.
 * - PUBLIC (client, R8): NO session. The ONLY credential is the review token,
 *   which the service validates against the DB on every call; client-supplied
 *   ids (pages, parent comments) are always re-validated against the round.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function toError<T>(error: unknown, fallback: string): ActionResult<T> {
  // ArtifactValidationError extiende ArtifactDomainError: cubierto aquí.
  if (
    isReviewDomainError(error) ||
    isArtifactDomainError(error) ||
    isGeneratorDomainError(error)
  ) {
    return { ok: false, error: error.message, code: error.code };
  }
  console.error("[review] unexpected error:", error);
  return { ok: false, error: fallback };
}

// ---------------------------------------------------------------------------
// Internal surface (session + role)
// ---------------------------------------------------------------------------

async function runInternal<T>(
  fn: (actor: HumanActor) => Promise<T>,
): Promise<ActionResult<T>> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, error: "No has iniciado sesión.", code: "FORBIDDEN" };
  }
  try {
    return { ok: true, data: await fn(user) };
  } catch (error) {
    return toError(error, "Error inesperado en la operación de review.");
  }
}

/** Checklist §7.8 (solo lectura; el deploy provider valida el build aparte). */
export async function runReleaseChecklistAction(
  projectId: string,
): Promise<ActionResult<ReleaseChecklistItem[]>> {
  return runInternal(() => runReleaseChecklist(projectId));
}

/**
 * Crea el release N: checklist en verde + confirmación humana (esta llamada).
 * Sella versión inmutable vía artifacts y tagea `release-N` en el repo.
 */
export async function createReleaseAction(
  projectId: string,
  notes: string,
): Promise<ActionResult<CreateReleaseResult>> {
  return runInternal((actor) => createRelease(projectId, notes, actor));
}

/** Abre una ronda de revisión sobre una versión sellada de release. */
export async function createReviewRequestAction(
  projectId: string,
  releaseVersion: number,
  label: string,
): Promise<ActionResult<ReviewRequest>> {
  return runInternal((actor) => createReviewRequest(projectId, releaseVersion, label, actor));
}

/** Rondas del proyecto con contadores (gestión interna). */
export async function listReviewRequestsAction(
  projectId: string,
): Promise<ActionResult<ReviewRequestSummary[]>> {
  return runInternal(() => listReviewRequests(projectId));
}

/** Comentario/respuesta del equipo en una ronda abierta. */
export async function addTeamCommentAction(
  requestId: string,
  input: AddTeamCommentInput,
): Promise<ActionResult<ReviewComment>> {
  return runInternal((actor) => addTeamComment(requestId, input, actor));
}

/** Resuelve un comentario y cierra su tarea derivada (§12.2). */
export async function resolveCommentAction(
  commentId: string,
): Promise<ActionResult<ReviewComment>> {
  return runInternal((actor) => resolveComment(commentId, actor));
}

/** Cierra la ronda: el token deja de aceptar mutaciones. */
export async function closeReviewRequestAction(
  requestId: string,
): Promise<ActionResult<ReviewRequest>> {
  return runInternal((actor) => closeReviewRequest(requestId, actor));
}

// ---------------------------------------------------------------------------
// Public surface (client by token — NO session; token validated in DB)
// ---------------------------------------------------------------------------

async function runPublic<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return toError(error, "Error inesperado al acceder a la revisión.");
  }
}

/** Superficie completa de la ronda para el cliente (lectura pública). */
export async function getReviewByTokenAction(
  token: string,
): Promise<ActionResult<ReviewSurface>> {
  return runPublic(() => getReviewByToken(token));
}

/** Comentario del cliente: crea la tarea derivada de resolución (§12.2). */
export async function addClientCommentAction(
  token: string,
  input: AddClientCommentInput,
): Promise<ActionResult<ReviewComment>> {
  return runPublic(() => addClientComment(token, input));
}

/**
 * Aprobación de cliente (§8.5): tipo distinto, sobre la versión de release de
 * la ronda (o una página). Nunca transiciona artefactos internos.
 */
export async function addClientApprovalAction(
  token: string,
  input: AddClientApprovalInput,
): Promise<ActionResult<ClientApproval>> {
  return runPublic(() => addClientApproval(token, input));
}
