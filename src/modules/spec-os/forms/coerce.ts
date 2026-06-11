/**
 * Normalizadores defensivos: los formularios reciben `unknown` (drafts
 * antiguos, versiones selladas o scaffolds) y lo convierten a su forma
 * editable sin lanzar nunca. Campos desconocidos se descartan.
 */

export function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  return asArray(value).map((item) => asString(item));
}

/** Mapa string→string (tokens de diseño, bindings). */
export function asStringRecord(value: unknown): Record<string, string> {
  const source = asObject(value);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    out[key] = asString(item);
  }
  return out;
}

/** `""` → `undefined` para campos opcionales (evita ruido en diffs y regex Zod). */
export function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : value;
}
