import { z } from "zod";

import { defineArtifactType } from "./definition";
import { identifierSchema, nonEmptyString, slugSchema } from "./common";

/**
 * `page.composition` — §7.4: composición de páginas con secciones del
 * component registry, props acotadas y bindings a campos del CMS.
 */

export const compositionSectionSchema = z.object({
  /** Identificador estable de la instancia de sección (alinea diffs). */
  id: identifierSchema,
  /** Componente del registry (§7.5), p.ej. `hero`, `pricing`. */
  component: nonEmptyString,
  variant: z.string().optional(),
  /** Props editables definidas por el contrato del componente. */
  props: z.record(z.string(), z.unknown()).default({}),
  /** Bindings prop → campo CMS, p.ej. `title` → `posts.title`. */
  bindings: z.record(z.string(), nonEmptyString).default({}),
});

export const pageCompositionItemSchema = z.object({
  /** Slug de la página del sitemap que esta composición materializa. */
  slug: slugSchema,
  sections: z.array(compositionSectionSchema).default([]),
});

export const pageCompositionPayloadSchema = z
  .object({
    pages: z.array(pageCompositionItemSchema).default([]),
  })
  .superRefine((payload, ctx) => {
    const seen = new Set<string>();
    payload.pages.forEach((page, index) => {
      if (seen.has(page.slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", index, "slug"],
          message: `Composición duplicada para la página \`${page.slug}\`.`,
        });
      }
      seen.add(page.slug);
      const sectionIds = new Set<string>();
      page.sections.forEach((section, sIndex) => {
        if (sectionIds.has(section.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["pages", index, "sections", sIndex, "id"],
            message: `Sección duplicada en \`${page.slug}\`: \`${section.id}\`.`,
          });
        }
        sectionIds.add(section.id);
      });
    });
  });

export type CompositionSection = z.infer<typeof compositionSectionSchema>;
export type PageCompositionItem = z.infer<typeof pageCompositionItemSchema>;
export type PageCompositionPayload = z.infer<typeof pageCompositionPayloadSchema>;

export const pageCompositionDefinition = defineArtifactType<PageCompositionPayload>({
  type: "page.composition",
  schemaVersion: "1.0",
  label: "Composición de páginas",
  description: "Páginas compuestas con secciones del registry y bindings CMS.",
  phase: "composition",
  // §8.4: spec.sitemap → page.*; cms.collections → page bindings;
  // design.tokens → page.* (visual).
  dependsOn: ["spec.sitemap", "cms.collections", "design.tokens"],
  requiredForGate: true,
  payloadSchema: pageCompositionPayloadSchema,
});
