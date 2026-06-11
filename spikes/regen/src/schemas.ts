import { z } from "zod";

/**
 * Zod schemas COPIED from the real platform so the spike stays independent
 * (per spike mandate). Sources:
 *
 *   src/modules/artifacts/types/common.ts            (slug/identifier/nonEmptyString/stringList)
 *   src/modules/artifacts/types/cms-collections.ts   (cms.collections payload)
 *   src/modules/artifacts/types/page-composition.ts  (page.composition payload)
 *   src/modules/artifacts/types/spec-sitemap.ts      (spec.sitemap payload)
 *
 * DIVERGENCES from the platform (all intentional, none semantic):
 *   1. `defineArtifactType(...)` registry plumbing is stripped — the spike only
 *      needs the payload schemas, not the artifact registry.
 *   2. Everything lives in one file instead of one file per type.
 *   3. `getSitemapSlugs` helper is kept; `Cta`/`ctaSchema` dropped (unused here).
 * The schema shapes, refinements and error messages are byte-for-byte the same.
 */

// ---------------------------------------------------------------------------
// common.ts (verbatim subset)
// ---------------------------------------------------------------------------

/** URL-safe slug segment: `sobre-nosotros`, `home`, `faq-2`. */
export const slugSchema = z
  .string()
  .min(1, "El slug no puede estar vacío.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug inválido: solo minúsculas, números y guiones (p.ej. `sobre-nosotros`).",
  );

/** Machine identifier: `heroTitle`, `cta_primary`, `seo`. */
export const identifierSchema = z
  .string()
  .min(1, "El identificador no puede estar vacío.")
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    "Identificador inválido: debe empezar por letra y usar solo letras, números, `_` o `-`.",
  );

export const nonEmptyString = z.string().min(1, "Este campo es obligatorio.");

export const stringList = z.array(nonEmptyString);

// ---------------------------------------------------------------------------
// cms-collections.ts (verbatim payload schemas)
// ---------------------------------------------------------------------------

export const cmsFieldTypeSchema = z.enum([
  "text",
  "richText",
  "number",
  "boolean",
  "date",
  "image",
  "select",
  "relation",
]);

export const cmsFieldSchema = z.object({
  name: identifierSchema,
  label: nonEmptyString,
  type: cmsFieldTypeSchema,
  required: z.boolean().default(false),
  /** Solo para `select`: valores permitidos. */
  options: stringList.optional(),
  /** Solo para `relation`: slug de la colección destino. */
  relationTo: slugSchema.optional(),
  /** Solo para `relation`: relación a muchos. */
  hasMany: z.boolean().default(false),
});

export const cmsCollectionSchema = z.object({
  slug: slugSchema,
  label: nonEmptyString,
  description: z.string().optional(),
  fields: z.array(cmsFieldSchema).min(1, "La colección necesita al menos un campo."),
  /** Añadir createdAt/updatedAt automáticos en el CMS generado. */
  timestamps: z.boolean().default(true),
});

export const cmsCollectionsPayloadSchema = z
  .object({
    collections: z.array(cmsCollectionSchema).default([]),
  })
  .superRefine((payload, ctx) => {
    const collectionSlugs = new Set<string>();
    payload.collections.forEach((collection, cIndex) => {
      if (collectionSlugs.has(collection.slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["collections", cIndex, "slug"],
          message: `Colección duplicada: \`${collection.slug}\`.`,
        });
      }
      collectionSlugs.add(collection.slug);
    });
    payload.collections.forEach((collection, cIndex) => {
      const fieldNames = new Set<string>();
      collection.fields.forEach((field, fIndex) => {
        const path = ["collections", cIndex, "fields", fIndex];
        if (fieldNames.has(field.name)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "name"],
            message: `Campo duplicado en \`${collection.slug}\`: \`${field.name}\`.`,
          });
        }
        fieldNames.add(field.name);
        if (field.type === "select" && (!field.options || field.options.length === 0)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "options"],
            message: `El campo select \`${field.name}\` necesita al menos una opción.`,
          });
        }
        if (field.type === "relation") {
          if (!field.relationTo) {
            ctx.addIssue({
              code: "custom",
              path: [...path, "relationTo"],
              message: `El campo relation \`${field.name}\` necesita una colección destino.`,
            });
          } else if (!collectionSlugs.has(field.relationTo)) {
            ctx.addIssue({
              code: "custom",
              path: [...path, "relationTo"],
              message: `La relación apunta a una colección inexistente: \`${field.relationTo}\`.`,
            });
          }
        }
        if (field.type !== "relation" && field.relationTo) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "relationTo"],
            message: `\`relationTo\` solo aplica a campos de tipo relation.`,
          });
        }
        if (field.type !== "select" && field.options) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "options"],
            message: `\`options\` solo aplica a campos de tipo select.`,
          });
        }
      });
    });
  });

export type CmsFieldType = z.infer<typeof cmsFieldTypeSchema>;
export type CmsField = z.infer<typeof cmsFieldSchema>;
export type CmsCollection = z.infer<typeof cmsCollectionSchema>;
export type CmsCollectionsPayload = z.infer<typeof cmsCollectionsPayloadSchema>;

// ---------------------------------------------------------------------------
// page-composition.ts (verbatim payload schemas)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// spec-sitemap.ts (verbatim payload schemas)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Spike-level input bundle: the three artifacts the generator consumes.
// ---------------------------------------------------------------------------

export const specArtifactsSchema = z.object({
  sitemap: specSitemapPayloadSchema,
  collections: cmsCollectionsPayloadSchema,
  compositions: pageCompositionPayloadSchema,
});

export type SpecArtifacts = z.infer<typeof specArtifactsSchema>;
