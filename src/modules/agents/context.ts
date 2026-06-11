import { and, eq, inArray, isNull } from "drizzle-orm";

import { getDb, type Db } from "@/db/client";
import {
  artifactDependencies,
  artifactVersions,
  artifacts,
  projects,
  type Artifact,
} from "@/db/schema";
import { getArtifactTypeOrNull } from "@/modules/artifacts/types/registry";

import {
  AgentsDomainError,
  type ContextArtifact,
  type ContextDependencyEdge,
  type ProjectContext,
  type SkillContextRead,
} from "./types";

/**
 * Project Context API (§9.4) — the internal API that feeds skills, designed
 * as if it were public (clean resources; an external gateway would expose
 * exactly this, §9.5).
 *
 * Rules, by construction:
 * - Only APPROVED content enters the context: each artifact contributes the
 *   payload of its current SEALED version (`currentVersion > 0`). Drafts of
 *   other artifacts never leak into a skill's context.
 * - Exception (§8.6 iteration): the run's TARGET artifact may contribute its
 *   own draft (`options.targetArtifactId`), so skills like `revise-artifact`
 *   can iterate over work in progress.
 * - Every returned artifact carries the exact version read — the runner
 *   records this as the run's `inputArtifacts` (§9.6 auditability).
 */

export interface GetProjectContextOptions {
  /**
   * Artifact whose OWN draft may be read (the run target). All other
   * artifacts still contribute only sealed versions.
   */
  targetArtifactId?: string;
}

export async function getProjectContext(
  projectId: string,
  reads: SkillContextRead[],
  options: GetProjectContextOptions = {},
  db: Db = getDb(),
): Promise<ProjectContext> {
  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  const project = projectRows[0];
  if (!project) {
    throw new AgentsDomainError("PROJECT_NOT_FOUND", "El proyecto no existe.");
  }

  const allArtifacts = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.projectId, projectId), isNull(artifacts.deletedAt)));

  // --- resolve the declared reads against the project's artifacts ----------
  const selected = new Map<string, Artifact>();
  for (const read of reads) {
    const definition = getArtifactTypeOrNull(read.type);
    for (const artifact of allArtifacts) {
      if (artifact.type !== read.type) continue;
      if (read.key != null) {
        // Keyed read: exact instance.
        if (artifact.key !== read.key) continue;
      } else if (definition?.multiInstance && artifact.key == null) {
        // Keyless read of a multi-instance type = ALL instances; skip the
        // legacy keyless singleton if one survives.
        continue;
      }
      selected.set(artifact.id, artifact);
    }
  }
  // The target is always readable (its draft IS the proposal base).
  if (options.targetArtifactId) {
    const target = allArtifacts.find((artifact) => artifact.id === options.targetArtifactId);
    if (target) selected.set(target.id, target);
  }

  // --- load sealed payloads (approved versions only) -----------------------
  const sealedIds = [...selected.values()]
    .filter((artifact) => artifact.currentVersion > 0)
    .map((artifact) => artifact.id);
  const sealedRows =
    sealedIds.length > 0
      ? await db
          .select()
          .from(artifactVersions)
          .where(inArray(artifactVersions.artifactId, sealedIds))
      : [];
  const sealedByArtifact = new Map(
    sealedRows.map((row) => [`${row.artifactId}:${row.version}`, row]),
  );

  const contextArtifacts: ContextArtifact[] = [];
  for (const artifact of selected.values()) {
    const isTarget = artifact.id === options.targetArtifactId;
    if (isTarget && artifact.draftPayload != null) {
      // §8.6: the target's own mutable draft, flagged as such.
      contextArtifacts.push({
        artifactId: artifact.id,
        type: artifact.type,
        key: artifact.key,
        version: artifact.currentVersion,
        source: "draft",
        payload: artifact.draftPayload,
      });
      continue;
    }
    if (artifact.currentVersion <= 0) continue; // nothing approved yet
    const sealed = sealedByArtifact.get(`${artifact.id}:${artifact.currentVersion}`);
    if (!sealed) continue; // defensive: missing sealed row
    contextArtifacts.push({
      artifactId: artifact.id,
      type: artifact.type,
      key: artifact.key,
      version: artifact.currentVersion,
      source: "approved",
      payload: sealed.payload,
    });
  }
  // Stable order: type, then instance key (deterministic prompts).
  contextArtifacts.sort(
    (a, b) => a.type.localeCompare(b.type) || (a.key ?? "").localeCompare(b.key ?? ""),
  );

  // --- dependency edges among the project's artifacts ----------------------
  const byId = new Map(allArtifacts.map((artifact) => [artifact.id, artifact]));
  const edgeRows =
    allArtifacts.length > 0
      ? await db
          .select()
          .from(artifactDependencies)
          .where(
            inArray(
              artifactDependencies.fromArtifactId,
              allArtifacts.map((artifact) => artifact.id),
            ),
          )
      : [];
  const dependencies: ContextDependencyEdge[] = edgeRows.flatMap((edge) => {
    const from = byId.get(edge.fromArtifactId);
    const to = byId.get(edge.toArtifactId);
    if (!from || !to) return [];
    return [
      {
        fromArtifactId: from.id,
        fromType: from.type,
        fromKey: from.key,
        toArtifactId: to.id,
        toType: to.type,
        toKey: to.key,
      },
    ];
  });

  return {
    project: {
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      phase: project.currentPhase,
    },
    artifacts: contextArtifacts,
    dependencies,
    phase: project.currentPhase,
  };
}
