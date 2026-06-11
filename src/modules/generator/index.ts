/**
 * Public surface of the generator module (§7.3, §18.2, §19.5).
 *
 * Server actions are NOT re-exported here: import them directly from
 * `@/modules/generator/actions` so the `"use server"` boundary stays intact.
 */

export { type Conflict, type ConflictKind, formatConflict } from "./conflicts";
export {
  GeneratorDomainError,
  isGeneratorDomainError,
  type GeneratorErrorCode,
} from "./errors";
export {
  MANIFEST_FILENAME,
  parseManifest,
  serializeManifest,
  sha256,
  withCodegenHeader,
  type FileOwner,
  type ManifestEntry,
  type OwnershipManifest,
} from "./ownership";
export {
  getGeneratedSiteUrl,
  getProjectRepoDir,
  getProjectsBaseDir,
  getTemplateDir,
} from "./paths";
export {
  flattenSitemap,
  compositionFilePath,
  collectionFilePath,
  renderCodegenFiles,
  renderHumanScaffolds,
  renderSeedContent,
  slugify,
  type FlatPage,
  type GeneratorInput,
} from "./render";
export {
  engineGenerate,
  engineRegenerate,
  hasManifest,
  readManifest,
  type EngineGenerateResult,
  type EngineRegenerateResult,
} from "./engine";
export { gitLog, gitTag, gitListTags } from "./git";
export {
  GENERATION_INPUT_TYPES,
  generateProject,
  regenerateProject,
  getGenerations,
  getGenerationRequirements,
  type GenerationRequirement,
  type GenerationResult,
  type GenerationSummary,
  type GenerationWithActor,
  type HumanActor,
} from "./service";
