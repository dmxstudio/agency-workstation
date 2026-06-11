import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb, type Db } from "@/db/client";
import { newId } from "@/db/ids";
import {
  approvals,
  artifactDependencies,
  artifacts,
  auditLog,
  projects,
  tasks,
  type Approval,
  type Artifact,
  type ArtifactVersion,
  artifactVersions,
  type Project,
  type User,
  type WorkspaceRole,
} from "@/db/schema";

import { diffPayloads, type DiffChange } from "./diff";
import { ArtifactDomainError, ArtifactValidationError, type ValidationIssue } from "./errors";
import {
  ARTIFACT_TYPE_KEYS,
  PROJECT_PHASES,
  artifactTypeOrder,
  artifactTypeRegistry,
  getArtifactTypeOrNull,
  getPhaseLabel,
  type ArtifactTypeDefinition,
  type ArtifactTypeKey,
  type ProjectPhaseKey,
} from "./types/registry";

/**
 * Artifact domain service — the canonical human-in-the-loop cycle (§13) over
 * the Artifact Model (§8).
 *
 * Hard guarantees enforced here, by construction:
 * - `approve()` only accepts a {@link HumanActor} (a session user). There is
 *   no code path through which an agent run can transition an artifact to
 *   `approved` (§8.6, §13, CLAUDE.md restriction #1).
 * - Approved versions are immutable snapshots; this module only ever INSERTs
 *   into `artifact_versions`, never updates.
 * - `outdated` propagation MARKS dependents and derives re-validation tasks;
 *   it never regenerates anything (§8.4).
 * - Every mutation writes an audit log entry.
 */

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

/**
 * A HUMAN actor: the authenticated session user (platform-core auth adapter).
 * Deliberately has no `origin` field — agent runs cannot impersonate one.
 */
export interface HumanActor {
  id: string; // usr_
  role: WorkspaceRole;
  workspaceId: string;
}

const EDITOR_ROLES: readonly WorkspaceRole[] = ["admin", "member"];

function assertEditor(actor: HumanActor, action: string): void {
  if (!EDITOR_ROLES.includes(actor.role)) {
    throw new ArtifactDomainError(
      "FORBIDDEN",
      `No tienes permisos para ${action}: requiere rol admin o member.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ArtifactWithProject {
  artifact: Artifact;
  project: Project;
}

async function loadArtifactWithProject(db: Db, artifactId: string): Promise<ArtifactWithProject> {
  const rows = await db
    .select({ artifact: artifacts, project: projects })
    .from(artifacts)
    .innerJoin(projects, eq(artifacts.projectId, projects.id))
    .where(
      and(eq(artifacts.id, artifactId), isNull(artifacts.deletedAt), isNull(projects.deletedAt)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ArtifactDomainError("ARTIFACT_NOT_FOUND", "El artefacto no existe.");
  }
  return row;
}

function requireDefinition(artifact: Artifact): ArtifactTypeDefinition {
  const definition = getArtifactTypeOrNull(artifact.type);
  if (!definition) {
    throw new ArtifactDomainError(
      "UNKNOWN_TYPE",
      `Tipo de artefacto desconocido: ${artifact.type}.`,
    );
  }
  return definition;
}

/** Validates a payload against its type schema. Runs on EVERY write. */
function validatePayload(definition: ArtifactTypeDefinition, payload: unknown): unknown {
  const result = definition.payloadSchema.safeParse(payload);
  if (!result.success) {
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    throw new ArtifactValidationError(
      `El contenido de «${definition.label}» no supera la validación.`,
      issues,
    );
  }
  return result.data;
}

function assertNotLocked(artifact: Artifact, definition: ArtifactTypeDefinition): void {
  if (artifact.status === "locked") {
    throw new ArtifactDomainError(
      "LOCKED",
      `«${definition.label}» está bloqueado (${artifact.lockedBy ?? "lock"}); desbloquéalo explícitamente para editarlo.`,
    );
  }
}

interface AuditInput {
  workspaceId: string;
  projectId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  detail?: unknown;
}

async function writeAudit(db: Db, input: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    id: newId.auditEvent(),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    detail: input.detail ?? null,
  });
}

interface DerivedTaskInput {
  projectId: string;
  title: string;
  artifactId: string;
  assigneeId: string | null;
  dedupeKey: string;
}

/**
 * Opens (or re-opens) a derived task identified by its dedupe key (§7.10,
 * §12.2). Derived tasks mirror real system state, so the same key never
 * yields duplicated open tasks.
 */
async function openDerivedTask(db: Db, input: DerivedTaskInput): Promise<void> {
  const existing = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, input.projectId),
        eq(tasks.dedupeKey, input.dedupeKey),
        isNull(tasks.deletedAt),
      ),
    )
    .limit(1);
  const row = existing[0];
  if (row) {
    if (row.status !== "open") {
      await db
        .update(tasks)
        .set({ status: "open", title: input.title, updatedAt: new Date() })
        .where(eq(tasks.id, row.id));
    }
    return;
  }
  await db.insert(tasks).values({
    id: newId.task(),
    projectId: input.projectId,
    kind: "derived",
    title: input.title,
    status: "open",
    assigneeId: input.assigneeId,
    artifactId: input.artifactId,
    dedupeKey: input.dedupeKey,
  });
}

/** Marks the open derived task with this dedupe key as done (if any). */
async function closeDerivedTask(db: Db, projectId: string, dedupeKey: string): Promise<void> {
  await db
    .update(tasks)
    .set({ status: "done", updatedAt: new Date() })
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.dedupeKey, dedupeKey),
        eq(tasks.status, "open"),
        isNull(tasks.deletedAt),
      ),
    );
}

const reviewTaskKey = (artifactId: string) => `review:${artifactId}`;
const outdatedTaskKey = (artifactId: string) => `outdated:${artifactId}`;

// ---------------------------------------------------------------------------
// ensureProjectArtifacts
// ---------------------------------------------------------------------------

/**
 * Instantiates the fixed MVP artifact graph (§8.4) for a project: one `empty`
 * artifact per registered type plus the declared dependency edges.
 * Idempotent: existing artifacts/edges are preserved.
 */
export async function ensureProjectArtifacts(
  projectId: string,
  actor?: HumanActor,
): Promise<Artifact[]> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const projectRows = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    const project = projectRows[0];
    if (!project) {
      throw new ArtifactDomainError("PROJECT_NOT_FOUND", "El proyecto no existe.");
    }

    const existing = await tx
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.projectId, projectId), isNull(artifacts.deletedAt)));
    const byType = new Map(existing.map((artifact) => [artifact.type, artifact]));

    const createdTypes: ArtifactTypeKey[] = [];
    for (const type of ARTIFACT_TYPE_KEYS) {
      if (byType.has(type)) continue;
      const definition = artifactTypeRegistry[type];
      const inserted = await tx
        .insert(artifacts)
        .values({
          id: newId.artifact(),
          projectId,
          type,
          schemaVersion: definition.schemaVersion,
          status: "empty",
        })
        .returning();
      byType.set(type, inserted[0]);
      createdTypes.push(type);
    }

    // Declared dependency edges (§8.4) — from = dependent, to = upstream.
    for (const type of ARTIFACT_TYPE_KEYS) {
      const definition = artifactTypeRegistry[type];
      const fromArtifact = byType.get(type);
      if (!fromArtifact) continue;
      for (const upstreamType of definition.dependsOn) {
        const toArtifact = byType.get(upstreamType);
        if (!toArtifact) continue;
        await tx
          .insert(artifactDependencies)
          .values({ fromArtifactId: fromArtifact.id, toArtifactId: toArtifact.id })
          .onConflictDoNothing();
      }
    }

    if (createdTypes.length > 0) {
      await writeAudit(tx, {
        workspaceId: project.workspaceId,
        projectId,
        actorId: actor?.id ?? null,
        action: "project.artifacts_instantiated",
        entityType: "project",
        entityId: projectId,
        detail: { createdTypes },
      });
    }

    return [...byType.values()].sort(
      (a, b) => artifactTypeOrder(a.type) - artifactTypeOrder(b.type),
    );
  });
}

// ---------------------------------------------------------------------------
// saveDraft
// ---------------------------------------------------------------------------

/**
 * Validates the payload (Zod, on every write) and stores it as the mutable
 * draft (§8.3). Editing an `approved` artifact starts the proposal of its
 * next version (§13 paso 2); drafts in review are frozen until decision.
 */
export async function saveDraft(
  artifactId: string,
  payload: unknown,
  actor: HumanActor,
): Promise<Artifact> {
  assertEditor(actor, "editar artefactos");
  const db = getDb();
  return db.transaction(async (tx) => {
    const { artifact, project } = await loadArtifactWithProject(tx, artifactId);
    const definition = requireDefinition(artifact);
    assertNotLocked(artifact, definition);
    if (artifact.status === "in_review") {
      throw new ArtifactDomainError(
        "INVALID_STATE",
        `«${definition.label}» está en revisión; apruébalo o recházalo antes de seguir editando.`,
      );
    }

    const validated = validatePayload(definition, payload);

    const updated = await tx
      .update(artifacts)
      .set({ draftPayload: validated, status: "draft", updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .returning();

    await writeAudit(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: actor.id,
      action: "artifact.draft_saved",
      entityType: "artifact",
      entityId: artifactId,
      detail: { type: artifact.type, fromStatus: artifact.status },
    });

    return updated[0];
  });
}

// ---------------------------------------------------------------------------
// submitForReview
// ---------------------------------------------------------------------------

/**
 * `draft → in_review` (§8.2) + derived review task for the owner (§7.10).
 */
export async function submitForReview(artifactId: string, actor: HumanActor): Promise<Artifact> {
  assertEditor(actor, "enviar artefactos a revisión");
  const db = getDb();
  return db.transaction(async (tx) => {
    const { artifact, project } = await loadArtifactWithProject(tx, artifactId);
    const definition = requireDefinition(artifact);
    assertNotLocked(artifact, definition);
    if (artifact.status !== "draft" || artifact.draftPayload == null) {
      throw new ArtifactDomainError(
        "INVALID_STATE",
        `Solo un borrador con contenido puede enviarse a revisión («${definition.label}» está en estado ${artifact.status}).`,
      );
    }

    const updated = await tx
      .update(artifacts)
      .set({ status: "in_review", updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .returning();

    await openDerivedTask(tx, {
      projectId: project.id,
      title: `Revisar «${definition.label}»`,
      artifactId,
      assigneeId: artifact.ownerId,
      dedupeKey: reviewTaskKey(artifactId),
    });

    await writeAudit(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: actor.id,
      action: "artifact.submitted_for_review",
      entityType: "artifact",
      entityId: artifactId,
      detail: { type: artifact.type },
    });

    return updated[0];
  });
}

// ---------------------------------------------------------------------------
// approve
// ---------------------------------------------------------------------------

export interface ApproveResult {
  artifact: Artifact;
  version: ArtifactVersion;
  approval: Approval;
  /** Artifact IDs marked `outdated` by propagation (§8.4 — marks, never regenerates). */
  outdatedDependentIds: string[];
}

/**
 * Seals the draft as an immutable version (§13 paso 6) and propagates
 * `outdated` to dependents (§8.4).
 *
 * ONLY a human with role admin|member can approve. By construction the actor
 * is a session user from the auth adapter — there is no parameter through
 * which an agent run could reach this transition (§8.6; CLAUDE.md #1). The
 * sealed version is therefore always `origin: "human"`.
 */
export async function approve(
  artifactId: string,
  actor: HumanActor,
  comment?: string,
): Promise<ApproveResult> {
  assertEditor(actor, "aprobar artefactos");
  const db = getDb();
  return db.transaction(async (tx) => {
    const { artifact, project } = await loadArtifactWithProject(tx, artifactId);
    const definition = requireDefinition(artifact);
    assertNotLocked(artifact, definition);
    if (artifact.status !== "in_review" || artifact.draftPayload == null) {
      throw new ArtifactDomainError(
        "INVALID_STATE",
        `Solo se puede aprobar un artefacto en revisión («${definition.label}» está en estado ${artifact.status}).`,
      );
    }

    // Payloads are validated on EVERY write — sealing a version included.
    const payload = validatePayload(definition, artifact.draftPayload);
    const newVersionNumber = artifact.currentVersion + 1;

    // Immutable snapshot (§8.3). INSERT only; this table is never updated.
    const versionRows = await tx
      .insert(artifactVersions)
      .values({
        id: newId.artifactVersion(),
        artifactId,
        version: newVersionNumber,
        payload,
        authorId: actor.id,
        origin: "human",
        agentRunId: null,
      })
      .returning();
    const version = versionRows[0];

    // Explicit approval by a human with role, over a concrete version (§8.5).
    const approvalRows = await tx
      .insert(approvals)
      .values({
        id: newId.approval(),
        artifactId,
        version: newVersionNumber,
        approvedBy: actor.id,
        comment: comment ?? null,
      })
      .returning();
    const approval = approvalRows[0];

    const updatedRows = await tx
      .update(artifacts)
      .set({
        status: "approved",
        currentVersion: newVersionNumber,
        rejected: false,
        outdated: false, // re-approval supersedes any pending re-validation
        draftPayload: null, // the draft was promoted to the sealed version
        updatedAt: new Date(),
      })
      .where(eq(artifacts.id, artifactId))
      .returning();

    // Derived tasks reflect real state (§12.2): review/re-validation done.
    await closeDerivedTask(tx, project.id, reviewTaskKey(artifactId));
    await closeDerivedTask(tx, project.id, outdatedTaskKey(artifactId));

    // §8.4 propagation: MARK dependents as outdated + derive re-validation
    // tasks. NEVER regenerate anything automatically.
    const dependents = await tx
      .select({ dependent: artifacts })
      .from(artifactDependencies)
      .innerJoin(artifacts, eq(artifactDependencies.fromArtifactId, artifacts.id))
      .where(and(eq(artifactDependencies.toArtifactId, artifactId), isNull(artifacts.deletedAt)));

    const outdatedDependentIds: string[] = [];
    for (const { dependent } of dependents) {
      // An `empty` dependent has no content to invalidate.
      if (dependent.status === "empty") continue;
      if (!dependent.outdated) {
        await tx
          .update(artifacts)
          .set({ outdated: true, updatedAt: new Date() })
          .where(eq(artifacts.id, dependent.id));
      }
      outdatedDependentIds.push(dependent.id);
      const dependentLabel = getArtifactTypeOrNull(dependent.type)?.label ?? dependent.type;
      await openDerivedTask(tx, {
        projectId: project.id,
        title: `Re-validar «${dependentLabel}»: «${definition.label}» tiene nueva versión aprobada (v${newVersionNumber})`,
        artifactId: dependent.id,
        assigneeId: dependent.ownerId,
        dedupeKey: outdatedTaskKey(dependent.id),
      });
    }

    await writeAudit(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: actor.id,
      action: "artifact.approved",
      entityType: "artifact",
      entityId: artifactId,
      detail: {
        type: artifact.type,
        version: newVersionNumber,
        comment: comment ?? null,
        outdatedDependentIds,
      },
    });

    return { artifact: updatedRows[0], version, approval, outdatedDependentIds };
  });
}

// ---------------------------------------------------------------------------
// reject
// ---------------------------------------------------------------------------

/**
 * `in_review → draft` with the `rejected` flag and attached feedback (§8.2).
 * Feedback is persisted in the audit log entry.
 */
export async function reject(
  artifactId: string,
  feedback: string,
  actor: HumanActor,
): Promise<Artifact> {
  assertEditor(actor, "rechazar artefactos");
  const db = getDb();
  return db.transaction(async (tx) => {
    const { artifact, project } = await loadArtifactWithProject(tx, artifactId);
    const definition = requireDefinition(artifact);
    if (artifact.status !== "in_review") {
      throw new ArtifactDomainError(
        "INVALID_STATE",
        `Solo se puede rechazar un artefacto en revisión («${definition.label}» está en estado ${artifact.status}).`,
      );
    }

    const updated = await tx
      .update(artifacts)
      .set({ status: "draft", rejected: true, updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .returning();

    // The review happened (decision: rejected) → the derived task closes.
    await closeDerivedTask(tx, project.id, reviewTaskKey(artifactId));

    await writeAudit(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: actor.id,
      action: "artifact.rejected",
      entityType: "artifact",
      entityId: artifactId,
      detail: { type: artifact.type, feedback },
    });

    return updated[0];
  });
}

// ---------------------------------------------------------------------------
// revalidate
// ---------------------------------------------------------------------------

/**
 * "Revalidar sin cambios" (§17-R6): a human confirms the artifact is still
 * valid after an upstream change. Clears `outdated` and closes the derived
 * re-validation task. Changes nothing else — never regenerates.
 */
export async function revalidate(artifactId: string, actor: HumanActor): Promise<Artifact> {
  assertEditor(actor, "revalidar artefactos");
  const db = getDb();
  return db.transaction(async (tx) => {
    const { artifact, project } = await loadArtifactWithProject(tx, artifactId);
    const definition = requireDefinition(artifact);
    if (!artifact.outdated) {
      throw new ArtifactDomainError(
        "NOT_OUTDATED",
        `«${definition.label}» no está marcado como desactualizado.`,
      );
    }

    const updated = await tx
      .update(artifacts)
      .set({ outdated: false, updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .returning();

    await closeDerivedTask(tx, project.id, outdatedTaskKey(artifactId));

    await writeAudit(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: actor.id,
      action: "artifact.revalidated",
      entityType: "artifact",
      entityId: artifactId,
      detail: { type: artifact.type, note: "revalidado sin cambios" },
    });

    return updated[0];
  });
}

// ---------------------------------------------------------------------------
// lock / unlock (§8.2)
// ---------------------------------------------------------------------------

/**
 * Locks an approved artifact (phase gate or manual lock). `lockedBy` is a
 * tag like `gate:phase.ia` or `user:usr_…` (defaults to the acting user).
 */
export async function lockArtifact(
  artifactId: string,
  actor: HumanActor,
  lockedBy?: string,
): Promise<Artifact> {
  assertEditor(actor, "bloquear artefactos");
  const db = getDb();
  return db.transaction(async (tx) => {
    const { artifact, project } = await loadArtifactWithProject(tx, artifactId);
    const definition = requireDefinition(artifact);
    if (artifact.status !== "approved") {
      throw new ArtifactDomainError(
        "INVALID_STATE",
        `Solo se puede bloquear un artefacto aprobado («${definition.label}» está en estado ${artifact.status}).`,
      );
    }

    const holder = lockedBy ?? `user:${actor.id}`;
    const updated = await tx
      .update(artifacts)
      .set({ status: "locked", lockedBy: holder, updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .returning();

    await writeAudit(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: actor.id,
      action: "artifact.locked",
      entityType: "artifact",
      entityId: artifactId,
      detail: { type: artifact.type, lockedBy: holder },
    });

    return updated[0];
  });
}

/**
 * Explicit unlock to edit a locked artifact (§8.2): returns it to `approved`,
 * marks its dependents `outdated` and leaves an audit trail.
 */
export async function unlockArtifact(artifactId: string, actor: HumanActor): Promise<Artifact> {
  assertEditor(actor, "desbloquear artefactos");
  const db = getDb();
  return db.transaction(async (tx) => {
    const { artifact, project } = await loadArtifactWithProject(tx, artifactId);
    const definition = requireDefinition(artifact);
    if (artifact.status !== "locked") {
      throw new ArtifactDomainError(
        "INVALID_STATE",
        `«${definition.label}» no está bloqueado.`,
      );
    }

    const updated = await tx
      .update(artifacts)
      .set({ status: "approved", lockedBy: null, updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .returning();

    // §8.2: unlocking to edit marks dependents as outdated (marks only).
    const dependents = await tx
      .select({ dependent: artifacts })
      .from(artifactDependencies)
      .innerJoin(artifacts, eq(artifactDependencies.fromArtifactId, artifacts.id))
      .where(and(eq(artifactDependencies.toArtifactId, artifactId), isNull(artifacts.deletedAt)));

    const outdatedDependentIds: string[] = [];
    for (const { dependent } of dependents) {
      if (dependent.status === "empty") continue;
      if (!dependent.outdated) {
        await tx
          .update(artifacts)
          .set({ outdated: true, updatedAt: new Date() })
          .where(eq(artifacts.id, dependent.id));
      }
      outdatedDependentIds.push(dependent.id);
      const dependentLabel = getArtifactTypeOrNull(dependent.type)?.label ?? dependent.type;
      await openDerivedTask(tx, {
        projectId: project.id,
        title: `Re-validar «${dependentLabel}»: «${definition.label}» fue desbloqueado para edición`,
        artifactId: dependent.id,
        assigneeId: dependent.ownerId,
        dedupeKey: outdatedTaskKey(dependent.id),
      });
    }

    await writeAudit(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: actor.id,
      action: "artifact.unlocked",
      entityType: "artifact",
      entityId: artifactId,
      detail: { type: artifact.type, outdatedDependentIds },
    });

    return updated[0];
  });
}

// ---------------------------------------------------------------------------
// Reads: history, project listing, diff, gates
// ---------------------------------------------------------------------------

export interface ArtifactWithHistory {
  artifact: Artifact;
  definition: ArtifactTypeDefinition | null;
  /** Immutable versions, newest first. */
  versions: (ArtifactVersion & { author: User | null })[];
  /** Approvals, newest first. */
  approvals: (Approval & { approver: User })[];
}

/** Artifact + immutable versions + approvals (newest first). */
export async function getArtifactWithHistory(artifactId: string): Promise<ArtifactWithHistory> {
  const db = getDb();
  const row = await db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, artifactId), isNull(artifacts.deletedAt)),
    with: {
      versions: {
        orderBy: [desc(artifactVersions.version)],
        with: { author: true },
      },
      approvals: {
        orderBy: [desc(approvals.version), desc(approvals.createdAt)],
        with: { approver: true },
      },
    },
  });
  if (!row) {
    throw new ArtifactDomainError("ARTIFACT_NOT_FOUND", "El artefacto no existe.");
  }
  const { versions, approvals: approvalRows, ...artifact } = row;
  return {
    artifact,
    definition: getArtifactTypeOrNull(artifact.type),
    versions,
    approvals: approvalRows,
  };
}

export interface ProjectArtifact {
  artifact: Artifact;
  definition: ArtifactTypeDefinition | null;
  /** Convenience for the Cockpit: definition label or raw type as fallback. */
  label: string;
  phase: ProjectPhaseKey | null;
  /** Upstream artifact IDs this artifact depends on. */
  dependsOnIds: string[];
  /** Downstream artifact IDs depending on this artifact. */
  dependentIds: string[];
}

/**
 * All artifacts of a project with states, flags and dependency edges, in
 * canonical order — the Cockpit listing (§7.1).
 */
export async function getProjectArtifacts(projectId: string): Promise<ProjectArtifact[]> {
  const db = getDb();
  const rows = await db.query.artifacts.findMany({
    where: and(eq(artifacts.projectId, projectId), isNull(artifacts.deletedAt)),
    with: {
      dependsOn: true, // edges where this artifact is the dependent (from)
      dependents: true, // edges where this artifact is the upstream (to)
    },
  });

  return rows
    .map((row) => {
      const { dependsOn, dependents, ...artifact } = row;
      const definition = getArtifactTypeOrNull(artifact.type);
      return {
        artifact,
        definition,
        label: definition?.label ?? artifact.type,
        phase: definition?.phase ?? null,
        dependsOnIds: dependsOn.map((edge) => edge.toArtifactId),
        dependentIds: dependents.map((edge) => edge.fromArtifactId),
      };
    })
    .sort((a, b) => artifactTypeOrder(a.artifact.type) - artifactTypeOrder(b.artifact.type));
}

export interface ComputedDiff {
  changes: DiffChange[];
  from: { kind: "version"; version: number } | { kind: "none" };
  to: { kind: "version"; version: number } | { kind: "draft" };
}

export interface ComputeDiffOptions {
  /** Compare two sealed versions instead of approved-vs-draft. */
  fromVersion?: number;
  toVersion?: number;
}

/**
 * Structural diff (§8.3) between the current draft and the latest approved
 * version — or between two given sealed versions.
 */
export async function computeDiff(
  artifactId: string,
  options: ComputeDiffOptions = {},
): Promise<ComputedDiff> {
  const db = getDb();
  const { artifact } = await loadArtifactWithProject(db, artifactId);

  async function loadVersion(versionNumber: number): Promise<ArtifactVersion> {
    const rows = await db
      .select()
      .from(artifactVersions)
      .where(
        and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.version, versionNumber)),
      )
      .limit(1);
    if (!rows[0]) {
      throw new ArtifactDomainError(
        "VERSION_NOT_FOUND",
        `La versión v${versionNumber} no existe para este artefacto.`,
      );
    }
    return rows[0];
  }

  if (options.fromVersion != null || options.toVersion != null) {
    if (options.fromVersion == null || options.toVersion == null) {
      throw new ArtifactDomainError(
        "VERSION_NOT_FOUND",
        "Para comparar versiones indica ambas: fromVersion y toVersion.",
      );
    }
    const fromVersion = await loadVersion(options.fromVersion);
    const toVersion = await loadVersion(options.toVersion);
    return {
      changes: diffPayloads(fromVersion.payload, toVersion.payload),
      from: { kind: "version", version: fromVersion.version },
      to: { kind: "version", version: toVersion.version },
    };
  }

  const basePayload =
    artifact.currentVersion > 0 ? (await loadVersion(artifact.currentVersion)).payload : null;
  const draftPayload = artifact.draftPayload ?? basePayload;

  return {
    changes: diffPayloads(basePayload, draftPayload),
    from:
      artifact.currentVersion > 0
        ? { kind: "version", version: artifact.currentVersion }
        : { kind: "none" },
    to: { kind: "draft" },
  };
}

export interface PhaseGate {
  phase: ProjectPhaseKey;
  label: string;
  artifacts: ProjectArtifact[];
  /** Number of required artifacts for this gate. */
  requiredCount: number;
  /** Required artifacts currently approved (or locked) and not outdated. */
  approvedCount: number;
  /** §8.5: every required artifact approved with no pending `outdated`. */
  closable: boolean;
  /** Required type keys still blocking the gate. */
  pendingTypes: ArtifactTypeKey[];
}

/** Counts as approved for a gate: sealed and not pending re-validation. */
function satisfiesGate(artifact: Artifact): boolean {
  return (artifact.status === "approved" || artifact.status === "locked") && !artifact.outdated;
}

/**
 * Cockpit phase gates (§8.5): groups project artifacts by phase; a phase is
 * closable when all its required artifacts are approved without `outdated`.
 */
export async function getPhaseGates(projectId: string): Promise<PhaseGate[]> {
  const projectArtifacts = await getProjectArtifacts(projectId);
  const byType = new Map(projectArtifacts.map((item) => [item.artifact.type, item]));

  return PROJECT_PHASES.map(({ key }) => {
    const phaseTypes = ARTIFACT_TYPE_KEYS.filter(
      (type) => artifactTypeRegistry[type].phase === key,
    );
    const phaseArtifacts = phaseTypes
      .map((type) => byType.get(type))
      .filter((item): item is ProjectArtifact => item != null);
    const requiredTypes = phaseTypes.filter((type) => artifactTypeRegistry[type].requiredForGate);
    const pendingTypes = requiredTypes.filter((type) => {
      const item = byType.get(type);
      return !item || !satisfiesGate(item.artifact);
    });

    return {
      phase: key,
      label: getPhaseLabel(key),
      artifacts: phaseArtifacts,
      requiredCount: requiredTypes.length,
      approvedCount: requiredTypes.length - pendingTypes.length,
      closable: pendingTypes.length === 0,
      pendingTypes,
    };
  });
}
