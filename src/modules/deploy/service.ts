import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, type Db } from "@/db/client";
import { newId } from "@/db/ids";
import {
  artifactVersions,
  artifacts,
  deployments,
  projects,
  users,
  type Deployment,
  type Project,
  type WorkspaceRole,
} from "@/db/schema";
import { logAudit } from "@/modules/platform-core/audit";

import { DeployDomainError, isDeployDomainError } from "./errors";
import { getDeployProvider } from "./index";
import { getSlotPort, getSlotUrl } from "./paths";
import type { BuildResult, DeployResult, DeploySlot, SlotStatus } from "./provider";

/**
 * DB-aware deploy service (§7.8) — the "caller" side of the DeployProvider
 * contract: the provider is pure filesystem/processes and never touches the
 * platform DB; THIS layer records `deployments` rows and audit entries around
 * every provider mutation, and enforces governance (§13, §19):
 *
 * - Only a HUMAN with role admin|member can deploy or stop a slot. There is
 *   no agent-reachable path: the actor always comes from the auth session
 *   (see actions.ts).
 * - Only SEALED releases deploy: `releaseVersion` must exist as an immutable
 *   version of the singleton `release` artifact — which `createRelease`
 *   (review module) only seals after the §7.8 checklist passed green AND a
 *   human confirmed it. Deploying a sealed release never re-evaluates the
 *   checklist: the release froze it.
 * - Rollback is `deployRelease(previousReleaseVersion, slot, actor)` — no
 *   extra state, exactly as the provider contract states.
 *
 * Module boundaries (§19.5): deploy → platform-core (auth/audit) and the DB
 * only. The release payload is validated here with a MINIMAL local schema
 * (releaseNumber + gitTag) instead of importing `@/modules/artifacts` —
 * deploy receives release coordinates as plain data, same reasoning as the
 * provider taking `releaseNumber`/`gitTag` as plain args.
 */

// ---------------------------------------------------------------------------
// Actor (same shape as artifacts/generator/review: a human session user)
// ---------------------------------------------------------------------------

export interface DeployActor {
  id: string; // usr_
  role: WorkspaceRole;
  workspaceId: string;
}

const EDITOR_ROLES: readonly WorkspaceRole[] = ["admin", "member"];

function assertEditor(actor: DeployActor, action: string): void {
  if (!EDITOR_ROLES.includes(actor.role)) {
    throw new DeployDomainError(
      "FORBIDDEN",
      `No tienes permisos para ${action}: requiere rol admin o member.`,
    );
  }
}

// ---------------------------------------------------------------------------
// deployments.detail — shape OWNED and validated by this module (Zod)
// ---------------------------------------------------------------------------

/** Detail jsonb of a `deployments` row (local provider semantics). */
export const deploymentDetailSchema = z.object({
  /** Pid of the slot's `next start` process (null while building / stopped). */
  pid: z.number().int().positive().nullable().default(null),
  /** Local port the slot serves on (4100 producción / 4200 preview). */
  port: z.number().int().min(1).max(65535).nullable().default(null),
  /** Immutable build dir the slot serves from. */
  buildDir: z.string().nullable().default(null),
  /** Error message when status = failed. */
  error: z.string().nullable().default(null),
});

export type DeploymentDetail = z.infer<typeof deploymentDetailSchema>;

const EMPTY_DETAIL: DeploymentDetail = { pid: null, port: null, buildDir: null, error: null };

/** Reads a detail jsonb defensively (legacy/foreign rows fall back to nulls). */
export function parseDeploymentDetail(value: unknown): DeploymentDetail {
  const parsed = deploymentDetailSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { ...EMPTY_DETAIL };
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

async function loadProject(db: Db, projectId: string): Promise<Project> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  const project = rows[0];
  if (!project) {
    throw new DeployDomainError("PROJECT_NOT_FOUND", "El proyecto no existe.");
  }
  return project;
}

function assertSameWorkspace(project: Project, actor: DeployActor): void {
  if (project.workspaceId !== actor.workspaceId) {
    throw new DeployDomainError(
      "FORBIDDEN",
      "El proyecto no pertenece a tu workspace activo.",
    );
  }
}

/**
 * Minimal sealed-release coordinates: enough to drive the provider without
 * importing the artifacts module (releaseNumber === sealed artifact version;
 * gitTag = `release-N` — contract of `createRelease`).
 */
const sealedReleaseCoordinatesSchema = z
  .object({
    releaseNumber: z.number().int().positive(),
    gitTag: z.string().min(1),
  })
  .loose();

export interface SealedRelease {
  releaseNumber: number;
  gitTag: string;
}

/**
 * Resolves a SEALED release version of the project. Throws when the project
 * has no `release` artifact, the version was never sealed, or its payload is
 * unreadable (legacy schema). Immutability is inherited: `artifact_versions`
 * rows are append-only snapshots (§8.3).
 */
async function loadSealedRelease(
  db: Db,
  projectId: string,
  releaseVersion: number,
): Promise<SealedRelease> {
  const artifactRows = await db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.projectId, projectId),
        eq(artifacts.type, "release"),
        isNull(artifacts.key),
        isNull(artifacts.deletedAt),
      ),
    )
    .limit(1);
  if (!artifactRows[0]) {
    throw new DeployDomainError(
      "RELEASE_NOT_FOUND",
      "El proyecto no tiene artefacto release; crea un release desde el checklist primero.",
    );
  }
  const versionRows = await db
    .select({ payload: artifactVersions.payload })
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifactId, artifactRows[0].id),
        eq(artifactVersions.version, releaseVersion),
      ),
    )
    .limit(1);
  if (!versionRows[0]) {
    throw new DeployDomainError(
      "RELEASE_NOT_FOUND",
      `No existe el release v${releaseVersion} (versión sellada no encontrada).`,
    );
  }
  const parsed = sealedReleaseCoordinatesSchema.safeParse(versionRows[0].payload);
  if (!parsed.success || parsed.data.releaseNumber !== releaseVersion) {
    throw new DeployDomainError(
      "RELEASE_NOT_FOUND",
      `El release v${releaseVersion} no es desplegable: su payload sellado no es legible (¿schema legado?).`,
    );
  }
  return { releaseNumber: parsed.data.releaseNumber, gitTag: parsed.data.gitTag };
}

// ---------------------------------------------------------------------------
// deployRelease — build + activate a sealed release on a slot (human-only)
// ---------------------------------------------------------------------------

export interface DeployOutcome {
  deployment: Deployment;
  build: BuildResult;
  result: DeployResult;
  /** Reality-checked slot statuses right after the deploy. */
  statuses: SlotStatus[];
}

/**
 * Deploys sealed release `releaseVersion` on `slot`: inserts the `deployments`
 * row in `building`, runs `buildRelease` (reuses the immutable build when it
 * exists) + `deploy` on the provider, marks the slot's previous `running` row
 * as `stopped` (the provider replaced the process) and seals the row as
 * `running`. On failure the row ends in `failed` with the error in `detail`.
 * Every transition writes an audit entry. Rollback = call this with the
 * previous release version.
 */
export async function deployRelease(
  projectId: string,
  releaseVersion: number,
  slot: DeploySlot,
  actor: DeployActor,
): Promise<DeployOutcome> {
  assertEditor(actor, "desplegar releases");
  const db = getDb();
  const project = await loadProject(db, projectId);
  assertSameWorkspace(project, actor);
  const release = await loadSealedRelease(db, projectId, releaseVersion);

  const port = getSlotPort(slot);
  const url = getSlotUrl(slot);

  const inserted = await db
    .insert(deployments)
    .values({
      id: newId.deployment(),
      projectId,
      releaseVersion,
      slot,
      status: "building",
      url,
      detail: deploymentDetailSchema.parse({ port }),
      actorId: actor.id,
    })
    .returning();
  const row = inserted[0];

  await logAudit({
    workspaceId: project.workspaceId,
    projectId,
    actorId: actor.id,
    action: "deploy.started",
    entityType: "deployment",
    entityId: row.id,
    detail: { releaseVersion, slot, gitTag: release.gitTag, url },
  });

  const provider = getDeployProvider();
  try {
    const build = await provider.buildRelease(projectId, release.releaseNumber, release.gitTag);
    const result = await provider.deploy(projectId, release.releaseNumber, slot);

    // The provider replaced the slot's previous process: reflect it in the DB.
    await db
      .update(deployments)
      .set({ status: "stopped", updatedAt: new Date() })
      .where(
        and(
          eq(deployments.projectId, projectId),
          eq(deployments.slot, slot),
          eq(deployments.status, "running"),
          ne(deployments.id, row.id),
        ),
      );

    const detail = deploymentDetailSchema.parse({
      pid: result.pid,
      port,
      buildDir: build.buildDir,
      error: null,
    });
    const updated = await db
      .update(deployments)
      .set({ status: "running", url: result.url, detail, updatedAt: new Date() })
      .where(eq(deployments.id, row.id))
      .returning();

    await logAudit({
      workspaceId: project.workspaceId,
      projectId,
      actorId: actor.id,
      action: "deploy.succeeded",
      entityType: "deployment",
      entityId: row.id,
      detail: {
        releaseVersion,
        slot,
        url: result.url,
        pid: result.pid,
        gitTag: build.gitTag,
        commit: build.commit,
        buildReused: build.reused,
        buildDurationMs: build.durationMs,
      },
    });

    const statuses = await provider.status(projectId);
    return { deployment: updated[0], build, result, statuses };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(deployments)
      .set({
        status: "failed",
        detail: deploymentDetailSchema.parse({ port, error: message }),
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, row.id));
    await logAudit({
      workspaceId: project.workspaceId,
      projectId,
      actorId: actor.id,
      action: "deploy.failed",
      entityType: "deployment",
      entityId: row.id,
      detail: {
        releaseVersion,
        slot,
        error: message,
        code: isDeployDomainError(error) ? error.code : null,
      },
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// stopSlot — stop the slot's process (human-only) and reconcile the DB
// ---------------------------------------------------------------------------

export interface StopSlotResult {
  /** Release that was running on the slot before stopping (null if none). */
  stoppedRelease: number | null;
  /** Reality-checked slot statuses right after stopping. */
  statuses: SlotStatus[];
}

/**
 * Stops the slot's process (idempotent on the provider side: orphaned pidfiles
 * are cleaned, foreign processes are never signaled) and marks the slot's
 * `running` deployments rows as `stopped`, with audit.
 */
export async function stopSlot(
  projectId: string,
  slot: DeploySlot,
  actor: DeployActor,
): Promise<StopSlotResult> {
  assertEditor(actor, "detener slots de deploy");
  const db = getDb();
  const project = await loadProject(db, projectId);
  assertSameWorkspace(project, actor);

  const provider = getDeployProvider();
  const before = (await provider.status(projectId)).find((status) => status.slot === slot);
  await provider.stop(projectId, slot);

  const stoppedRows = await db
    .update(deployments)
    .set({ status: "stopped", updatedAt: new Date() })
    .where(
      and(
        eq(deployments.projectId, projectId),
        eq(deployments.slot, slot),
        eq(deployments.status, "running"),
      ),
    )
    .returning({ id: deployments.id });

  await logAudit({
    workspaceId: project.workspaceId,
    projectId,
    actorId: actor.id,
    action: "deploy.slot_stopped",
    entityType: "deployment",
    // Without a known row (e.g. orphaned pidfile) the slot itself is the entity.
    entityId: stoppedRows[0]?.id ?? `${projectId}:${slot}`,
    detail: { slot, stoppedRelease: before?.releaseNumber ?? null },
  });

  const statuses = await provider.status(projectId);
  return { stoppedRelease: before?.releaseNumber ?? null, statuses };
}

// ---------------------------------------------------------------------------
// Reads for the Deploy screen (§19.5: screens never hit the DB directly)
// ---------------------------------------------------------------------------

export interface DeploymentWithActor {
  deployment: Deployment;
  actorName: string | null;
}

/** Deployment history of a project, newest first. */
export async function listDeployments(
  projectId: string,
  limit = 100,
): Promise<DeploymentWithActor[]> {
  const db = getDb();
  const rows = await db
    .select({ deployment: deployments, actorName: users.name })
    .from(deployments)
    .leftJoin(users, eq(deployments.actorId, users.id))
    .where(eq(deployments.projectId, projectId))
    .orderBy(desc(deployments.createdAt), desc(deployments.id))
    .limit(limit);
  return rows;
}

/** Reality-checked slot statuses (live process + HTTP probe), via provider. */
export async function getSlotStatuses(projectId: string): Promise<SlotStatus[]> {
  return getDeployProvider().status(projectId);
}
