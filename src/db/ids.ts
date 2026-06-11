import { randomBytes } from "node:crypto";

/**
 * Prefixed, random, short, human-readable IDs (CLAUDE.md conventions).
 * Format: `<prefix>_<12 random chars>`, e.g. `usr_x7k2mq4dn9wp`.
 *
 * Alphabet is lowercase Crockford-style base32 (no `i`, `l`, `o`, `u`) to
 * avoid ambiguous characters in IDs that humans read, paste and compare.
 * 12 chars of base32 = 60 bits of entropy per ID.
 */

export const ID_PREFIXES = {
  user: "usr",
  session: "ses",
  workspace: "ws",
  project: "prj",
  artifact: "art",
  artifactVersion: "ver",
  approval: "apr",
  agentRun: "run",
  task: "tsk",
  auditEvent: "evt",
} as const;

export type IdEntity = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdEntity];

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // 32 chars
const RANDOM_LENGTH = 12;

function randomSuffix(length: number): string {
  // 256 % 32 === 0, so a plain modulo over random bytes is bias-free.
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** Generates a prefixed random ID, e.g. `generateId("art")` → `art_8f2kq0c3hj7d`. */
export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${randomSuffix(RANDOM_LENGTH)}`;
}

/** Entity-named convenience generators. */
export const newId = {
  user: () => generateId(ID_PREFIXES.user),
  session: () => generateId(ID_PREFIXES.session),
  workspace: () => generateId(ID_PREFIXES.workspace),
  project: () => generateId(ID_PREFIXES.project),
  artifact: () => generateId(ID_PREFIXES.artifact),
  artifactVersion: () => generateId(ID_PREFIXES.artifactVersion),
  approval: () => generateId(ID_PREFIXES.approval),
  agentRun: () => generateId(ID_PREFIXES.agentRun),
  task: () => generateId(ID_PREFIXES.task),
  auditEvent: () => generateId(ID_PREFIXES.auditEvent),
} satisfies Record<IdEntity, () => string>;
