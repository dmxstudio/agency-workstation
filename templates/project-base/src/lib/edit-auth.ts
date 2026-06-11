import { cookies } from "next/headers";

/**
 * Basic edit-access check for the standalone Puck editor (/edit).
 *
 * MVP semantics:
 * - If the EDIT_TOKEN env var is NOT set, access is open (local development).
 * - If it is set, the browser must hold an httpOnly cookie with the token,
 *   obtained via GET /api/edit-session?token=<EDIT_TOKEN>.
 *
 * The platform will later govern compositions as artifacts with real roles;
 * this gate only protects the standalone editor of the generated project.
 */

export const EDIT_COOKIE = "edit_token";

/** Returns the required token, or null when access is open. */
export function requiredEditToken(): string | null {
  const token = process.env.EDIT_TOKEN?.trim();
  return token ? token : null;
}

export function isValidEditToken(token: string | undefined | null): boolean {
  const required = requiredEditToken();
  if (!required) return true;
  return token === required;
}

/** True when the current request may use the editor (cookie or open access). */
export async function hasEditAccess(): Promise<boolean> {
  const required = requiredEditToken();
  if (!required) return true;
  const jar = await cookies();
  return jar.get(EDIT_COOKIE)?.value === required;
}

/** Guard for mutating Server Actions. */
export async function assertEditAccess(): Promise<void> {
  if (!(await hasEditAccess())) {
    throw new Error("No autorizado: falta el token de edición (EDIT_TOKEN).");
  }
}
