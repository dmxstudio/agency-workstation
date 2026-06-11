import { z } from "zod";

import { defineArtifactType } from "./definition";
import { identifierSchema, nonEmptyString, slugSchema } from "./common";

/**
 * `page.composition` — §7.4/§11.2: la composición de UNA página del sitemap
 * aprobado. Tipo MULTI-INSTANCIA: un artefacto por página, keyed por el path
 * de la página (`artifacts.key`, p.ej. `servicios`, `legal/terms`). Los
 * artefactos se derivan del sitemap con `syncCompositionArtifacts`.
 *
 * schemaVersion 2.0 — BREAKING vs. 1.0: el payload ya no es la lista
 * `{ pages: [{ slug, sections }] }` sino el **Data JSON de Puck** que usa el
 * renderer del template (`templates/project-base`, `@puckeditor/core` 0.21):
 *
 * ```json
 * {
 *   "root": { "props": { "title": "…", "description": "…" } },
 *   "content": [ { "type": "Hero", "props": { "id": "Hero-1", … } } ],
 *   "zones": {}
 * }
 * ```
 *
 * - Los slots (API de 0.21) viven DENTRO de `props` como arrays de bloques
 *   anidados; se validan estructuralmente como parte de los props.
 * - `zones` es el API legado de Puck (deprecado): se acepta al leer por
 *   compatibilidad, pero el Studio no lo produce y el codegen lo ignora.
 * - Bindings CMS: valores de prop con forma `{ collection, docId, …snapshot }`
 *   (referencia viva, formato del template `lib/bindings.ts`) o el placeholder
 *   de seed `{ "$seedRef": { "collection": "…", "index": n } }` que el
 *   `scripts/seed.mts` del template resuelve a la forma viva. Ver
 *   `src/modules/artifacts/bindings.ts`.
 *
 * Compatibilidad de render SAGRADA: este Data debe renderizar idéntico en el
 * `<Render>` del template (mismos nombres de componente, mismas props, mismo
 * formato de bindings).
 */

// ---------------------------------------------------------------------------
// Bloques (instancias de componente del registry)
// ---------------------------------------------------------------------------

/**
 * Un bloque de contenido de Puck: `{ type, props }` con `props.id` estable
 * (alinea diffs §8.3 y ancla los conflictos de binding). El resto de props es
 * abierto: el contrato fino por componente lo valida el registry del Studio.
 */
export const compositionBlockSchema = z.object({
  /** Nombre del componente del registry del template, p.ej. `Hero`. */
  type: nonEmptyString,
  props: z
    .object({
      /** Identificador estable de la instancia (Puck lo exige en `content`). */
      id: nonEmptyString,
    })
    .catchall(z.unknown()),
});

export type CompositionBlock = z.infer<typeof compositionBlockSchema>;

// ---------------------------------------------------------------------------
// Payload v2 = Puck Data de la página
// ---------------------------------------------------------------------------

export const compositionRootSchema = z.object({
  props: z
    .object({
      /** Título de la página (SEO) — campo `root` del config del template. */
      title: z.string().default(""),
      /** Meta descripción — campo `root` del config del template. */
      description: z.string().default(""),
    })
    .catchall(z.unknown())
    .default({ title: "", description: "" }),
});

export const pageCompositionPayloadSchema = z
  .object({
    root: compositionRootSchema.default({ props: { title: "", description: "" } }),
    /**
     * Bloques raíz de la página, en orden de render. REQUERIDO (sin default):
     * así un objeto arbitrario (p.ej. el payload legado `{ pages: [] }`) no
     * valida silenciosamente como composición vacía.
     */
    content: z.array(compositionBlockSchema),
    /**
     * Zones legadas de Puck (pre-slots). Aceptadas al leer por compatibilidad;
     * el Studio no las produce y el codegen del seed las ignora (el template
     * persiste `zones: {}`). Los slots modernos viven dentro de `props`.
     */
    zones: z.record(z.string(), z.array(compositionBlockSchema)).optional(),
  })
  .superRefine((payload, ctx) => {
    const seen = new Set<string>();
    payload.content.forEach((block, index) => {
      if (seen.has(block.props.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["content", index, "props", "id"],
          message: `Bloque duplicado en la composición: \`${block.props.id}\`.`,
        });
      }
      seen.add(block.props.id);
    });
  });

export type PageCompositionPayload = z.infer<typeof pageCompositionPayloadSchema>;

/** Payload vacío válido para instancias recién creadas (estado `empty`). */
export function emptyPageCompositionPayload(): PageCompositionPayload {
  return { root: { props: { title: "", description: "" } }, content: [], zones: {} };
}

// ---------------------------------------------------------------------------
// Forma LEGADA (schemaVersion 1.0) — solo lectura retro-compatible
// ---------------------------------------------------------------------------

/**
 * Sección de la forma 1.0 (`bindings` prop → "colección.campo"). Se conserva
 * SOLO para leer payloads sellados antiguos y archivos de composición ya
 * scaffoldeados en repos generados (owned-by-human, nunca se reescriben).
 */
export const legacyCompositionSectionSchema = z.object({
  id: identifierSchema,
  component: nonEmptyString,
  variant: z.string().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
  bindings: z.record(z.string(), nonEmptyString).default({}),
});

export const legacyPageCompositionItemSchema = z.object({
  slug: slugSchema,
  sections: z.array(legacyCompositionSectionSchema).default([]),
});

export type LegacyCompositionSection = z.infer<typeof legacyCompositionSectionSchema>;
export type LegacyPageCompositionItem = z.infer<typeof legacyPageCompositionItemSchema>;

// ---------------------------------------------------------------------------
// Definición
// ---------------------------------------------------------------------------

export const PAGE_COMPOSITION_LABEL_PREFIX = "Composición";

/** Label humano de una instancia, p.ej. `Composición: Servicios`. */
export function pageCompositionLabel(pageTitle: string): string {
  return `${PAGE_COMPOSITION_LABEL_PREFIX}: ${pageTitle}`;
}

export const pageCompositionDefinition = defineArtifactType<PageCompositionPayload>({
  type: "page.composition",
  schemaVersion: "2.0",
  label: "Composición de página",
  description:
    "Data JSON de Puck de una página del sitemap (un artefacto por página, keyed por path).",
  phase: "composition",
  // §8.4: spec.sitemap → page.*; cms.collections → page bindings;
  // design.tokens → page.* (visual).
  dependsOn: ["spec.sitemap", "cms.collections", "design.tokens"],
  requiredForGate: true,
  multiInstance: true,
  payloadSchema: pageCompositionPayloadSchema,
});
