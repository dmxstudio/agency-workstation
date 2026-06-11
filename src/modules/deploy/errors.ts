/**
 * Typed domain errors for the deploy module. Codes are stable identifiers
 * (English); messages are user-facing (Spanish, UI language).
 */

export type DeployErrorCode =
  | "PROJECT_REPO_NOT_FOUND"
  | "TAG_NOT_FOUND"
  | "GIT_FAILED"
  | "BUILD_FAILED"
  | "BUILD_NOT_FOUND"
  | "DEPENDENCIES_UNAVAILABLE"
  | "PORT_IN_USE"
  | "DEPLOY_FAILED"
  | "READINESS_TIMEOUT"
  | "STOP_FAILED"
  // Service-layer codes (src/modules/deploy/service.ts — DB + governance):
  | "PROJECT_NOT_FOUND"
  | "RELEASE_NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_FAILED";

export class DeployDomainError extends Error {
  readonly code: DeployErrorCode;
  readonly details?: unknown;

  constructor(code: DeployErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DeployDomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDeployDomainError(error: unknown): error is DeployDomainError {
  return error instanceof DeployDomainError;
}
