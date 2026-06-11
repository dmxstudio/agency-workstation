import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { AgentsDomainError } from "../types";

/**
 * At-rest encryption for BYOK LLM API keys (§16: "cifradas en reposo").
 *
 * - Cipher: AES-256-GCM with a random 12-byte IV per encryption and the GCM
 *   auth tag stored alongside (tamper-evident).
 * - Master key: derived (scrypt, 32 bytes) from `LLM_KEYS_SECRET`, or — as a
 *   documented fallback — from `AUTH_SECRET` with the same fixed salt below.
 *   The fixed salt is fine here: the input is a high-entropy server secret,
 *   not a user password; scrypt is used as a KDF to normalize length.
 * - `encryptApiKey`/`decryptApiKey` are pure (key material in, string out):
 *   the smoke test exercises them without touching the environment.
 *
 * Plaintext keys NEVER leave this boundary except inside the runtime's
 * provider call (a local variable). They are never logged, never returned to
 * the client (only id/label/last4) and never written to generated projects.
 */

/** Documented fixed KDF salt (see rationale above). Changing it re-keys everything. */
export const LLM_KEYS_KDF_SALT = "agency-workstation/llm-keys/v1";

/** Ciphertext format version + separator ("." never appears in base64). */
const CIPHERTEXT_VERSION = "v1";
const SEPARATOR = ".";
const IV_BYTES = 12;

/** Derives the 32-byte AES key from a server secret (pure). */
export function deriveMasterKey(secret: string): Buffer {
  return scryptSync(secret, LLM_KEYS_KDF_SALT, 32);
}

/**
 * Resolves the master key from the environment: `LLM_KEYS_SECRET` first,
 * `AUTH_SECRET` as the documented fallback. Throws when neither exists.
 */
export function resolveMasterKey(
  env: Partial<Record<"LLM_KEYS_SECRET" | "AUTH_SECRET", string>> = process.env as Record<
    string,
    string | undefined
  >,
): Buffer {
  const secret = env.LLM_KEYS_SECRET || env.AUTH_SECRET;
  if (!secret) {
    throw new AgentsDomainError(
      "MISSING_SECRET",
      "Falta LLM_KEYS_SECRET (o AUTH_SECRET como fallback) para cifrar las API keys del workspace.",
    );
  }
  return deriveMasterKey(secret);
}

/**
 * Encrypts a plaintext API key. Output format:
 * `v1.<iv:base64>.<gcmTag:base64>.<ciphertext:base64>`.
 */
export function encryptApiKey(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHERTEXT_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(SEPARATOR);
}

/**
 * Decrypts a `v1.…` ciphertext. Throws `DECRYPT_FAILED` on wrong key, tamper
 * (GCM tag mismatch) or malformed input — with NO key material in the message.
 */
export function decryptApiKey(encrypted: string, masterKey: Buffer): string {
  const parts = encrypted.split(SEPARATOR);
  if (parts.length !== 4 || parts[0] !== CIPHERTEXT_VERSION) {
    throw new AgentsDomainError(
      "DECRYPT_FAILED",
      "Formato de key cifrada no reconocido (se esperaba v1).",
    );
  }
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");
    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Deliberately opaque: no underlying error detail can leak key material.
    throw new AgentsDomainError(
      "DECRYPT_FAILED",
      "No se pudo descifrar la API key (clave maestra incorrecta o dato alterado).",
    );
  }
}

/** The only fragment of a key that is ever displayed: its last 4 characters. */
export function redactApiKey(plaintext: string): string {
  return plaintext.slice(-4);
}
