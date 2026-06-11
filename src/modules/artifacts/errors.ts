/**
 * Typed domain errors for the artifacts module. Codes are stable identifiers
 * (English); messages are user-facing (Spanish, UI language).
 */

export type ArtifactErrorCode =
  | "PROJECT_NOT_FOUND"
  | "ARTIFACT_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "UNKNOWN_TYPE"
  | "VALIDATION_FAILED"
  | "INVALID_STATE"
  | "LOCKED"
  | "NOT_OUTDATED"
  | "FORBIDDEN";

export class ArtifactDomainError extends Error {
  readonly code: ArtifactErrorCode;
  readonly details?: unknown;

  constructor(code: ArtifactErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ArtifactDomainError";
    this.code = code;
    this.details = details;
  }
}

export interface ValidationIssue {
  /** Dot path inside the payload, e.g. `pages[0].slug`. */
  path: string;
  message: string;
}

export class ArtifactValidationError extends ArtifactDomainError {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[]) {
    super("VALIDATION_FAILED", message, issues);
    this.name = "ArtifactValidationError";
    this.issues = issues;
  }
}

export function isArtifactDomainError(error: unknown): error is ArtifactDomainError {
  return error instanceof ArtifactDomainError;
}
