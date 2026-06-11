/**
 * Auth constants shared between the session provider and `src/proxy.ts`.
 *
 * This file must stay dependency-free: the proxy runs before the app and must
 * not pull in the DB client or any provider code (see Next.js proxy docs —
 * "you should not attempt relying on shared modules or globals").
 */

/** httpOnly cookie holding the raw session token (only its hash is stored in DB). */
export const SESSION_COOKIE = "aw_session";

/** httpOnly cookie holding the slug of the user's active workspace. */
export const ACTIVE_WORKSPACE_COOKIE = "aw_active_workspace";

/** Session lifetime: 30 days. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
