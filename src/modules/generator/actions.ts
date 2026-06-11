"use server";

import { getSessionUser } from "@/modules/platform-core/auth/adapter";

import { isGeneratorDomainError, type GeneratorErrorCode } from "./errors";
import {
  generateProject,
  getGenerationRequirements,
  getGenerations,
  regenerateProject,
  type GenerationRequirement,
  type GenerationResult,
  type GenerationWithActor,
  type HumanActor,
} from "./service";

/**
 * Thin server actions over the generator service (§19.5: screens never hit
 * the DB or the filesystem directly). The actor is ALWAYS the authenticated
 * session user from the platform-core auth adapter; generation and
 * regeneration require role admin|member (enforced in the service).
 *
 * Cache revalidation (`revalidatePath`) is intentionally left to the calling
 * screens, which know their own routes.
 */

export type GeneratorActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: GeneratorErrorCode; details?: unknown };

async function run<T>(fn: (actor: HumanActor) => Promise<T>): Promise<GeneratorActionResult<T>> {
  const actor = await getSessionUser();
  if (!actor) {
    return { ok: false, error: "No has iniciado sesión.", code: "FORBIDDEN" };
  }
  try {
    return { ok: true, data: await fn(actor) };
  } catch (error) {
    if (isGeneratorDomainError(error)) {
      return { ok: false, error: error.message, code: error.code, details: error.details };
    }
    console.error("[generator] unexpected error:", error);
    return { ok: false, error: "Error inesperado al generar el proyecto." };
  }
}

/**
 * Genera el proyecto por primera vez: copia el template, renderiza el codegen
 * desde los artefactos aprobados, escribe el manifest de ownership y crea el
 * repo git con su commit inicial. NO instala dependencias (eso lo hace el
 * usuario con `npm install` dentro del proyecto generado).
 */
export async function generateProjectAction(
  projectId: string,
): Promise<GeneratorActionResult<GenerationResult>> {
  return run((actor) => generateProject(projectId, actor));
}

/**
 * Regeneración parcial (§18.2): SOLO toca archivos owned-by-codegen, reporta
 * conflictos (nunca los resuelve) y es idempotente. Commit solo si hubo cambios.
 */
export async function regenerateProjectAction(
  projectId: string,
): Promise<GeneratorActionResult<GenerationResult>> {
  return run((actor) => regenerateProject(projectId, actor));
}

/** Historial de generaciones del proyecto (más recientes primero). */
export async function getGenerationsAction(
  projectId: string,
): Promise<GeneratorActionResult<GenerationWithActor[]>> {
  return run(() => getGenerations(projectId));
}

/** Checklist de artefactos requeridos/opcionales para poder generar (§7.3). */
export async function getGenerationRequirementsAction(
  projectId: string,
): Promise<GeneratorActionResult<GenerationRequirement[]>> {
  return run(() => getGenerationRequirements(projectId));
}
