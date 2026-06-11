/**
 * Public surface of the agents module (§7.9, §9, §19.5).
 *
 * DELIBERATELY NOT exported here:
 * - `keys/crypto.ts` and `getDecryptedKey`/`markKeyAuthFailed` from
 *   `keys/service.ts` — decryption is internal to the runtime; key values
 *   never cross this boundary (only id/provider/label/last4 do).
 * - The concrete providers — consumers see runs and skills, never raw
 *   `complete()` calls.
 *
 * Server actions are NOT re-exported either: import them directly from
 * `@/modules/agents/keys/actions` so the `"use server"` boundary stays intact.
 */

export {
  AGENT_SKILL_NAMES,
  AgentsDomainError,
  LlmProviderError,
  isAgentsDomainError,
  isLlmProviderError,
  type AgentActor,
  type AgentSkillName,
  type AgentsErrorCode,
  type AgentRunInputArtifact,
  type AgentRunUsage,
  type AgentRunValidation,
  type ContextArtifact,
  type ContextDependencyEdge,
  type JsonSchema,
  type LlmCompleteRequest,
  type LlmCompleteResult,
  type LlmErrorCode,
  type LlmProvider,
  type LlmProviderKind,
  type ProjectContext,
  type SkillContextRead,
  type SkillDefinition,
  type SkillPrompt,
  type SkillPromptInput,
} from "./types";

export { getProjectContext, type GetProjectContextOptions } from "./context";

export { addKey, deleteKey, listKeys, type AddKeyInput, type LlmKeyPublic } from "./keys/service";

export {
  getAgentRun,
  listAgentRuns,
  startRun,
  waitForRunSettled,
  type StartRunParams,
} from "./runtime/runner";

export { recordRunDecision, type RunDecisionInput } from "./runtime/decisions";

export { MOCK_MODEL_ID } from "./runtime/providers/mock";
export {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MODEL_IDS,
} from "./runtime/providers/anthropic";
export { OPENAI_DEFAULT_MODEL } from "./runtime/providers/openai";
export { computeCostUsd } from "./runtime/cost";
