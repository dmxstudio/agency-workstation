/**
 * Typed domain errors for the review module (§7.7, §7.8). Codes are stable
 * identifiers (English); messages are user-facing (Spanish, UI language).
 */

export type ReviewErrorCode =
  | "PROJECT_NOT_FOUND"
  | "RELEASE_NOT_FOUND"
  | "REQUEST_NOT_FOUND"
  | "COMMENT_NOT_FOUND"
  | "INVALID_TOKEN"
  | "INVALID_STATE"
  | "CHECKLIST_NOT_PASSED"
  | "VALIDATION_FAILED"
  | "FORBIDDEN";

export class ReviewDomainError extends Error {
  readonly code: ReviewErrorCode;
  readonly details?: unknown;

  constructor(code: ReviewErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ReviewDomainError";
    this.code = code;
    this.details = details;
  }
}

export function isReviewDomainError(error: unknown): error is ReviewDomainError {
  return error instanceof ReviewDomainError;
}
