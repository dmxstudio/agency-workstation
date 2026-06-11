import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from "../../types";

/**
 * Mock provider — FIRST-CLASS citizen for demo and offline e2e (§16 decision).
 *
 * Deterministic by construction: no clock, no randomness, no network. The
 * proposal content comes from the skill's own `buildMockProposal` (each skill
 * knows how to produce a plausible, schema-VALID Spanish payload from the
 * context); the runner wires it in through the factory closure so the
 * provider interface stays identical across anthropic | openai | mock.
 */

export const MOCK_MODEL_ID = "mock-deterministic-1";

/** Deterministic ~4-chars-per-token estimate (stable across runs). */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createMockProvider(options: {
  /** Skill-provided deterministic proposal builder (already context-bound). */
  buildProposal: () => unknown;
}): LlmProvider {
  return {
    kind: "mock",
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
      const json = options.buildProposal();
      return {
        json,
        usage: {
          inputTokens: estimateTokens(req.system + req.user),
          outputTokens: estimateTokens(JSON.stringify(json) ?? ""),
        },
        modelId: MOCK_MODEL_ID,
      };
    },
  };
}
