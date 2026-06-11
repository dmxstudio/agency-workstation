"use server";

import type { LlmProviderKind } from "@/db/schema";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";

import { isAgentsDomainError, type AgentActor, type AgentsErrorCode } from "../types";
import { addKey, deleteKey, listKeys, type LlmKeyPublic } from "./service";

/**
 * Server actions for BYOK key management (settings UI, §7.9). Admin-only for
 * mutations; the actor is ALWAYS the authenticated session user. The plaintext
 * key arrives here once (form submit), is validated against the provider and
 * stored encrypted — it never travels back to the client.
 */

export type KeysActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: AgentsErrorCode };

async function requireActor(): Promise<AgentActor | null> {
  const user = await getSessionUser();
  return user ?? null;
}

async function run<T>(fn: (actor: AgentActor) => Promise<T>): Promise<KeysActionResult<T>> {
  const actor = await requireActor();
  if (!actor) {
    return { ok: false, error: "No has iniciado sesión.", code: "FORBIDDEN" };
  }
  try {
    return { ok: true, data: await fn(actor) };
  } catch (error) {
    if (isAgentsDomainError(error)) {
      return { ok: false, error: error.message, code: error.code };
    }
    console.error("[agents/keys] unexpected error:", error);
    return { ok: false, error: "Error inesperado al gestionar las API keys." };
  }
}

/** Valida contra el proveedor, cifra y guarda una API key (solo admin). */
export async function addLlmKeyAction(input: {
  provider: LlmProviderKind;
  label: string;
  apiKey: string;
}): Promise<KeysActionResult<LlmKeyPublic>> {
  return run((actor) =>
    addKey(
      {
        workspaceId: actor.workspaceId,
        provider: input.provider,
        label: input.label,
        apiKey: input.apiKey,
      },
      actor,
    ),
  );
}

/** Lista las keys del workspace activo: solo id/proveedor/etiqueta/last4. */
export async function listLlmKeysAction(): Promise<KeysActionResult<LlmKeyPublic[]>> {
  return run((actor) => listKeys(actor.workspaceId, actor));
}

/** Elimina (soft-delete) una key del workspace (solo admin). */
export async function deleteLlmKeyAction(
  keyId: string,
): Promise<KeysActionResult<LlmKeyPublic>> {
  return run((actor) => deleteKey(keyId, actor));
}
