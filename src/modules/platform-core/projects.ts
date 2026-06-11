import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { newId } from "@/db/ids";
import { projects, type Project } from "@/db/schema";
// Built in parallel by the artifacts module with this exact export name:
// instantiates the fixed artifact graph (§8.4) for a fresh project.
import { ensureProjectArtifacts } from "@/modules/artifacts/service";

import { logAudit } from "./audit";
import { INTERNAL_ROLES } from "./roles";
import { assertWorkspaceRole } from "./workspaces";

/**
 * Project services (§14 platform core). Every mutation is authorized against
 * the workspace membership and recorded in the audit log; deletion is always
 * soft (restricción §19).
 */

/**
 * Creates a project in the workspace and instantiates its artifact set.
 * `actorId` must be an internal member (admin | member) of the workspace —
 * `client` users cannot create projects (§14).
 */
export async function createProject(
  workspaceId: string,
  name: string,
  actorId: string,
): Promise<Project> {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) throw new Error("Project name is required");

  await assertWorkspaceRole(workspaceId, actorId, INTERNAL_ROLES);

  const db = getDb();
  const project = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(projects)
      .values({ id: newId.project(), workspaceId, name: trimmedName })
      .returning();
    const created = inserted[0];

    await logAudit(
      {
        workspaceId,
        projectId: created.id,
        actorId,
        action: "project.created",
        entityType: "project",
        entityId: created.id,
        detail: { name: trimmedName },
      },
      tx,
    );

    return created;
  });

  // Instantiate the fixed artifact graph for the new project (artifacts module).
  await ensureProjectArtifacts(project.id);

  return project;
}

/** Live (non-deleted) projects of a workspace, newest first. */
export async function listProjects(workspaceId: string): Promise<Project[]> {
  return getDb()
    .select()
    .from(projects)
    .where(
      and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)),
    )
    .orderBy(desc(projects.createdAt));
}

/** Project by id, or null when missing or soft-deleted. */
export async function getProjectById(
  projectId: string,
): Promise<Project | null> {
  const rows = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** Archives a project (status flip, fully reversible). Internal members only. */
export async function archiveProject(
  projectId: string,
  actorId: string,
): Promise<Project> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  await assertWorkspaceRole(project.workspaceId, actorId, INTERNAL_ROLES);

  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(projects)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();

    await logAudit(
      {
        workspaceId: project.workspaceId,
        projectId,
        actorId,
        action: "project.archived",
        entityType: "project",
        entityId: projectId,
      },
      tx,
    );

    return rows[0];
  });
}

/** Soft-deletes a project (admin only). Versions and audit trail remain. */
export async function softDeleteProject(
  projectId: string,
  actorId: string,
): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  await assertWorkspaceRole(project.workspaceId, actorId, ["admin"]);

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));

    await logAudit(
      {
        workspaceId: project.workspaceId,
        projectId,
        actorId,
        action: "project.deleted",
        entityType: "project",
        entityId: projectId,
      },
      tx,
    );
  });
}
