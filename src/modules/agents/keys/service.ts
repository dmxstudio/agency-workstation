import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb, type Db } from "@/db/client";
import { newId } from "@/db/ids";
import {
  workspaceLlmKeys,
  type LlmProviderKind,
  type WorkspaceLlmKey,
} from "@/db/schema";
import { logAudit } from "@/modules/platform-core/audit";

import { AgentsDomainError, type AgentActor } from "../types";
import { encryptApiKey, redactApiKey, resolveMasterKey, decryptApiKey } from "./crypto";
import { validateProviderKey } from "./validate";

/**
 * Workspace LLM keys service (BYOK, §7.9/§16).
 *
 * Security invariants, by construction:
 * - The plaintext key exists only: (a) inside `addKey` until encrypted,
 *   (b) inside the runtime's provider call after `getDecryptedKey`.
 * - `encryptedKey` NEVER leaves this file: every public read goes through
 *   {@link toPublicKey}, which picks fields explicitly.
 * - `getDecryptedKey` is internal to the runtime — it is NOT exported from
 *   the module index (`src/modules/agents/index.ts`).
 * - Every mutation writes an audit entry (id/label/last4 only — never values).
 */

/** The ONLY shape that leaves the server: id/provider/label/last4/dates. */
export interface LlmKeyPublic {
  id: string;
  workspaceId: string;
  provider: LlmProviderKind;
  label: string;
  last4: string;
  lastValidatedAt: Date | null;
  createdAt: Date;
}

function toPublicKey(row: WorkspaceLlmKey): LlmKeyPublic {
  // Explicit field picking — adding a spread here would risk leaking
  // `encryptedKey`. Keep it field by field.
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    label: row.label,
    last4: row.last4,
    lastValidatedAt: row.lastValidatedAt,
    createdAt: row.createdAt,
  };
}

function assertAdmin(actor: AgentActor, workspaceId: string, action: string): void {
  if (actor.role !== "admin" || actor.workspaceId !== workspaceId) {
    throw new AgentsDomainError(
      "FORBIDDEN",
      `No tienes permisos para ${action}: requiere rol admin del workspace.`,
    );
  }
}

function assertInternal(actor: AgentActor, workspaceId: string, action: string): void {
  if (
    (actor.role !== "admin" && actor.role !== "member") ||
    actor.workspaceId !== workspaceId
  ) {
    throw new AgentsDomainError(
      "FORBIDDEN",
      `No tienes permisos para ${action}: requiere rol admin o member del workspace.`,
    );
  }
}

export interface AddKeyInput {
  workspaceId: string;
  provider: LlmProviderKind;
  label: string;
  /** Plaintext API key — consumed here, encrypted at rest, never stored raw. */
  apiKey: string;
}

/**
 * Validates the key against the provider BEFORE storing it (GET /v1/models;
 * mock is always valid), encrypts it (AES-256-GCM) and persists it.
 * Admin-only. Audit: `llm_key.added` with provider/label/last4 — no values.
 */
export async function addKey(input: AddKeyInput, actor: AgentActor): Promise<LlmKeyPublic> {
  assertAdmin(actor, input.workspaceId, "añadir API keys");
  const label = input.label.trim();
  if (label.length === 0) {
    throw new AgentsDomainError("INVALID_STATE", "La key necesita una etiqueta.");
  }
  if (input.apiKey.trim().length < 4) {
    throw new AgentsDomainError("INVALID_KEY", "La API key es demasiado corta.");
  }

  const outcome = await validateProviderKey(input.provider, input.apiKey);
  if (outcome === "invalid") {
    throw new AgentsDomainError(
      "INVALID_KEY",
      "El proveedor rechazó la API key (401). Revisa que sea correcta y esté activa.",
    );
  }
  if (outcome === "unreachable") {
    throw new AgentsDomainError(
      "PROVIDER_UNAVAILABLE",
      "No se pudo validar la key con el proveedor (servicio no disponible). Inténtalo de nuevo.",
    );
  }

  const masterKey = resolveMasterKey();
  const encryptedKey = encryptApiKey(input.apiKey, masterKey);
  const last4 = redactApiKey(input.apiKey);

  const db = getDb();
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(workspaceLlmKeys)
      .values({
        id: newId.llmKey(),
        workspaceId: input.workspaceId,
        provider: input.provider,
        label,
        encryptedKey,
        last4,
        createdBy: actor.id,
        lastValidatedAt: new Date(),
      })
      .returning();
    const row = inserted[0];

    await logAudit(
      {
        workspaceId: input.workspaceId,
        actorId: actor.id,
        action: "llm_key.added",
        entityType: "llm_key",
        entityId: row.id,
        detail: { provider: row.provider, label: row.label, last4: row.last4 },
      },
      tx,
    );

    return toPublicKey(row);
  });
}

/** Lists workspace keys — ONLY id/provider/label/last4/dates, newest first. */
export async function listKeys(
  workspaceId: string,
  actor: AgentActor,
): Promise<LlmKeyPublic[]> {
  assertInternal(actor, workspaceId, "ver las API keys");
  const db = getDb();
  const rows = await db
    .select()
    .from(workspaceLlmKeys)
    .where(
      and(eq(workspaceLlmKeys.workspaceId, workspaceId), isNull(workspaceLlmKeys.deletedAt)),
    )
    .orderBy(desc(workspaceLlmKeys.createdAt));
  return rows.map(toPublicKey);
}

/** Soft-deletes a key (universal soft-delete). Admin-only. Audited. */
export async function deleteKey(keyId: string, actor: AgentActor): Promise<LlmKeyPublic> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(workspaceLlmKeys)
      .where(and(eq(workspaceLlmKeys.id, keyId), isNull(workspaceLlmKeys.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AgentsDomainError("KEY_NOT_FOUND", "La API key no existe.");
    }
    assertAdmin(actor, row.workspaceId, "eliminar API keys");

    const updated = await tx
      .update(workspaceLlmKeys)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceLlmKeys.id, keyId))
      .returning();

    await logAudit(
      {
        workspaceId: row.workspaceId,
        actorId: actor.id,
        action: "llm_key.deleted",
        entityType: "llm_key",
        entityId: keyId,
        detail: { provider: row.provider, label: row.label, last4: row.last4 },
      },
      tx,
    );

    return toPublicKey(updated[0]);
  });
}

// ---------------------------------------------------------------------------
// Runtime-internal surface (NOT exported from the module index)
// ---------------------------------------------------------------------------

export interface DecryptedKey {
  id: string;
  workspaceId: string;
  provider: LlmProviderKind;
  last4: string;
  /** Plaintext — must only ever live in a local variable of a provider call. */
  apiKey: string;
}

/**
 * INTERNAL to the agents runtime. Decrypts a key by reference (`keyRef`).
 * Never call from screens/actions; the value must not survive the provider
 * call that consumes it.
 */
export async function getDecryptedKey(keyRef: string, db: Db = getDb()): Promise<DecryptedKey> {
  const rows = await db
    .select()
    .from(workspaceLlmKeys)
    .where(and(eq(workspaceLlmKeys.id, keyRef), isNull(workspaceLlmKeys.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AgentsDomainError("KEY_NOT_FOUND", "La API key referenciada no existe.");
  }
  const apiKey = decryptApiKey(row.encryptedKey, resolveMasterKey());
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    last4: row.last4,
    apiKey,
  };
}

/**
 * Flags a key after a provider 401 (§16: manejo explícito de errores de
 * auth): clears `lastValidatedAt` and audits `llm_key.auth_failed`. The key
 * is kept (soft state) so the admin can replace or revalidate it.
 */
export async function markKeyAuthFailed(keyRef: string, db: Db = getDb()): Promise<void> {
  const rows = await db
    .select()
    .from(workspaceLlmKeys)
    .where(eq(workspaceLlmKeys.id, keyRef))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  await db
    .update(workspaceLlmKeys)
    .set({ lastValidatedAt: null })
    .where(eq(workspaceLlmKeys.id, keyRef));
  await logAudit(
    {
      workspaceId: row.workspaceId,
      actorId: null,
      action: "llm_key.auth_failed",
      entityType: "llm_key",
      entityId: keyRef,
      detail: { provider: row.provider, label: row.label, last4: row.last4 },
    },
    db,
  );
}
