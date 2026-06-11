import { createHash } from "node:crypto";

/**
 * Ownership model (§16, §18.2): every tracked file in a generated project is
 * either owned-by-codegen (regeneration may rewrite it IF the human has not
 * touched it) or owned-by-human (regeneration must never write it again).
 *
 * Granularity: WHOLE FILE (validated decision of the §18.2 spike — the
 * generated layout keeps human "slots" in separate files so per-file ownership
 * is the norm; in-file codegen zones are deliberately postponed).
 *
 * Files copied verbatim from the project template are NOT tracked in the
 * manifest: anything absent from the manifest is implicitly human territory
 * and the generator never rewrites it after the initial copy.
 *
 * Ported from `spikes/regen/src/ownership.ts` (validated spike code).
 */

export type FileOwner = "codegen" | "human";

export interface ManifestEntry {
  owner: FileOwner;
  /**
   * sha256 of the file content as last written by codegen.
   * `null` for human-owned files: codegen only scaffolds them once and never
   * compares or rewrites them afterwards.
   */
  contentHash: string | null;
}

export interface OwnershipManifest {
  generator: "agency-workstation";
  manifestVersion: 1;
  /** Relative path → entry. Keys sorted for deterministic serialization. */
  files: Record<string, ManifestEntry>;
}

export const MANIFEST_FILENAME = "ownership.manifest.json";

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function emptyManifest(): OwnershipManifest {
  return { generator: "agency-workstation", manifestVersion: 1, files: {} };
}

/**
 * Header injected at the top of codegen-owned source files (.ts/.css — the
 * block-comment syntax is valid in both). It is SIGNALING for humans; the
 * manifest hash is the actual source of truth for edit detection, so removing
 * the header is still detected. JSON codegen files carry no header (comments
 * are not valid JSON); they are tracked through the manifest alone.
 */
export function codegenHeader(bodyHash: string): string {
  return [
    "/**",
    " * @generated agency-workstation — DO NOT EDIT.",
    " * owned-by-codegen: manual edits are detected on regeneration and",
    " * reported as conflicts; they are never merged or overwritten silently.",
    ` * content-hash: sha256:${bodyHash}`,
    " */",
    "",
  ].join("\n");
}

/** Wraps a generated body with the marker header (hash covers the body only). */
export function withCodegenHeader(body: string): string {
  return codegenHeader(sha256(body)) + body;
}

export function serializeManifest(manifest: OwnershipManifest): string {
  const sortedFiles: Record<string, ManifestEntry> = {};
  for (const key of Object.keys(manifest.files).sort()) {
    const entry = manifest.files[key];
    if (entry) sortedFiles[key] = entry;
  }
  return JSON.stringify({ ...manifest, files: sortedFiles }, null, 2) + "\n";
}

export function parseManifest(raw: string): OwnershipManifest {
  const parsed = JSON.parse(raw) as OwnershipManifest;
  if (parsed.generator !== "agency-workstation" || parsed.manifestVersion !== 1) {
    throw new Error("Manifest de ownership desconocido o de otra versión.");
  }
  return parsed;
}
