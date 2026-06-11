import type { z } from "zod";

/**
 * Foundation for artifact type definitions (§8.1, §19.2).
 *
 * This file has NO imports from concrete type modules so that each
 * `types/*.ts` can import it without cycles; `registry.ts` closes the loop.
 */

/** The 8 MVP artifact type keys (§19.2). Order here is the canonical sort order. */
export const ARTIFACT_TYPE_KEYS = [
  "spec.intake",
  "spec.strategy",
  "spec.sitemap",
  "content.page",
  "cms.collections",
  "design.tokens",
  "page.composition",
  "release",
] as const;

export type ArtifactTypeKey = (typeof ARTIFACT_TYPE_KEYS)[number];

/**
 * Project phases for the Cockpit gates (§7.2, §8.5).
 * Order is the canonical phase progression.
 */
export const PROJECT_PHASES = [
  { key: "intake", label: "Intake" },
  { key: "strategy", label: "Estrategia" },
  { key: "ia", label: "Arquitectura de información" },
  { key: "content", label: "Sistema de contenido" },
  { key: "cms", label: "Modelo de datos (CMS)" },
  { key: "design", label: "Sistema de diseño" },
  { key: "composition", label: "Composición de páginas" },
  { key: "release", label: "Release" },
] as const;

export type ProjectPhaseKey = (typeof PROJECT_PHASES)[number]["key"];

export function getPhaseLabel(phase: ProjectPhaseKey): string {
  const found = PROJECT_PHASES.find((p) => p.key === phase);
  return found ? found.label : phase;
}

/**
 * Static definition of an artifact type: payload schema, human label (es),
 * phase it belongs to and its FIXED dependency edges (§8.4 — declared, never
 * inferred). `dependsOn` lists UPSTREAM types this type depends on.
 */
export interface ArtifactTypeDefinition<TPayload = unknown> {
  readonly type: ArtifactTypeKey;
  /** Version of the Zod payload schema (stored on each artifact row). */
  readonly schemaVersion: string;
  /** Human-readable label, Spanish (UI language). */
  readonly label: string;
  /** Short Spanish description for the Cockpit / Spec OS. */
  readonly description: string;
  /** Phase whose gate aggregates this artifact (§8.5). */
  readonly phase: ProjectPhaseKey;
  /** Upstream artifact types this type DEPENDS ON (§8.4 fixed MVP graph). */
  readonly dependsOn: readonly ArtifactTypeKey[];
  /** Whether the phase gate requires this artifact approved (§8.5). MVP: all true. */
  readonly requiredForGate: boolean;
  /**
   * Multi-instance type (§8.1 `page.*`): instances are keyed per row
   * (`artifacts.key`, e.g. the page path for `page.composition`).
   * `ensureProjectArtifacts` does NOT instantiate these as singletons;
   * `syncCompositionArtifacts` derives them from the approved sitemap.
   * Omitted/false = singleton (one row per project and type).
   */
  readonly multiInstance?: boolean;
  /** Zod schema validated on EVERY payload write (drafts and versions). */
  readonly payloadSchema: z.ZodType<TPayload>;
}

/** Identity helper that preserves the concrete payload type. */
export function defineArtifactType<TPayload>(
  definition: ArtifactTypeDefinition<TPayload>,
): ArtifactTypeDefinition<TPayload> {
  return definition;
}
