/**
 * Public surface of the artifacts domain module (§19.5).
 *
 * Server actions are NOT re-exported here: import them directly from
 * `@/modules/artifacts/actions` so the `"use server"` boundary stays intact.
 */

export * from "./types";
export {
  listCompositionBindings,
  validateCompositionBindings,
  parseAnyComposition,
  type AnyComposition,
  type BindingConflict,
  type CompositionBinding,
  type CompositionBindingKind,
} from "./bindings";
export { diffPayloads, deepEqual, type DiffChange, type DiffChangeType } from "./diff";
export {
  ArtifactDomainError,
  ArtifactValidationError,
  isArtifactDomainError,
  type ArtifactErrorCode,
  type ValidationIssue,
} from "./errors";
export {
  ensureProjectArtifacts,
  syncCompositionArtifacts,
  saveDraft,
  submitForReview,
  approve,
  reject,
  revalidate,
  lockArtifact,
  unlockArtifact,
  getArtifactWithHistory,
  getProjectArtifacts,
  computeDiff,
  getPhaseGates,
  type HumanActor,
  type ApproveResult,
  type ArtifactWithHistory,
  type ProjectArtifact,
  type ComputedDiff,
  type ComputeDiffOptions,
  type PhaseGate,
  type SyncCompositionsResult,
} from "./service";
