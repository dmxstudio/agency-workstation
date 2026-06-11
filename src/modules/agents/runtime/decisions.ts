import { eq } from "drizzle-orm";

import { getDb, type Db } from "@/db/client";
import { agentRuns, type AgentRun } from "@/db/schema";
import { logAudit } from "@/modules/platform-core/audit";

import { AgentsDomainError, type AgentActor } from "../types";

/**
 * Records the HUMAN decision over a proposed run (§9.6: "decisión humana,
 * versión resultante").
 *
 * IMPORTANT — what this is NOT: it does not approve, reject or otherwise
 * touch any artifact. The artifact transition happens FIRST, through the
 * artifacts module's human-only actions (approve/reject); this only mirrors
 * that already-made decision onto the run row (status + decidedBy/decidedAt
 * + resultVersion). Calling it without having decided through artifacts
 * changes nothing about any artifact.
 *
 * Pass the artifacts transaction as `db` to make both records atomic (the
 * artifacts service can call this inside `approve()`/`reject()` when it
 * seals a draft that carries `proposedByRunId`).
 */
export interface RunDecisionInput {
  runId: string;
  decision: "approved" | "rejected";
  /** Sealed artifact version created by the approval; null on rejection. */
  resultVersion?: number | null;
}

export async function recordRunDecision(
  input: RunDecisionInput,
  actor: AgentActor,
  db: Db = getDb(),
): Promise<AgentRun> {
  if (actor.role !== "admin" && actor.role !== "member") {
    throw new AgentsDomainError(
      "FORBIDDEN",
      "Solo un usuario con rol admin o member puede decidir sobre una propuesta.",
    );
  }
  const rows = await db.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).limit(1);
  const run = rows[0];
  if (!run) {
    throw new AgentsDomainError("RUN_NOT_FOUND", "El run no existe.");
  }
  // Idempotent against the canonical path: artifacts `approve()`/`reject()`
  // already record the decision ATOMICALLY with the artifact transition when
  // the draft carries `proposedByRunId`. If the run is already settled with
  // the SAME decision, mirror-callers get the row back unchanged.
  if (run.status === input.decision) {
    return run;
  }
  if (run.status !== "proposed") {
    throw new AgentsDomainError(
      "INVALID_STATE",
      `Solo se puede decidir sobre un run en estado proposed (este está en ${run.status}).`,
    );
  }

  const updated = await db
    .update(agentRuns)
    .set({
      status: input.decision,
      decidedBy: actor.id,
      decidedAt: new Date(),
      resultVersion: input.decision === "approved" ? (input.resultVersion ?? null) : null,
    })
    .where(eq(agentRuns.id, input.runId))
    .returning();

  await logAudit(
    {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      actorId: actor.id,
      action: `agent_run.${input.decision}`,
      entityType: "agent_run",
      entityId: run.id,
      detail: {
        skill: run.skill,
        targetArtifactId: run.targetArtifactId,
        resultVersion: input.decision === "approved" ? (input.resultVersion ?? null) : null,
      },
    },
    db,
  );

  return updated[0];
}
