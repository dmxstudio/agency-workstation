import {
  ARTIFACT_TYPE_KEYS,
  PROJECT_PHASES,
  getPhaseLabel,
  type ArtifactTypeDefinition,
  type ArtifactTypeKey,
  type ProjectPhaseKey,
} from "./definition";
import { specIntakeDefinition, type SpecIntakePayload } from "./spec-intake";
import { specStrategyDefinition, type SpecStrategyPayload } from "./spec-strategy";
import { specSitemapDefinition, type SpecSitemapPayload } from "./spec-sitemap";
import { contentPageDefinition, type ContentPagePayload } from "./content-page";
import { cmsCollectionsDefinition, type CmsCollectionsPayload } from "./cms-collections";
import { designTokensDefinition, type DesignTokensPayload } from "./design-tokens";
import { pageCompositionDefinition, type PageCompositionPayload } from "./page-composition";
import { releaseDefinition, type ReleasePayload } from "./release";

/**
 * Central typed registry of the 8 MVP artifact types (§19.2).
 * The dependency edges declared here ARE the fixed graph of §8.4.
 */

/** Payload TS type per artifact type key. */
export interface ArtifactPayloadMap {
  "spec.intake": SpecIntakePayload;
  "spec.strategy": SpecStrategyPayload;
  "spec.sitemap": SpecSitemapPayload;
  "content.page": ContentPagePayload;
  "cms.collections": CmsCollectionsPayload;
  "design.tokens": DesignTokensPayload;
  "page.composition": PageCompositionPayload;
  release: ReleasePayload;
}

export const artifactTypeRegistry: {
  readonly [K in ArtifactTypeKey]: ArtifactTypeDefinition<ArtifactPayloadMap[K]>;
} = {
  "spec.intake": specIntakeDefinition,
  "spec.strategy": specStrategyDefinition,
  "spec.sitemap": specSitemapDefinition,
  "content.page": contentPageDefinition,
  "cms.collections": cmsCollectionsDefinition,
  "design.tokens": designTokensDefinition,
  "page.composition": pageCompositionDefinition,
  release: releaseDefinition,
};

export function isArtifactTypeKey(type: string): type is ArtifactTypeKey {
  return (ARTIFACT_TYPE_KEYS as readonly string[]).includes(type);
}

/** Typed lookup for known keys; wide lookup (throws) for runtime strings. */
export function getArtifactType<K extends ArtifactTypeKey>(
  type: K,
): ArtifactTypeDefinition<ArtifactPayloadMap[K]>;
export function getArtifactType(type: string): ArtifactTypeDefinition;
export function getArtifactType(type: string): ArtifactTypeDefinition {
  if (!isArtifactTypeKey(type)) {
    throw new Error(`Unknown artifact type: ${type}`);
  }
  return artifactTypeRegistry[type];
}

/** Like `getArtifactType` but tolerant: `null` for unknown/legacy types. */
export function getArtifactTypeOrNull(type: string): ArtifactTypeDefinition | null {
  return isArtifactTypeKey(type) ? artifactTypeRegistry[type] : null;
}

/** Canonical ordering index (registry/phase order) for stable UI listings. */
export function artifactTypeOrder(type: string): number {
  const index = (ARTIFACT_TYPE_KEYS as readonly string[]).indexOf(type);
  return index === -1 ? ARTIFACT_TYPE_KEYS.length : index;
}

/** All definitions in canonical order. */
export function listArtifactTypes(): ArtifactTypeDefinition[] {
  return ARTIFACT_TYPE_KEYS.map((key) => artifactTypeRegistry[key]);
}

/** Definitions belonging to a phase, in canonical order (§8.5 gates). */
export function getArtifactTypesByPhase(phase: ProjectPhaseKey): ArtifactTypeDefinition[] {
  return listArtifactTypes().filter((definition) => definition.phase === phase);
}

/**
 * Downstream type keys that depend on `type` (reverse edges of the fixed
 * graph §8.4). Derived from the declared `dependsOn` lists.
 */
export function getDependentTypes(type: ArtifactTypeKey): ArtifactTypeKey[] {
  return ARTIFACT_TYPE_KEYS.filter((key) =>
    artifactTypeRegistry[key].dependsOn.includes(type),
  );
}

export { ARTIFACT_TYPE_KEYS, PROJECT_PHASES, getPhaseLabel };
export type { ArtifactTypeDefinition, ArtifactTypeKey, ProjectPhaseKey };
