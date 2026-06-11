import {
  LlmProviderError,
  type LlmCompleteRequest,
  type LlmCompleteResult,
  type LlmProvider,
} from "../../types";
import { pick, pickNumber, pickString, retryDelayMs, safeParseJson, sleep } from "./shared";

/**
 * Anthropic provider over the Messages API (verified June 2026).
 *
 * - POST https://api.anthropic.com/v1/messages with `x-api-key` +
 *   `anthropic-version: 2023-06-01`.
 * - Structured outputs via `output_config.format` (type "json_schema");
 *   the top-level `output_format` is deprecated and assistant prefills 400.
 * - No `temperature`/`top_p`/`top_k` (removed in Opus 4.7+), no `thinking`.
 * - Errors: 401 AUTH_FAILED (key flagged by the runner), 429/529/500 get ONE
 *   retry with backoff, 400 reports without retry, `stop_reason: "refusal"`
 *   fails the run with a clear message.
 *
 * The API key lives ONLY in the factory closure: never on the provider
 * object, never in errors, never logged.
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Ids y tarifas viven en el catálogo puro (client-safe) para que el selector
// de modelo del asistente los comparta sin arrastrar el provider al bundle.
export {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MODEL_IDS,
  ANTHROPIC_PRICES_USD_PER_MTOK,
} from "../../model-catalog";
import { ANTHROPIC_DEFAULT_MODEL } from "../../model-catalog";

const RETRYABLE_STATUSES = new Set([429, 500, 529]);

export function createAnthropicProvider(options: {
  apiKey: string;
  modelId?: string;
}): LlmProvider {
  const modelId = options.modelId ?? ANTHROPIC_DEFAULT_MODEL;
  const apiKey = options.apiKey; // closure-local: the ONLY place it lives

  async function requestOnce(body: string): Promise<Response> {
    try {
      return await fetch(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body,
      });
    } catch {
      throw new LlmProviderError(
        "NETWORK",
        "anthropic",
        "No se pudo conectar con la API de Anthropic.",
      );
    }
  }

  return {
    kind: "anthropic",
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
      const body = JSON.stringify({
        model: modelId,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: { type: "json_schema", schema: req.schema } },
      });

      let response = await requestOnce(body);
      if (!response.ok && RETRYABLE_STATUSES.has(response.status)) {
        await sleep(retryDelayMs(response));
        response = await requestOnce(body); // exactly ONE retry
      }

      if (!response.ok) {
        throw await mapErrorResponse(response);
      }

      const json = await safeParseJson(response);
      const stopReason = pickString(json, "stop_reason");
      if (stopReason === "refusal") {
        throw new LlmProviderError(
          "REFUSED",
          "anthropic",
          "El modelo rechazó generar la propuesta (refusal). Ajusta el contenido o la instrucción.",
        );
      }
      const content = pick(json, "content");
      const textBlock = Array.isArray(content)
        ? content.find((block) => pickString(block, "type") === "text")
        : undefined;
      const text = pickString(textBlock, "text");
      if (text == null) {
        throw new LlmProviderError(
          "INVALID_RESPONSE",
          "anthropic",
          "La respuesta del modelo no contiene texto JSON.",
        );
      }
      if (stopReason === "max_tokens") {
        throw new LlmProviderError(
          "INVALID_RESPONSE",
          "anthropic",
          "La respuesta se truncó por max_tokens; la propuesta JSON está incompleta.",
        );
      }

      let parsed: unknown;
      try {
        // With json_schema structured outputs, the text IS the JSON.
        parsed = JSON.parse(text);
      } catch {
        throw new LlmProviderError(
          "INVALID_RESPONSE",
          "anthropic",
          "La respuesta del modelo no es JSON válido.",
        );
      }

      return {
        json: parsed,
        usage: {
          inputTokens: pickNumber(json, "usage.input_tokens"),
          outputTokens: pickNumber(json, "usage.output_tokens"),
        },
        modelId: pickString(json, "model") ?? modelId,
      };
    },
  };
}

/** Error body: `{type:"error", error:{type, message}, request_id}`. */
async function mapErrorResponse(response: Response): Promise<LlmProviderError> {
  const body = await safeParseJson(response);
  const apiMessage = pickString(body, "error.message") ?? "";
  const requestId = pickString(body, "request_id");
  const status = response.status;
  const detail = apiMessage ? ` Detalle del proveedor: ${apiMessage}` : "";

  if (status === 401) {
    return new LlmProviderError(
      "AUTH_FAILED",
      "anthropic",
      `Anthropic rechazó la API key del workspace (401 authentication_error). Revisa la key en los ajustes.${detail}`,
      { status, requestId },
    );
  }
  if (status === 429) {
    return new LlmProviderError(
      "RATE_LIMITED",
      "anthropic",
      `Anthropic devolvió 429 rate_limit_error tras un reintento. Espera unos minutos o revisa la cuota de la cuenta.${detail}`,
      { status, requestId },
    );
  }
  if (status === 529 || status === 500) {
    return new LlmProviderError(
      "OVERLOADED",
      "anthropic",
      `Anthropic no está disponible (${status}) tras un reintento. Vuelve a lanzar el run en unos minutos.${detail}`,
      { status, requestId },
    );
  }
  if (status === 400) {
    return new LlmProviderError(
      "BAD_REQUEST",
      "anthropic",
      `Anthropic rechazó la petición (400 invalid_request_error).${detail}`,
      { status, requestId },
    );
  }
  return new LlmProviderError(
    "OVERLOADED",
    "anthropic",
    `Error inesperado de Anthropic (HTTP ${status}).${detail}`,
    { status, requestId },
  );
}
