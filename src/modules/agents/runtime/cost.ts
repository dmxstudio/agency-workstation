import type { AgentRunUsage, LlmProviderKind } from "@/db/schema";

import { ANTHROPIC_PRICES_USD_PER_MTOK } from "./providers/anthropic";

/**
 * Cost of a provider call in USD (§9.1 costBudget / §9.6 "coste" del run).
 *
 * - Anthropic: fixed June-2026 price table by exact model id.
 * - OpenAI: BYOK with a configurable model id — no reliable static table, so
 *   cost is recorded as 0 until per-workspace pricing configuration exists
 *   (tokens are still recorded, which is what budgets will need).
 * - Mock: always 0.
 */
export function computeCostUsd(
  provider: LlmProviderKind,
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  if (provider === "anthropic") {
    const price = ANTHROPIC_PRICES_USD_PER_MTOK[modelId];
    if (price) {
      const cost =
        (usage.inputTokens / 1_000_000) * price.input +
        (usage.outputTokens / 1_000_000) * price.output;
      // 6 decimals: sub-cent precision without float noise in JSONB.
      return Math.round(cost * 1_000_000) / 1_000_000;
    }
  }
  return 0;
}

export function buildUsage(
  provider: LlmProviderKind,
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
): AgentRunUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: computeCostUsd(provider, modelId, usage),
  };
}
