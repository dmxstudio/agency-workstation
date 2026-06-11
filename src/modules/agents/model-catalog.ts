/**
 * Catálogo de modelos LLM seleccionables y sus tarifas (junio 2026).
 *
 * Módulo PURO (sin imports de servidor): lo consumen tanto el runtime
 * (providers/cost/runner) como los client components del asistente — el
 * selector de modelo por invocación y la línea «Costo por MTok» que se
 * actualiza con la selección. No contiene secretos.
 */

/** Exact model ids (June 2026 — no date suffixes). NEVER invent others. */
export const ANTHROPIC_MODEL_IDS = [
  "claude-sonnet-4-6", // $3/$15 per MTok — sensible default for skills
  "claude-opus-4-8", // $5/$25 — most capable
  "claude-haiku-4-5", // $1/$5 — cheap
] as const;

export type AnthropicModelId = (typeof ANTHROPIC_MODEL_IDS)[number];

export const ANTHROPIC_DEFAULT_MODEL: AnthropicModelId = "claude-sonnet-4-6";

/** USD per MILLION tokens (input/output), June 2026. */
export const ANTHROPIC_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Metadatos de UI del selector de modelo (solo Anthropic tiene elección hoy). */
export const ANTHROPIC_MODEL_OPTIONS: ReadonlyArray<{
  id: AnthropicModelId;
  label: string;
  hint: string;
}> = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "equilibrio coste/calidad (default)" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", hint: "el más capaz" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "el más rápido y barato" },
];

/**
 * Tarifa legible para la UI («$3 in / $15 out por MTok»), o null si el
 * proveedor/modelo no tiene tarifa configurada (OpenAI hoy: coste est. $0).
 */
export function formatPricePerMTok(provider: string, modelId: string | null): string | null {
  if (provider === "mock") return "$0.00 — proveedor de demostración, sin llamadas externas";
  if (provider !== "anthropic" || !modelId) return null;
  const price = ANTHROPIC_PRICES_USD_PER_MTOK[modelId];
  if (!price) return null;
  return `$${price.input} in / $${price.output} out por MTok`;
}
