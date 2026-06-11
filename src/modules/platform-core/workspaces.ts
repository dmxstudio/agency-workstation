import { and, asc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { newId } from "@/db/ids";
import {
  workspaceMembers,
  workspaces,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from "@/db/schema";

import { logAudit } from "./audit";
import { ForbiddenError } from "./roles";

/**
 * Workspace services (§14 platform core). Authorization is enforced here in
 * addition to the calling server action (defense in depth); every mutation
 * writes to the audit log.
 */

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`Workspace slug "${slug}" is already taken`);
    this.name = "SlugTakenError";
  }
}

export class InvalidSlugError extends Error {
  constructor(slug: string) {
    super(`Invalid workspace slug "${slug}"`);
    this.name = "InvalidSlugError";
  }
}

/** Lowercase alphanumerics and hyphens, no leading/trailing hyphen, 1-48 chars. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function isValidWorkspaceSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** Derives a URL-safe slug from a display name (e.g. "Mi Agencia" → "mi-agencia"). */
export function slugifyWorkspaceName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** Role of `userId` in `workspaceId`, or null when not a member. */
export async function getWorkspaceRole(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const rows = await getDb()
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

/** Throws `ForbiddenError` unless `userId` has one of `roles` in the workspace. */
export async function assertWorkspaceRole(
  workspaceId: string,
  userId: string,
  roles: readonly WorkspaceRole[],
): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (!role || !roles.includes(role)) {
    throw new ForbiddenError(
      `User ${userId} lacks role (${roles.join("|")}) in workspace ${workspaceId}`,
    );
  }
  return role;
}

/**
 * Creates a workspace; the owner becomes `admin`. Atomic: workspace row,
 * owner membership and audit events commit together.
 */
export async function createWorkspace(
  name: string,
  slug: string,
  ownerUserId: string,
): Promise<Workspace> {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) throw new Error("Workspace name is required");
  if (!isValidWorkspaceSlug(slug)) throw new InvalidSlugError(slug);

  const db = getDb();
  // Slug uniqueness is total (includes soft-deleted workspaces) per schema.
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (existing.length > 0) throw new SlugTakenError(slug);

  const workspace: Workspace = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(workspaces)
      .values({ id: newId.workspace(), slug, name: trimmedName })
      .returning();
    const ws = inserted[0];

    await tx.insert(workspaceMembers).values({
      workspaceId: ws.id,
      userId: ownerUserId,
      role: "admin",
    });

    await logAudit(
      {
        workspaceId: ws.id,
        actorId: ownerUserId,
        action: "workspace.created",
        entityType: "workspace",
        entityId: ws.id,
        detail: { name: trimmedName, slug },
      },
      tx,
    );
    await logAudit(
      {
        workspaceId: ws.id,
        actorId: ownerUserId,
        action: "workspace.member_added",
        entityType: "workspace_member",
        entityId: ownerUserId,
        detail: { role: "admin", userId: ownerUserId },
      },
      tx,
    );

    return ws;
  });

  return workspace;
}

/**
 * Adds (or re-roles) a member. Only workspace admins may manage members.
 * Idempotent: re-adding an existing member updates their role.
 */
export async function addMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  actorId: string,
): Promise<WorkspaceMember> {
  await assertWorkspaceRole(workspaceId, actorId, ["admin"]);

  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role },
      })
      .returning();

    await logAudit(
      {
        workspaceId,
        actorId,
        action: "workspace.member_added",
        entityType: "workspace_member",
        entityId: userId,
        detail: { role, userId },
      },
      tx,
    );

    return rows[0];
  });
}

/**
 * Workspace by slug WITH membership check: returns null when the workspace
 * does not exist, is soft-deleted, or `userId` is not a member.
 */
export async function getWorkspaceBySlug(
  slug: string,
  userId: string,
): Promise<{ workspace: Workspace; role: WorkspaceRole } | null> {
  const rows = await getDb()
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.workspaceId, workspaces.id),
    )
    .where(
      and(
        eq(workspaces.slug, slug),
        isNull(workspaces.deletedAt),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** All live workspaces the user belongs to (for the workspace switcher). */
export async function listWorkspacesForUser(
  userId: string,
): Promise<Array<{ workspace: Workspace; role: WorkspaceRole }>> {
  return getDb()
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)),
    )
    .orderBy(asc(workspaceMembers.createdAt));
}

/** Soft-deletes a workspace (admin only). Memberships stay for the audit trail. */
export async function softDeleteWorkspace(
  workspaceId: string,
  actorId: string,
): Promise<void> {
  await assertWorkspaceRole(workspaceId, actorId, ["admin"]);

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(workspaces)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));

    await logAudit(
      {
        workspaceId,
        actorId,
        action: "workspace.deleted",
        entityType: "workspace",
        entityId: workspaceId,
      },
      tx,
    );
  });
}
