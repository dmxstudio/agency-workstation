import { z } from "zod";

import { defineArtifactType } from "./definition";
import { identifierSchema, nonEmptyString, stringList } from "./common";

/**
 * `design.tokens` — §7.2 Design System: tokens (color, tipografía, spacing,
 * radios) y selección de componentes del registry (§7.5).
 */

/** Mapa nombre-de-token → valor CSS (`primary` → `#111827`, `sm` → `0.5rem`). */
const tokenMapSchema = z.record(identifierSchema, nonEmptyString);

export const designTokensPayloadSchema = z.object({
  colors: tokenMapSchema.default({}),
  typography: z.object({
    fontFamilies: z.object({
      sans: nonEmptyString,
      serif: z.string().optional(),
      mono: z.string().optional(),
    }),
    baseSizePx: z.number().int().positive().default(16),
    /** Razón de la escala tipográfica (p.ej. 1.25). */
    scaleRatio: z.number().positive().optional(),
  }),
  spacing: tokenMapSchema.default({}),
  radii: tokenMapSchema.default({}),
  /** Componentes del registry seleccionados para el proyecto (§7.5). */
  components: stringList.default([]),
});

export type DesignTokensPayload = z.infer<typeof designTokensPayloadSchema>;

export const designTokensDefinition = defineArtifactType<DesignTokensPayload>({
  type: "design.tokens",
  schemaVersion: "1.0",
  label: "Design tokens",
  description: "Tokens de color, tipografía, spacing, radios y componentes del registry.",
  phase: "design",
  // §8.4: brand.inputs → design.tokens; brand inputs viven dentro de
  // spec.intake en MVP, pero el grafo fijo no declara esa arista para tokens.
  dependsOn: [],
  requiredForGate: true,
  payloadSchema: designTokensPayloadSchema,
});
