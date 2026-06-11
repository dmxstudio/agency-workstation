"use server";

import { refresh } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { newId } from "@/db/ids";
import { tasks, workspaceMembers, type Project } from "@/db/schema";
import { ensureProjectArtifacts, type HumanActor } from "@/modules/artifacts/service";
import { getSessionUser, type SessionUser } from "@/modules/platform-core/auth/adapter";
import { logAudit } from "@/modules/platform-core/audit";
import { getProjectById } from "@/modules/platform-core/projects";
import { INTERNAL_ROLES } from "@/modules/platform-core/roles";
import { getWorkspaceRole } from "@/modules/platform-core/workspaces";

/**
 * Server actions propias del Cockpit (tareas manuales §12.2 + reparación de
 * artefactos). Cada mutación valida sesión real, rol interno en el workspace
 * del proyecto, escribe audit log y refresca el router del cliente.
 */

export type TaskFormState = { error: string | null };

interface ProjectActorContext {
  user: SessionUser;
  project: Project;
  actor: HumanActor;
}

/**
 * Resolves the acting session user and verifies they hold an internal role
 * (admin|member) in the workspace that owns the project. Returns `null` on
 * any failure — callers translate that into their own error shape.
 */
async function resolveProjectActor(projectId: string): Promise<ProjectActorContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const project = await getProjectById(projectId);
  if (!project) return null;
  const role = await getWorkspaceRole(project.workspaceId, user.id);
  if (!role || !(INTERNAL_ROLES as readonly string[]).includes(role)) return null;
  return {
    user,
    project,
    actor: { id: user.id, role, workspaceId: project.workspaceId },
  };
}

/** Crea una tarea manual (título + responsable opcional) — §12.2. */
export async function createManualTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const assigneeRaw = String(formData.get("assigneeId") ?? "").trim();
  const assigneeId = assigneeRaw === "" ? null : assigneeRaw;

  const context = await resolveProjectActor(projectId);
  if (!context) {
    return { error: "No tienes permisos para crear tareas en este proyecto." };
  }
  if (title.length === 0) {
    return { error: "El título de la tarea es obligatorio." };
  }
  if (title.length > 200) {
    return { error: "El título no puede superar los 200 caracteres." };
  }

  const db = getDb();

  if (assigneeId) {
    const membership = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, context.project.workspaceId),
          eq(workspaceMembers.userId, assigneeId),
        ),
      )
      .limit(1);
    if (!membership[0]) {
      return { error: "El responsable seleccionado no es miembro del workspace." };
    }
  }

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(tasks)
      .values({
        id: newId.task(),
        projectId,
        kind: "manual",
        title,
        status: "open",
        assigneeId,
        artifactId: null,
        dedupeKey: null,
      })
      .returning();
    await logAudit(
      {
        workspaceId: context.project.workspaceId,
        projectId,
        actorId: context.user.id,
        action: "task.created",
        entityType: "task",
        entityId: inserted[0].id,
        detail: { title, kind: "manual", assigneeId },
      },
      tx,
    );
  });

  refresh();
  return { error: null };
}

/**
 * Marca una tarea MANUAL como completada. Las tareas derivadas nunca se
 * cierran a mano: reflejan estado real y se cierran solas (§12.2).
 */
export async function completeManualTaskAction(taskId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  const task = rows[0];
  if (!task || task.kind !== "manual" || task.status !== "open") return;

  const context = await resolveProjectActor(task.projectId);
  if (!context) return;

  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ status: "done", updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    await logAudit(
      {
        workspaceId: context.project.workspaceId,
        projectId: task.projectId,
        actorId: context.user.id,
        action: "task.completed",
        entityType: "task",
        entityId: taskId,
        detail: { title: task.title, kind: task.kind },
      },
      tx,
    );
  });

  refresh();
}

/**
 * Repara un proyecto sin artefactos instanciados (p.ej. si
 * `ensureProjectArtifacts` falló tras crear el proyecto). Idempotente.
 */
export async function initProjectArtifactsAction(projectId: string): Promise<void> {
  const context = await resolveProjectActor(projectId);
  if (!context) return;
  await ensureProjectArtifacts(projectId, context.actor);
  refresh();
}
