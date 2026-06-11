import {
  LlmProviderError,
  type LlmCompleteRequest,
  type LlmCompleteResult,
  type LlmProvider,
} from "../../types";
import { pickNumber, pickString, retryDelayMs, safeParseJson, sleep } from "./shared";

/**
 * OpenAI provider (second BYOK provider, §16) over Chat Completions:
 * POST https://api.openai.com/v1/chat/completions with `Authorization:
 * Bearer`, structured outputs via
 * `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`.
 *
 * Model id is conservative and configurable: `OPENAI_MODEL_ID` env (or the
 * per-call option) overrides the documented-as-adjustable default "gpt-4o".
 *
 * The API key lives ONLY in the factory closure.
 */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/** Documented-as-adjustable default; override via OPENAI_MODEL_ID. */
export const OPENAI_DEFAULT_MODEL = "gpt-4o";

export function resolveOpenAiModelId(explicit?: string | null): string {
  return explicit || process.env.OPENAI_MODEL_ID || OPENAI_DEFAULT_MODEL;
}

const RETRYABLE_STATUSES = new Set([429, 500, 503]);

export function createOpenAiProvider(options: {
  apiKey: string;
  modelId?: string;
}): LlmProvider {
  const modelId = resolveOpenAiModelId(options.modelId);
  const apiKey = options.apiKey; // closure-local: the ONLY place it lives

  async function requestOnce(body: string): Promise<Response> {
    try {
      return await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body,
      });
    } catch {
      throw new LlmProviderError(
        "NETWORK",
        "openai",
        "No se pudo conectar con la API de OpenAI.",
      );
    }
  }

  return {
    kind: "openai",
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
      const body = JSON.stringify({
        model: modelId,
        max_tokens: req.maxTokens,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "skill_proposal", schema: req.schema, strict: true },
        },
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
      const refusal = pickString(json, "choices.0.message.refusal");
      if (refusal) {
        throw new LlmProviderError(
          "REFUSED",
          "openai",
          "El modelo rechazó generar la propuesta (refusal). Ajusta el contenido o la instrucción.",
        );
      }
      const content = pickString(json, "choices.0.message.content");
      if (content == null) {
        throw new LlmProviderError(
          "INVALID_RESPONSE",
          "openai",
          "La respuesta del modelo no contiene contenido JSON.",
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new LlmProviderError(
          "INVALID_RESPONSE",
          "openai",
          "La respuesta del modelo no es JSON válido.",
        );
      }

      return {
        json: parsed,
        usage: {
          inputTokens: pickNumber(json, "usage.prompt_tokens"),
          outputTokens: pickNumber(json, "usage.completion_tokens"),
        },
        modelId: pickString(json, "model") ?? modelId,
      };
    },
  };
}

async function mapErrorResponse(response: Response): Promise<LlmProviderError> {
  const body = await safeParseJson(response);
  const apiMessage = pickString(body, "error.message") ?? "";
  const status = response.status;
  const detail = apiMessage ? ` Detalle del proveedor: ${apiMessage}` : "";

  if (status === 401) {
    return new LlmProviderError(
      "AUTH_FAILED",
      "openai",
      `OpenAI rechazó la API key del workspace (401). Revisa la key en los ajustes.${detail}`,
      { status },
    );
  }
  if (status === 429) {
    return new LlmProviderError(
      "RATE_LIMITED",
      "openai",
      `OpenAI devolvió 429 (rate limit/cuota) tras un reintento. Revisa la cuota de la cuenta.${detail}`,
      { status },
    );
  }
  if (status === 500 || status === 503) {
    return new LlmProviderError(
      "OVERLOADED",
      "openai",
      `OpenAI no está disponible (${status}) tras un reintento. Vuelve a lanzar el run en unos minutos.${detail}`,
      { status },
    );
  }
  if (status === 400) {
    return new LlmProviderError(
      "BAD_REQUEST",
      "openai",
      `OpenAI rechazó la petición (400).${detail}`,
      { status },
    );
  }
  return new LlmProviderError(
    "OVERLOADED",
    "openai",
    `Error inesperado de OpenAI (HTTP ${status}).${detail}`,
    { status },
  );
}
