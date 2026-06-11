import type { WorkspaceRole } from "@/db/schema";

import type { SessionUser } from "./auth/adapter";

/**
 * Role enforcement helpers (§14: roles admin | member | client).
 *
 * The `client` role does NOT access anything in the current MVP except a
 * placeholder screen — its review surface arrives in a later phase (§7.7).
 * Enforcement is ready here: pages and server actions call
 * `requireInternalUser` / `requireRole` before touching project data.
 */

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Roles that may use the internal product surface in the MVP. */
export const INTERNAL_ROLES = ["admin", "member"] as const satisfies readonly WorkspaceRole[];

export function hasRole(
  user: SessionUser,
  ...roles: WorkspaceRole[]
): boolean {
  return roles.includes(user.role);
}

/**
 * Asserts the active-workspace role is one of `roles`; returns the user for
 * chaining. Throws `ForbiddenError` otherwise.
 */
export function requireRole(
  user: SessionUser,
  ...roles: WorkspaceRole[]
): SessionUser {
  if (!roles.includes(user.role)) {
    throw new ForbiddenError(
      `Role "${user.role}" is not allowed (requires: ${roles.join(", ")})`,
    );
  }
  return user;
}

/**
 * Asserts the user is internal (admin | member). `client` users are excluded
 * from the whole internal MVP surface (§14).
 */
export function requireInternalUser(user: SessionUser): SessionUser {
  return requireRole(user, ...INTERNAL_ROLES);
}

/** Asserts the user is a workspace admin. */
export function requireAdmin(user: SessionUser): SessionUser {
  return requireRole(user, "admin");
}
