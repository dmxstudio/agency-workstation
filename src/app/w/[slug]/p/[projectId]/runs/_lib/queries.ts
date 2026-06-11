import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  agentRuns,
  type AgentRun,
  type Artifact,
  type User,
} from "@/db/schema";

/**
 * Read helpers exclusivos de las pantallas de agent runs (§19.6-c). Mismo
 * patrón screen-scoped que `_components/queries.ts` del Cockpit: lecturas de
 * presentación con joins (nombres de humanos, key por referencia, target).
 * Las mutaciones y el ciclo del run viven en `@/modules/agents` (runner) y
 * `@/modules/artifacts` (decisión humana) — aquí solo se lee.
 */

/**
 * Vista PÚBLICA de la key BYOK referenciada por el run: id/label/last4,
 * jamás el valor (§16). El mapeo se hace aquí para que `encryptedKey` no
 * salga de este helper bajo ninguna circunstancia.
 */
export type RunKeyRef = {
  id: string;
  provider: string;
  label: string;
  last4: string;
};

export type RunWithRelations = AgentRun & {
  targetArtifact: Artifact | null;
  keyRefPublic: RunKeyRef | null;
  creator: User | null;
  decider: User | null;
};

function toPublicKey(
  key: { id: string; provider: string; label: string; last4: string } | null,
): RunKeyRef | null {
  if (!key) return null;
  return { id: key.id, provider: key.provider, label: key.label, last4: key.last4 };
}

/** Runs del proyecto, más recientes primero, con joins de presentación. */
export async function listProjectRuns(
  projectId: string,
  limit = 100,
): Promise<RunWithRelations[]> {
  const db = getDb();
  const rows = await db.query.agentRuns.findMany({
    where: eq(agentRuns.projectId, projectId),
    with: { targetArtifact: true, key: true, creator: true, decider: true },
    orderBy: [desc(agentRuns.createdAt), desc(agentRuns.id)],
    limit,
  });
  return rows.map(({ key, ...run }) => ({ ...run, keyRefPublic: toPublicKey(key) }));
}

/** Un run con sus joins de presentación; null si no existe. */
export async function getRunWithRelations(runId: string): Promise<RunWithRelations | null> {
  const db = getDb();
  const row = await db.query.agentRuns.findFirst({
    where: eq(agentRuns.id, runId),
    with: { targetArtifact: true, key: true, creator: true, decider: true },
  });
  if (!row) return null;
  const { key, ...run } = row;
  return { ...run, keyRefPublic: toPublicKey(key) };
}
