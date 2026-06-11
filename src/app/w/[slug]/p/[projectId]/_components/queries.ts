import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  tasks,
  users,
  workspaceMembers,
  type Artifact,
  type Task,
  type User,
  type WorkspaceRole,
} from "@/db/schema";

/**
 * Cockpit-only read helpers. The task/member domain has no module service
 * yet (§12.2 is screen-scoped in this MVP slice); when more screens need
 * tasks, this should move into a module (see openIssues of this phase).
 */

export type ProjectTask = Task & {
  assignee: User | null;
  artifact: Artifact | null;
};

/** Open tasks of a project (derived + manual), newest first. */
export async function getOpenProjectTasks(projectId: string): Promise<ProjectTask[]> {
  const db = getDb();
  return db.query.tasks.findMany({
    where: and(
      eq(tasks.projectId, projectId),
      eq(tasks.status, "open"),
      isNull(tasks.deletedAt),
    ),
    with: { assignee: true, artifact: true },
    orderBy: [desc(tasks.createdAt)],
  });
}

export type WorkspaceMemberInfo = {
  user: User;
  role: WorkspaceRole;
};

/** Live members of a workspace (assignee options, owner name resolution). */
export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMemberInfo[]> {
  const db = getDb();
  return db
    .select({ user: users, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));
}
