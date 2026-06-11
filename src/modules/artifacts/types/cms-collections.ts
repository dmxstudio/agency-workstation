import { z } from "zod";

import { defineArtifactType } from "./definition";
import { identifierSchema, nonEmptyString, slugSchema, stringList } from "./common";

/**
 * `cms.collections` — §7.2 Data/CMS Model: colecciones con campos tipados y
 * relaciones. El generador (§7.3) deriva de aquí las colecciones Payload.
 */

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

export const cmsCollectionsDefinition = defineArtifactType<CmsCollectionsPayload>({
  type: "cms.collections",
  schemaVersion: "1.0",
  label: "Modelo de datos (CMS)",
  description: "Colecciones con campos tipados y relaciones para el CMS.",
  phase: "cms",
  // §8.4: cms.collections no declara upstream en el grafo fijo del MVP.
  dependsOn: [],
  requiredForGate: true,
  payloadSchema: cmsCollectionsPayloadSchema,
});
