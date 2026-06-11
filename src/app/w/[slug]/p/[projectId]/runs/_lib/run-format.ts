import type { AgentRunStatus } from "@/db/schema";
import { getArtifactTypeOrNull } from "@/modules/artifacts";

/**
 * Helpers puros de presentación de agent runs (lista + detalle, §19.6-c).
 * Sin DB, sin React: formato de etiquetas, coste, tokens y errorDetail.
 */

export const RUN_STATUSES: readonly AgentRunStatus[] = [
  "queued",
  "running",
  "proposed",
  "approved",
  "rejected",
  "failed",
];

export const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  queued: "En cola",
  running: "Ejecutando",
  proposed: "Propuesta",
  approved: "Aprobado",
  rejected: "Rechazado",
  failed: "Fallido",
};

export function isRunStatus(value: string): value is AgentRunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

/** ¿El run sigue vivo (la UI debe seguir haciendo polling)? */
export function isRunLive(status: AgentRunStatus): boolean {
  return status === "queued" || status === "running";
}

/** Referencia exacta skill@versión que registra el run (§9.1, mono en UI). */
export function skillRef(skill: string, skillVersion: string): string {
  return `${skill}@${skillVersion}`;
}

/**
 * Etiqueta humana del target: label propio del artefacto keyed
 * ("Composición: Servicios") ?? label del tipo ?? type crudo, igual que
 * `getProjectArtifacts`. Para tipos multi-instancia sin artifact resuelto se
 * añade la key.
 */
export function targetLabel(
  targetType: string,
  targetKey: string | null,
  artifactLabel?: string | null,
): string {
  if (artifactLabel) return artifactLabel;
  const base = getArtifactTypeOrNull(targetType)?.label ?? targetType;
  return targetKey ? `${base} · ${targetKey}` : base;
}

const tokenFormatter = new Intl.NumberFormat("es");

export function formatTokens(value: number): string {
  return tokenFormatter.format(value);
}

/**
 * Coste estimado en USD (§9.6). 0 con proveedor real significa "sin tabla de
 * precios para ese modelo" (decisión documentada en runtime/cost.ts), por eso
 * el caller decide si lo muestra.
 */
export function formatCostUsd(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// errorDetail ("CODE: mensaje") — diferenciado por §16: cuota/auth/refusal
// ---------------------------------------------------------------------------

export interface ParsedRunError {
  code: string;
  message: string;
  /** Explicación accionable en español para los códigos conocidos (§16). */
  hint: string | null;
}

const ERROR_HINTS: Record<string, string> = {
  AUTH_FAILED:
    "El proveedor rechazó la API key (401): la key quedó marcada como inválida. Revísala o añade otra en Ajustes → API keys.",
  RATE_LIMITED:
    "Cuota del proveedor excedida (429) incluso tras el reintento. Espera y vuelve a lanzar la skill.",
  OVERLOADED:
    "El proveedor estaba sobrecargado (529/5xx) incluso tras el reintento. Vuelve a lanzar la skill más tarde.",
  REFUSED:
    "El modelo se negó a generar la propuesta (refusal). Ajusta la instrucción o el contenido del contexto.",
  BAD_REQUEST:
    "El proveedor rechazó la petición (400, sin reintento). Suele indicar un schema o prompt inválido — reporta este run.",
  INVALID_RESPONSE:
    "La respuesta del modelo no era el JSON esperado por el schema. Reintenta; si persiste, reporta este run.",
  NETWORK: "Fallo de red al llamar al proveedor. Comprueba la conectividad y reintenta.",
  NO_KEY:
    "El workspace no tiene una API key del proveedor. Añádela en Ajustes → API keys (BYOK) o usa el proveedor mock.",
};

export function parseRunError(errorDetail: string): ParsedRunError {
  const match = errorDetail.match(/^([A-Z_]+):\s*([\s\S]*)$/);
  if (!match) return { code: "UNEXPECTED", message: errorDetail, hint: null };
  return { code: match[1], message: match[2], hint: ERROR_HINTS[match[1]] ?? null };
}
