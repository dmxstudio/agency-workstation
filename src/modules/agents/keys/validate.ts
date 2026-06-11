import type { LlmProviderKind } from "@/db/schema";

/**
 * Cheap provider-side key validation (§16: "validación de key al configurar").
 * Both providers expose a models listing that authenticates the key without
 * spending tokens:
 * - Anthropic: GET https://api.anthropic.com/v1/models (x-api-key)
 * - OpenAI:    GET https://api.openai.com/v1/models (Authorization: Bearer)
 *
 * The key only travels in the request header; it is never logged and the
 * outcome never embeds it.
 */

export type KeyValidationOutcome = "valid" | "invalid" | "unreachable";

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

export async function validateProviderKey(
  provider: LlmProviderKind,
  apiKey: string,
): Promise<KeyValidationOutcome> {
  // The mock provider is first-class for demo/e2e offline: always valid.
  if (provider === "mock") return "valid";

  const request: { url: string; headers: Record<string, string> } =
    provider === "anthropic"
      ? {
          url: ANTHROPIC_MODELS_URL,
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        }
      : {
          url: OPENAI_MODELS_URL,
          headers: { Authorization: `Bearer ${apiKey}` },
        };

  let response: Response;
  try {
    response = await fetch(request.url, { method: "GET", headers: request.headers });
  } catch {
    return "unreachable";
  }
  if (response.ok) return "valid";
  if (response.status === 401 || response.status === 403) return "invalid";
  return "unreachable";
}
