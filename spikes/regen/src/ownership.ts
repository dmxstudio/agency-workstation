import { createHash } from "node:crypto";

/**
 * Ownership model (§16, §18.2): every generated project file is either
 * owned-by-codegen (regeneration may rewrite it, IF the human has not touched
 * it) or owned-by-human (regeneration must never write it).
 *
 * Granularity in this spike: WHOLE FILE. Zone-within-file is discussed (and
 * deliberately not built) in the report.
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
  spike: "regen";
  manifestVersion: 1;
  /** Relative path → entry. Keys sorted for deterministic serialization. */
  files: Record<string, ManifestEntry>;
}

export const MANIFEST_FILENAME = "ownership.manifest.json";

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Header injected at the top of every codegen-owned source file. */
export function codegenHeader(bodyHash: string): string {
  return [
    "/**",
    " * @generated agency-workstation spike-regen — DO NOT EDIT.",
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
  return (
    JSON.stringify({ ...manifest, files: sortedFiles }, null, 2) + "\n"
  );
}

export function parseManifest(raw: string): OwnershipManifest {
  const parsed = JSON.parse(raw) as OwnershipManifest;
  if (parsed.spike !== "regen" || parsed.manifestVersion !== 1) {
    throw new Error("Manifest de ownership desconocido o de otra versión.");
  }
  return parsed;
}
