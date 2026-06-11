"use server";

import { getSessionUser } from "@/modules/platform-core/auth/adapter";

import { isDeployDomainError } from "./errors";
import { DEPLOY_SLOTS, type DeploySlot } from "./provider";
import {
  deployRelease,
  stopSlot,
  type DeployActor,
  type DeployOutcome,
  type StopSlotResult,
} from "./service";

/**
 * Server actions of the deploy module (§19.5: screens never hit the DB).
 *
 * GOVERNANCE (§13, §19): every action resolves the actor from the auth
 * session (adapter) — deploying and stopping slots are HUMAN actions with
 * role admin|member, enforced again in the service. There is no token/public
 * surface here, and no code path lets an agent run reach the provider.
 * The §7.8 checklist confirmation lives upstream: only SEALED releases
 * (created via `createRelease` after a green checklist + human confirmation)
 * are deployable — the service rejects anything else.
 *
 * NOTE: `deployReleaseAction` can take MINUTES on the first build of a
 * release (npm + next build inside the immutable build dir). The screen keeps
 * the transition pending and the `deployments` row is visible in `building`
 * for anyone re-entering the screen meanwhile.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function toError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (isDeployDomainError(error)) {
    return { ok: false, error: error.message, code: error.code };
  }
  console.error("[deploy] unexpected error:", error);
  return { ok: false, error: fallback };
}

async function runInternal<T>(
  fn: (actor: DeployActor) => Promise<T>,
): Promise<ActionResult<T>> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, error: "No has iniciado sesión.", code: "FORBIDDEN" };
  }
  try {
    return { ok: true, data: await fn(user) };
  } catch (error) {
    return toError(error, "Error inesperado en la operación de deploy.");
  }
}

/** Defensive: `slot` crosses the client boundary as plain data. */
function invalidSlot<T>(slot: unknown): ActionResult<T> | null {
  if ((DEPLOY_SLOTS as readonly unknown[]).includes(slot)) return null;
  return {
    ok: false,
    error: `Slot de deploy desconocido: «${String(slot)}».`,
    code: "VALIDATION_FAILED",
  };
}

/**
 * Despliega el release sellado vN en el slot (build inmutable reutilizable +
 * `next start` local). Rollback = invocarla con la versión anterior.
 */
export async function deployReleaseAction(
  projectId: string,
  releaseVersion: number,
  slot: DeploySlot,
): Promise<ActionResult<DeployOutcome>> {
  const bad = invalidSlot<DeployOutcome>(slot);
  if (bad) return bad;
  if (!Number.isInteger(releaseVersion) || releaseVersion < 1) {
    return {
      ok: false,
      error: `Versión de release inválida: «${String(releaseVersion)}».`,
      code: "VALIDATION_FAILED",
    };
  }
  return runInternal((actor) => deployRelease(projectId, releaseVersion, slot, actor));
}

/** Detiene el proceso del slot (idempotente; nunca toca procesos ajenos). */
export async function stopSlotAction(
  projectId: string,
  slot: DeploySlot,
): Promise<ActionResult<StopSlotResult>> {
  const bad = invalidSlot<StopSlotResult>(slot);
  if (bad) return bad;
  return runInternal((actor) => stopSlot(projectId, slot, actor));
}
