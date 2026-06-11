import { z } from "zod";

import { defineArtifactType } from "./definition";
import { nonEmptyString, slugSchema } from "./common";

/**
 * `spec.sitemap` — §7.2 Information Architecture: árbol de páginas con slugs
 * y navegación. Es el upstream de routes/nav/page.* en el grafo fijo (§8.4).
 */

export interface SitemapNode {
  title: string;
  slug: string;
  description?: string | undefined;
  children: SitemapNode[];
}

export const sitemapNodeSchema: z.ZodType<SitemapNode> = z.object({
  title: nonEmptyString,
  slug: slugSchema,
  description: z.string().optional(),
  children: z.lazy(() => z.array(sitemapNodeSchema)),
});

function collectSlugs(nodes: SitemapNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    out.push(node.slug);
    collectSlugs(node.children, out);
  }
  return out;
}

export const specSitemapPayloadSchema = z
  .object({
    /** Árbol de páginas; el primer nivel son las páginas raíz. */
    pages: z.array(sitemapNodeSchema).min(1, "El sitemap necesita al menos una página."),
    navigation: z.object({
      /** Slugs de páginas presentes en la navegación principal. */
      header: z.array(slugSchema).default([]),
      /** Slugs de páginas presentes en el footer. */
      footer: z.array(slugSchema).default([]),
    }),
  })
  .superRefine((payload, ctx) => {
    const slugs = collectSlugs(payload.pages);
    const seen = new Set<string>();
    for (const slug of slugs) {
      if (seen.has(slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages"],
          message: `Slug duplicado en el sitemap: \`${slug}\`.`,
        });
      }
      seen.add(slug);
    }
    for (const area of ["header", "footer"] as const) {
      payload.navigation[area].forEach((slug, index) => {
        if (!seen.has(slug)) {
          ctx.addIssue({
            code: "custom",
            path: ["navigation", area, index],
            message: `La navegación referencia un slug inexistente: \`${slug}\`.`,
          });
        }
      });
    }
  });

export type SpecSitemapPayload = z.infer<typeof specSitemapPayloadSchema>;

/** Slugs únicos del sitemap (útil para validaciones cruzadas y formularios). */
export function getSitemapSlugs(payload: SpecSitemapPayload): string[] {
  return collectSlugs(payload.pages);
}

export const specSitemapDefinition = defineArtifactType<SpecSitemapPayload>({
  type: "spec.sitemap",
  schemaVersion: "1.0",
  label: "Sitemap",
  description: "Árbol de páginas con slugs y navegación (header/footer).",
  phase: "ia",
  // §8.4: spec.strategy → spec.sitemap
  dependsOn: ["spec.strategy"],
  requiredForGate: true,
  payloadSchema: specSitemapPayloadSchema,
});
