import { cache } from "react";

import type { WorkspaceRole } from "@/db/schema";

import { localAuthProvider } from "./local-provider";

/**
 * Auth adapter (§18.6).
 *
 * Every product module talks to auth EXCLUSIVELY through this file. The
 * concrete provider (today: the local dev provider; later: Clerk) is an
 * implementation detail selected here and never imported anywhere else.
 */

/** Authenticated identity without workspace context (e.g. during onboarding). */
export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

/** Authenticated identity in the context of the active workspace. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  /** Role of the user in the active workspace. */
  role: WorkspaceRole;
  workspaceId: string;
  workspaceSlug: string;
};

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_in_use"
  | "invalid_email"
  | "weak_password"
  | "invalid_name";

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: AuthErrorCode };

/**
 * Contract every auth provider must implement. Clerk will land behind this
 * exact interface (§18.6); no product module may import a provider directly.
 */
export interface AuthAdapter {
  /**
   * Identity + active-workspace context, or `null` when there is no valid
   * session OR the user belongs to no workspace yet (use `getAuthUser()`
   * for onboarding flows that run before the first workspace exists).
   */
  getSessionUser(): Promise<SessionUser | null>;
  /** Identity only, `null` when there is no valid session. */
  getAuthUser(): Promise<AuthUser | null>;
  /** Verifies credentials and establishes a session (sets the cookie). */
  signIn(email: string, password: string): Promise<AuthResult>;
  /** Creates the account and establishes a session (sets the cookie). */
  signUp(email: string, password: string, name: string): Promise<AuthResult>;
  /** Destroys the current session and clears auth cookies. */
  signOut(): Promise<void>;
  /**
   * Marks a workspace as the active one for the current user.
   * Throws if there is no session or the user is not a member.
   */
  setActiveWorkspace(workspaceSlug: string): Promise<void>;
}

/**
 * Active provider selection. Single provider today; when Clerk arrives it
 * will be chosen here (e.g. via `AUTH_PROVIDER` env) behind the same interface.
 */
function getProvider(): AuthAdapter {
  return localAuthProvider;
}

/**
 * Per-request memoized session lookup. Layouts, pages and actions can all
 * call this freely within the same request without extra DB round-trips.
 */
export const getSessionUser = cache(
  async (): Promise<SessionUser | null> => getProvider().getSessionUser(),
);

/** Per-request memoized identity lookup (no workspace required). */
export const getAuthUser = cache(
  async (): Promise<AuthUser | null> => getProvider().getAuthUser(),
);

export async function signIn(
  email: string,
  password: string,
): Promise<AuthResult> {
  return getProvider().signIn(email, password);
}

export async function signUp(
  email: string,
  password: string,
  name: string,
): Promise<AuthResult> {
  return getProvider().signUp(email, password, name);
}

export async function signOut(): Promise<void> {
  return getProvider().signOut();
}

export async function setActiveWorkspace(
  workspaceSlug: string,
): Promise<void> {
  return getProvider().setActiveWorkspace(workspaceSlug);
}
