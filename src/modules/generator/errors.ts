/**
 * Typed domain errors for the generator module. Codes are stable identifiers
 * (English); messages are user-facing (Spanish, UI language).
 */

export type GeneratorErrorCode =
  | "PROJECT_NOT_FOUND"
  | "REQUIREMENTS_NOT_MET"
  | "TEMPLATE_NOT_FOUND"
  | "ALREADY_GENERATED"
  | "NOT_GENERATED"
  | "GIT_FAILED"
  | "GENERATION_FAILED"
  | "FORBIDDEN";

export class GeneratorDomainError extends Error {
  readonly code: GeneratorErrorCode;
  readonly details?: unknown;

  constructor(code: GeneratorErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "GeneratorDomainError";
    this.code = code;
    this.details = details;
  }
}

export function isGeneratorDomainError(error: unknown): error is GeneratorDomainError {
  return error instanceof GeneratorDomainError;
}
