import { z } from "zod";

import { defineArtifactType } from "./definition";
import { identifierSchema, nonEmptyString, slugSchema } from "./common";

/**
 * `release` — §7.8: checklist de release con validaciones + confirmación
 * humana, páginas incluidas (por versión) y target de deploy.
 */

export const releaseTargetSchema = z.enum(["preview", "staging", "production"]);

export const releasePayloadSchema = z
  .object({
    /** Nombre humano del release, p.ej. `v1`, `lanzamiento-campaña`. */
    name: nonEmptyString,
    target: releaseTargetSchema,
    /** Páginas incluidas, ancladas a versión aprobada concreta (§8.5). */
    pages: z
      .array(
        z.object({
          slug: slugSchema,
          version: z.number().int().positive(),
        }),
      )
      .default([]),
    /** Checklist de release (§7.8): confirmación humana, nunca automática. */
    checklist: z
      .array(
        z.object({
          id: identifierSchema,
          label: nonEmptyString,
          done: z.boolean().default(false),
        }),
      )
      .default([]),
    notes: z.string().optional(),
  })
  .superRefine((payload, ctx) => {
    const seenPages = new Set<string>();
    payload.pages.forEach((page, index) => {
      if (seenPages.has(page.slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", index, "slug"],
          message: `Página duplicada en el release: \`${page.slug}\`.`,
        });
      }
      seenPages.add(page.slug);
    });
    const seenItems = new Set<string>();
    payload.checklist.forEach((item, index) => {
      if (seenItems.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["checklist", index, "id"],
          message: `Ítem duplicado en el checklist: \`${item.id}\`.`,
        });
      }
      seenItems.add(item.id);
    });
  });

export type ReleaseTarget = z.infer<typeof releaseTargetSchema>;
export type ReleasePayload = z.infer<typeof releasePayloadSchema>;

export const releaseDefinition = defineArtifactType<ReleasePayload>({
  type: "release",
  schemaVersion: "1.0",
  label: "Release",
  description: "Checklist de release, páginas incluidas y target de deploy.",
  phase: "release",
  // §8.4: page.*.composition → release.*
  dependsOn: ["page.composition"],
  requiredForGate: true,
  payloadSchema: releasePayloadSchema,
});
