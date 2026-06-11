import type { DesignTokensPayload } from "@/modules/artifacts";

/**
 * `design.tokens` aprobado → bloque CSS de variables para el canvas del Studio.
 *
 * SINCRONIZADO A MANO con el codegen del generator:
 * `src/modules/generator/render.ts` → `renderTokensCss()` (que emite
 * `src/generated/tokens.css` en el proyecto generado). La regla de límites de
 * módulos (CLAUDE.md §19.5) impide importar `generator` desde `studio`, así
 * que la lógica de mapeo se DUPLICA aquí; única diferencia deliberada: sin el
 * header `@generated` (esto se inyecta en un `<style>` dentro del iframe del
 * canvas, no se escribe a disco). Si cambia el mapeo allí, cambiarlo aquí
 * (mismo orden, mismos prefijos), o el canvas y el sitio publicado divergen.
 *
 * Mapeo (idéntico al generator):
 * - `colors`  → `--<nombre>` 1:1 (`brand-600` → `--brand-600`), orden alfabético.
 * - tipografía → `--font-sans`, `--font-serif?`, `--font-mono?`,
 *   `--font-size-base`, `--type-scale-ratio?`.
 * - `spacing` → `--space-<nombre>`; `radii` → `--radius-<nombre>`.
 *
 * Las utilities `brand-*` del registry (mapeadas en `src/app/globals.css` de
 * la plataforma y en el `globals.css` del template) resuelven contra estas
 * variables: inyectar este bloque dentro del iframe re-tematiza el canvas con
 * la marca del proyecto sin tocar los componentes.
 */

function cssVarLines(map: Record<string, string>, prefix = ""): string[] {
  return Object.keys(map)
    .sort()
    .map((name) => `  --${prefix}${name}: ${map[name]};`);
}

export function tokensCss(tokens: DesignTokensPayload): string {
  const lines: string[] = [":root {"];
  lines.push(...cssVarLines(tokens.colors));
  lines.push(`  --font-sans: ${tokens.typography.fontFamilies.sans};`);
  if (tokens.typography.fontFamilies.serif) {
    lines.push(`  --font-serif: ${tokens.typography.fontFamilies.serif};`);
  }
  if (tokens.typography.fontFamilies.mono) {
    lines.push(`  --font-mono: ${tokens.typography.fontFamilies.mono};`);
  }
  lines.push(`  --font-size-base: ${tokens.typography.baseSizePx}px;`);
  if (tokens.typography.scaleRatio != null) {
    lines.push(`  --type-scale-ratio: ${tokens.typography.scaleRatio};`);
  }
  lines.push(...cssVarLines(tokens.spacing, "space-"));
  lines.push(...cssVarLines(tokens.radii, "radius-"));
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}
