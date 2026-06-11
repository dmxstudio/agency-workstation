import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

import { and, asc, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { getDb } from "@/db/client";
import { newId } from "@/db/ids";
import {
  sessions,
  users,
  workspaceMembers,
  workspaces,
  type User,
} from "@/db/schema";

import type {
  AuthAdapter,
  AuthResult,
  AuthUser,
  SessionUser,
} from "./adapter";
import {
  ACTIVE_WORKSPACE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "./constants";

/**
 * LOCAL DEVELOPMENT auth provider.
 *
 * Email + password with `node:crypto` scrypt (random salt, parameters encoded
 * in the stored hash) and DB-backed sessions: a random token lives only in an
 * httpOnly cookie while its SHA-256 hash is stored in the `sessions` table.
 *
 * This provider exists so the platform works end-to-end without external
 * services. Clerk will arrive behind the SAME `AuthAdapter` interface (§18.6);
 * no product module may import this file directly — always
 * `@/modules/platform-core/auth/adapter`.
 *
 * Node runtime only (it reaches the DB through `getDb()`): never import this
 * from `src/proxy.ts` or any edge context.
 */

// ---------------------------------------------------------------------------
// Password hashing (scrypt + salt, parameters self-described in the hash)
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, params, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Format: `scrypt:<N>:<r>:<p>:<salt b64>:<hash b64>`. */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join(":");
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(
    password,
    Buffer.from(saltB64, "base64"),
    expected.length,
    { N, r, p },
  );
  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  );
}

// ---------------------------------------------------------------------------
// Session tokens (raw token in cookie, SHA-256 hash in DB)
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const sessionCookieOptions = {
  httpOnly: true,
  // `secure` cookies are rejected over plain http by some browsers, so only
  // enforce it in production (localhost dev runs over http).
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
} as const;

/** Creates a DB session for the user and sets the session cookie. */
async function establishSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await getDb().insert(sessions).values({
    id: newId.session(),
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions);
}

/**
 * Resolves the cookie token to a live (non-expired) user. Expired session
 * rows are deleted opportunistically on read.
 */
async function readSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  if (row.session.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  if (row.user.deletedAt) return null;
  return row.user;
}

// ---------------------------------------------------------------------------
// Input validation (provider-level guarantees; actions add Spanish messages)
// ---------------------------------------------------------------------------

const emailSchema = z.email();
const passwordSchema = z.string().min(8).max(256);
const nameSchema = z.string().trim().min(2).max(120);

function toAuthUser(user: User): AuthUser {
  return { id: user.id, email: user.email, name: user.name };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const localAuthProvider: AuthAdapter = {
  async getAuthUser(): Promise<AuthUser | null> {
    const user = await readSessionUser();
    return user ? toAuthUser(user) : null;
  },

  async getSessionUser(): Promise<SessionUser | null> {
    const user = await readSessionUser();
    if (!user) return null;

    const db = getDb();
    const memberships = await db
      .select({ membership: workspaceMembers, workspace: workspaces })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(eq(workspaceMembers.userId, user.id), isNull(workspaces.deletedAt)),
      )
      .orderBy(asc(workspaceMembers.createdAt));
    if (memberships.length === 0) return null;

    const cookieStore = await cookies();
    const preferredSlug = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
    const active =
      memberships.find((m) => m.workspace.slug === preferredSlug) ??
      memberships[0];

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: active.membership.role,
      workspaceId: active.workspace.id,
      workspaceSlug: active.workspace.slug,
    };
  },

  async signIn(email: string, password: string): Promise<AuthResult> {
    const parsedEmail = emailSchema.safeParse(email.trim().toLowerCase());
    if (!parsedEmail.success) return { ok: false, error: "invalid_credentials" };

    const db = getDb();
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.email, parsedEmail.data), isNull(users.deletedAt)))
      .limit(1);
    const user = rows[0];
    if (!user) return { ok: false, error: "invalid_credentials" };

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return { ok: false, error: "invalid_credentials" };

    await establishSession(user.id);
    return { ok: true, user: toAuthUser(user) };
  },

  async signUp(
    email: string,
    password: string,
    name: string,
  ): Promise<AuthResult> {
    const parsedEmail = emailSchema.safeParse(email.trim().toLowerCase());
    if (!parsedEmail.success) return { ok: false, error: "invalid_email" };
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedPassword.success) return { ok: false, error: "weak_password" };
    const parsedName = nameSchema.safeParse(name);
    if (!parsedName.success) return { ok: false, error: "invalid_name" };

    const db = getDb();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsedEmail.data))
      .limit(1);
    if (existing.length > 0) return { ok: false, error: "email_in_use" };

    const newUser = {
      id: newId.user(),
      email: parsedEmail.data,
      passwordHash: await hashPassword(parsedPassword.data),
      name: parsedName.data,
    };
    try {
      await db.insert(users).values(newUser);
    } catch {
      // Unique-violation race on email: treat as taken.
      return { ok: false, error: "email_in_use" };
    }

    await establishSession(newUser.id);
    return { ok: true, user: { id: newUser.id, email: newUser.email, name: newUser.name } };
  },

  async signOut(): Promise<void> {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (token) {
      await getDb()
        .delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(token)));
    }
    cookieStore.delete(SESSION_COOKIE);
    cookieStore.delete(ACTIVE_WORKSPACE_COOKIE);
  },

  async setActiveWorkspace(workspaceSlug: string): Promise<void> {
    const user = await readSessionUser();
    if (!user) throw new Error("No authenticated session");

    const db = getDb();
    const rows = await db
      .select({ workspaceId: workspaces.id })
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaces.id),
      )
      .where(
        and(
          eq(workspaces.slug, workspaceSlug),
          isNull(workspaces.deletedAt),
          eq(workspaceMembers.userId, user.id),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new Error(`User is not a member of workspace "${workspaceSlug}"`);
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceSlug, {
      ...sessionCookieOptions,
      maxAge: SESSION_TTL_SECONDS,
    });
  },
};
