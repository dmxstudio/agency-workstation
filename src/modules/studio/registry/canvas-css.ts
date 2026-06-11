import type { DesignTokensPayload } from "@/modules/artifacts";
import { tokensCss } from "./tokens-css";

/**
 * CSS base del CANVAS del Studio (el sitio del cliente dentro del iframe).
 *
 * Por qué existe: el design-lint de la plataforma purga la paleta por defecto
 * de Tailwind (`--color-*: initial` en `src/app/globals.css`, §11.4), así que
 * el build de la plataforma NUNCA emite las utilities `neutral-*`/`amber-*`
 * que usan los componentes del registry (el template las obtiene de la paleta
 * por defecto de su propio build). Puck copia las hojas de estilo del
 * documento padre dentro del iframe; estas reglas faltan ahí y se inyectan
 * aparte.
 *
 * Contenido: EXACTAMENTE las clases de color que usa el registry
 * (`src/modules/studio/registry/**`) y que la plataforma no genera. Valores =
 * paleta por defecto de Tailwind v4 (`node_modules/tailwindcss/theme.css`),
 * la misma que resuelve el build del template — el canvas y el sitio
 * publicado quedan idénticos. Las clases estructurales (grid, spacing,
 * tipografía) y las `brand-*`/`white` SÍ las emite el build de la plataforma.
 *
 * Si añades una clase de color neutral/amber a un componente del registry,
 * añade su regla aquí (ver README.md, checklist de sincronización).
 */
export const canvasBaseCss = `
.bg-neutral-50{background-color:oklch(98.5% 0 0)}
.bg-neutral-100{background-color:oklch(97% 0 0)}
.bg-neutral-300{background-color:oklch(87% 0 0)}
.bg-neutral-900{background-color:oklch(20.5% 0 0)}
.bg-neutral-950{background-color:oklch(14.5% 0 0)}
.hover\\:bg-neutral-100:hover{background-color:oklch(97% 0 0)}
.text-neutral-50{color:oklch(98.5% 0 0)}
.text-neutral-400{color:oklch(70.8% 0 0)}
.text-neutral-500{color:oklch(55.6% 0 0)}
.text-neutral-600{color:oklch(43.9% 0 0)}
.text-neutral-900{color:oklch(20.5% 0 0)}
.text-amber-500{color:oklch(76.9% 0.188 70.08)}
.border-neutral-200{border-color:oklch(92.2% 0 0)}
.border-neutral-300{border-color:oklch(87% 0 0)}
.border-neutral-800{border-color:oklch(26.9% 0 0)}
.divide-neutral-200 > :not(:last-child){border-color:oklch(92.2% 0 0)}
`;

/**
 * CSS completo a inyectar dentro del iframe del canvas (vía
 * `overrides.iframe` de Puck, DESPUÉS de las hojas copiadas del padre para
 * ganar la cascada): paleta base del sitio + variables del `design.tokens`
 * aprobado del proyecto. Sin tokens aprobados, las utilities `brand-*` caen a
 * los defaults neutros declarados en `src/app/globals.css`.
 */
export function studioCanvasCss(tokens: DesignTokensPayload | null): string {
  return tokens ? `${canvasBaseCss}\n${tokensCss(tokens)}` : canvasBaseCss;
}
