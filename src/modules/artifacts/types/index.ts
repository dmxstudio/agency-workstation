/** Public surface of the artifact type system (§19.2 + fixed graph §8.4). */

export {
  ARTIFACT_TYPE_KEYS,
  PROJECT_PHASES,
  getPhaseLabel,
  defineArtifactType,
  type ArtifactTypeDefinition,
  type ArtifactTypeKey,
  type ProjectPhaseKey,
} from "./definition";

export {
  artifactTypeRegistry,
  getArtifactType,
  getArtifactTypeOrNull,
  getArtifactTypesByPhase,
  getDependentTypes,
  isArtifactTypeKey,
  artifactTypeOrder,
  listArtifactTypes,
  type ArtifactPayloadMap,
} from "./registry";

export { slugSchema, identifierSchema, ctaSchema, type Cta } from "./common";

export {
  specIntakePayloadSchema,
  specIntakeDefinition,
  type SpecIntakePayload,
} from "./spec-intake";
export {
  specStrategyPayloadSchema,
  specStrategyDefinition,
  type SpecStrategyPayload,
} from "./spec-strategy";
export {
  specSitemapPayloadSchema,
  specSitemapDefinition,
  sitemapNodeSchema,
  getSitemapSlugs,
  type SpecSitemapPayload,
  type SitemapNode,
} from "./spec-sitemap";
export {
  contentPagePayloadSchema,
  contentPageDefinition,
  contentSectionSchema,
  pageContentSchema,
  type ContentPagePayload,
  type PageContent,
  type ContentSection,
} from "./content-page";
export {
  cmsCollectionsPayloadSchema,
  cmsCollectionsDefinition,
  cmsCollectionSchema,
  cmsFieldSchema,
  cmsFieldTypeSchema,
  type CmsCollectionsPayload,
  type CmsCollection,
  type CmsField,
  type CmsFieldType,
} from "./cms-collections";
export {
  designTokensPayloadSchema,
  designTokensDefinition,
  type DesignTokensPayload,
} from "./design-tokens";
export {
  pageCompositionPayloadSchema,
  pageCompositionDefinition,
  pageCompositionItemSchema,
  compositionSectionSchema,
  type PageCompositionPayload,
  type PageCompositionItem,
  type CompositionSection,
} from "./page-composition";
export {
  releasePayloadSchema,
  releaseDefinition,
  releaseTargetSchema,
  type ReleasePayload,
  type ReleaseTarget,
} from "./release";
