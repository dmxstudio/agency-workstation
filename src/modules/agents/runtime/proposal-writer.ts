import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { newId } from "@/db/ids";
import { artifacts, auditLog, projects, type Artifact } from "@/db/schema";
import * as artifactsService from "@/modules/artifacts/service";
import { getArtifactTypeOrNull } from "@/modules/artifacts/types/registry";

import { AgentsDomainError } from "../types";

/**
 * Persists a run's proposal as the target artifact's DRAFT with provenance
 * (`artifacts.proposedByRunId`, §8.6/§8.3). It NEVER touches approval state —
 * the human decides through the artifacts module.
 *
 * COORDINATION CONTRACT with the artifacts module (skills workstream):
 * the canonical path is an artifacts-service function with this exact shape:
 *
 *   export async function saveDraftFromAgentRun(
 *     artifactId: string,
 *     payload: unknown,
 *     agentRunId: string,
 *   ): Promise<Artifact>
 *
 * semantics: validate payload with the type's Zod schema (every write),
 * reject `locked`/`in_review` targets, set `draftPayload` + `status: "draft"`
 * + `proposedByRunId = agentRunId`, audit `artifact.draft_proposed` with
 * `actorId: null` and the run id in `detail`.
 *
 * Until that lands, {@link saveDraftProposal} detects it at runtime (feature
 * lookup on the service namespace — no compile-time dependency on a missing
 * export) and otherwise uses a faithful internal fallback with the SAME
 * semantics. Once `saveDraftFromAgentRun` exists, it wins automatically and
 * the fallback below can be deleted.
 */

type SaveDraftFromAgentRunFn = (
  artifactId: string,
  payload: unknown,
  agentRunId: string,
) => Promise<Artifact>;

function resolveCanonicalWriter(): SaveDraftFromAgentRunFn | null {
  const candidate = (artifactsService as Record<string, unknown>)["saveDraftFromAgentRun"];
  return typeof candidate === "function" ? (candidate as SaveDraftFromAgentRunFn) : null;
}

export async function saveDraftProposal(input: {
  artifactId: string;
  payload: unknown;
  agentRunId: string;
}): Promise<Artifact> {
  const canonical = resolveCanonicalWriter();
  if (canonical) {
    return canonical(input.artifactId, input.payload, input.agentRunId);
  }
  return fallbackSaveDraftProposal(input);
}

// ---------------------------------------------------------------------------
// Fallback (same semantics as the expected artifacts-service function)
// ---------------------------------------------------------------------------

async function fallbackSaveDraftProposal(input: {
  artifactId: string;
  payload: unknown;
  agentRunId: string;
}): Promise<Artifact> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ artifact: artifacts, project: projects })
      .from(artifacts)
      .innerJoin(projects, eq(artifacts.projectId, projects.id))
      .where(
        and(
          eq(artifacts.id, input.artifactId),
          isNull(artifacts.deletedAt),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AgentsDomainError("TARGET_NOT_FOUND", "El artefacto objetivo no existe.");
    }
    const { artifact, project } = row;

    const definition = getArtifactTypeOrNull(artifact.type);
    if (!definition) {
      throw new AgentsDomainError(
        "INVALID_STATE",
        `Tipo de artefacto desconocido: ${artifact.type}.`,
      );
    }
    // Payloads are Zod-validated on EVERY write — agent proposals included.
    const parsed = definition.payloadSchema.safeParse(input.payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new AgentsDomainError(
        "INVALID_STATE",
        `La propuesta no supera el esquema de «${definition.label}»: ${first ? `${first.path.map(String).join(".")} — ${first.message}` : "payload inválido"}.`,
      );
    }
    if (artifact.status === "locked") {
      throw new AgentsDomainError(
        "INVALID_STATE",
        `«${definition.label}» está bloqueado (${artifact.lockedBy ?? "lock"}); desbloquéalo antes de proponer cambios.`,
      );
    }
    if (artifact.status === "in_review") {
      throw new AgentsDomainError(
        "INVALID_STATE",
        `«${definition.label}» está en revisión; decide sobre esa revisión antes de proponer otra versión.`,
      );
    }

    const updated = await tx
      .update(artifacts)
      .set({
        draftPayload: parsed.data,
        status: "draft",
        schemaVersion: definition.schemaVersion,
        proposedByRunId: input.agentRunId,
        updatedAt: new Date(),
      })
      .where(eq(artifacts.id, input.artifactId))
      .returning();

    // Audit with actorId null: the actor is the run (recorded in detail) —
    // a run can never impersonate a human user.
    await tx.insert(auditLog).values({
      id: newId.auditEvent(),
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: null,
      action: "artifact.draft_proposed",
      entityType: "artifact",
      entityId: input.artifactId,
      detail: {
        type: artifact.type,
        agentRunId: input.agentRunId,
        fromStatus: artifact.status,
      },
    });

    return updated[0];
  });
}
