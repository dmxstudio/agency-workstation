import { and, desc, eq, notInArray } from "drizzle-orm";

import { getDb, type Db } from "@/db/client";
import { newId } from "@/db/ids";
import {
  approvals,
  artifactVersions,
  artifacts,
  auditLog,
  users,
} from "@/db/schema";

/**
 * Shared audit helper (restricción §19: "audit log en toda mutación") and the
 * project activity feed (§12.2: versiones, aprobaciones, agent runs, …).
 */

export type AuditEntry = {
  workspaceId: string;
  projectId?: string | null;
  /** Null/omitted when the actor is the system (e.g. derived-task generation). */
  actorId?: string | null;
  /** Verb, e.g. "workspace.created", "project.created", "artifact.approved". */
  action: string;
  entityType: string;
  entityId: string;
  detail?: unknown;
};

/**
 * Appends an audit event. Pass a transaction handle as `db` to make the
 * audit row atomic with the mutation it describes.
 */
export async function logAudit(entry: AuditEntry, db: Db = getDb()): Promise<void> {
  await db.insert(auditLog).values({
    id: newId.auditEvent(),
    workspaceId: entry.workspaceId,
    projectId: entry.projectId ?? null,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    detail: entry.detail ?? null,
  });
}

// ---------------------------------------------------------------------------
// Project activity feed
// ---------------------------------------------------------------------------

export type ActivityEventKind = "audit" | "approval" | "version";

/** Unified event for the Cockpit activity feed, newest first. */
export type ActivityEvent = {
  id: string;
  kind: ActivityEventKind;
  /** Verb, e.g. "artifact.version_created", "artifact.approved". */
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  /** Resolved display name; null for system/agent actors. */
  actorName: string | null;
  detail: unknown;
  createdAt: Date;
};

/**
 * Audit entities that are ALSO surfaced as first-class feed sources below;
 * excluded from the audit slice so the feed never shows duplicates.
 */
const FIRST_CLASS_ENTITY_TYPES = ["approval", "artifact_version"];

/**
 * Activity feed for a project (§12.2): audit events + approvals + immutable
 * artifact versions, merged and sorted newest-first.
 */
export async function getProjectActivity(
  projectId: string,
  limit = 50,
): Promise<ActivityEvent[]> {
  const db = getDb();

  const [auditRows, approvalRows, versionRows] = await Promise.all([
    db
      .select({ event: auditLog, actorName: users.name })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorId, users.id))
      .where(
        and(
          eq(auditLog.projectId, projectId),
          notInArray(auditLog.entityType, FIRST_CLASS_ENTITY_TYPES),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(limit),
    db
      .select({
        approval: approvals,
        artifactType: artifacts.type,
        approverName: users.name,
      })
      .from(approvals)
      .innerJoin(artifacts, eq(approvals.artifactId, artifacts.id))
      .innerJoin(users, eq(approvals.approvedBy, users.id))
      .where(eq(artifacts.projectId, projectId))
      .orderBy(desc(approvals.createdAt))
      .limit(limit),
    db
      .select({
        version: artifactVersions,
        artifactType: artifacts.type,
        authorName: users.name,
      })
      .from(artifactVersions)
      .innerJoin(artifacts, eq(artifactVersions.artifactId, artifacts.id))
      .leftJoin(users, eq(artifactVersions.authorId, users.id))
      .where(eq(artifacts.projectId, projectId))
      .orderBy(desc(artifactVersions.createdAt))
      .limit(limit),
  ]);

  const events: ActivityEvent[] = [
    ...auditRows.map(
      ({ event, actorName }): ActivityEvent => ({
        id: event.id,
        kind: "audit",
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        actorId: event.actorId,
        actorName,
        detail: event.detail,
        createdAt: event.createdAt,
      }),
    ),
    ...approvalRows.map(
      ({ approval, artifactType, approverName }): ActivityEvent => ({
        id: approval.id,
        kind: "approval",
        action: "artifact.approved",
        entityType: "approval",
        entityId: approval.id,
        actorId: approval.approvedBy,
        actorName: approverName,
        detail: {
          artifactId: approval.artifactId,
          artifactType,
          version: approval.version,
          comment: approval.comment,
        },
        createdAt: approval.createdAt,
      }),
    ),
    ...versionRows.map(
      ({ version, artifactType, authorName }): ActivityEvent => ({
        id: version.id,
        kind: "version",
        action: "artifact.version_created",
        entityType: "artifact_version",
        entityId: version.id,
        actorId: version.authorId,
        actorName: authorName,
        detail: {
          artifactId: version.artifactId,
          artifactType,
          version: version.version,
          origin: version.origin,
          agentRunId: version.agentRunId,
        },
        createdAt: version.createdAt,
      }),
    ),
  ];

  return events
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
