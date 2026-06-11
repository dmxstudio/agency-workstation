import { z } from "zod";

import { defineArtifactType } from "./definition";
import { ctaSchema, identifierSchema, nonEmptyString, slugSchema, stringList } from "./common";

/**
 * `content.page` — §7.2 Content System: mensajes clave, copies por página y
 * SEO básico. En MVP es UN artefacto por proyecto que cubre todas las páginas
 * (granularidad por sección es mitigación post-MVP de §17-R6).
 */

export const contentSectionSchema = z.object({
  /** Identificador estable de la sección (alinea diffs entre versiones). */
  id: identifierSchema,
  heading: z.string().optional(),
  body: z.string().optional(),
  cta: ctaSchema.optional(),
});

export const pageContentSchema = z.object({
  /** Slug de la página del sitemap a la que pertenece este contenido. */
  slug: slugSchema,
  title: nonEmptyString,
  sections: z.array(contentSectionSchema).default([]),
  seo: z.object({
    title: nonEmptyString,
    description: nonEmptyString,
    keywords: stringList.default([]),
  }),
});

export const contentPagePayloadSchema = z
  .object({
    /** Mensajes clave transversales del proyecto. */
    keyMessages: stringList.default([]),
    pages: z.array(pageContentSchema).default([]),
  })
  .superRefine((payload, ctx) => {
    const seen = new Set<string>();
    payload.pages.forEach((page, index) => {
      if (seen.has(page.slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", index, "slug"],
          message: `Página duplicada en el sistema de contenido: \`${page.slug}\`.`,
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

export type ContentSection = z.infer<typeof contentSectionSchema>;
export type PageContent = z.infer<typeof pageContentSchema>;
export type ContentPagePayload = z.infer<typeof contentPagePayloadSchema>;

export const contentPageDefinition = defineArtifactType<ContentPagePayload>({
  type: "content.page",
  schemaVersion: "1.0",
  label: "Sistema de contenido",
  description: "Mensajes clave, copies por página y SEO básico.",
  phase: "content",
  // §8.4: spec.strategy → content.*
  dependsOn: ["spec.strategy"],
  requiredForGate: true,
  payloadSchema: contentPagePayloadSchema,
});
