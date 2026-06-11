/**
 * Public surface of the review module (§7.7, §7.8, §8.5, §12.2, §19.5).
 *
 * Module boundaries: review → artifacts (sealing releases, binding
 * validation), review → generator (checklist over the generated repo + git
 * tag), review → platform-core (audit). Nothing imports review except `app`.
 *
 * Server actions are NOT re-exported here: import them directly from
 * `@/modules/review/actions` so the `"use server"` boundary stays intact.
 */

export {
  ReviewDomainError,
  isReviewDomainError,
  type ReviewErrorCode,
} from "./errors";
export {
  RELEASE_CHECKLIST_KEYS,
  runReleaseChecklist,
  createRelease,
  createReviewRequest,
  listReviewRequests,
  getReviewByToken,
  addClientComment,
  addTeamComment,
  resolveComment,
  addClientApproval,
  closeReviewRequest,
  type AddClientApprovalInput,
  type AddClientCommentInput,
  type AddTeamCommentInput,
  type CreateReleaseResult,
  type HumanActor,
  type ReleaseChecklistKey,
  type ReviewPage,
  type ReviewRequestSummary,
  type ReviewSurface,
} from "./service";
