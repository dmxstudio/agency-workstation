import { z } from "zod";

import { defineArtifactType } from "./definition";
import { identifierSchema, nonEmptyString } from "./common";

/**
 * `release` — §7.8: un release es una VERSIÓN INMUTABLE de este artefacto
 * singleton que sella el snapshot exacto a desplegar: las versiones selladas
 * de cada input (sitemap, cms, content, tokens y cada composición por página),
 * el checklist evaluado en el momento de crearlo y el git tag (`release-N`)
 * en el repo generado. El módulo deploy sirve releases desde este snapshot;
 * la aprobación de cliente (§8.5) referencia `releaseVersion`, nunca
 * artefactos internos.
 *
 * schemaVersion 2.0 — BREAKING respecto a 1.0 (documentado):
 * - 1.0: `{ name, target, pages: [{slug, version}], checklist: [{id, label,
 *   done}], notes? }` — el target ahora es un concepto del deploy (slot
 *   `production|preview` en la tabla `deployments`), y las páginas pasan a
 *   `versions.compositions` keyed por page path (la key del artefacto
 *   `page.composition`).
 * - 2.0: `{ releaseNumber, gitTag, versions: { sitemap, cms, content, tokens,
 *   compositions }, checklist: [{key, label, ok, detail}], notes }`.
 * - Migración: no existe ningún payload 1.0 sellado (el seed deja `release`
 *   en estado `empty`), así que no hay versiones que convertir; las filas con
 *   schemaVersion 1.0 se actualizan solas en su próximo `saveDraft`.
 *
 * Los releases se crean por `createRelease` (módulo review): checklist §7.8
 * en verde + confirmación de un humano con rol admin|member; el sellado pasa
 * por el ciclo normal del artifacts service (versión inmutable, origin
 * human, audit log).
 */

/** Versión sellada (inmutable) de un artefacto: siempre >= 1. */
const sealedVersionSchema = z
  .number()
  .int("Debe ser un número de versión entero.")
  .positive("Debe ser una versión sellada (>= 1).");

/** Ítem del checklist de release (§7.8), evaluado al crear el release. */
export const releaseChecklistItemSchema = z.object({
  /** Clave estable del check, p.ej. `compositions-approved`. */
  key: identifierSchema,
  label: nonEmptyString,
  ok: z.boolean(),
  /** Detalle humano cuando aporta contexto (p.ej. qué páginas faltaban). */
  detail: z.string().nullable().default(null),
});

/** Versiones selladas de los inputs que el release congela. */
export const releaseVersionsSchema = z.object({
  sitemap: sealedVersionSchema,
  cms: sealedVersionSchema,
  /** 0 = `content.page` sin aprobar (es input opcional del generator). */
  content: z.number().int().min(0),
  tokens: sealedVersionSchema,
  /** Versión sellada por página, keyed por page path (`home`, `legal/terms`). */
  compositions: z.record(z.string(), sealedVersionSchema),
});

export const releasePayloadSchema = z
  .object({
    /** Número de release = versión del artefacto que lo sella (v1, v2, …). */
    releaseNumber: sealedVersionSchema,
    /** Tag git en el repo generado, p.ej. `release-3`. */
    gitTag: nonEmptyString,
    versions: releaseVersionsSchema,
    /** Checklist §7.8 tal y como se evaluó al crear el release (todo `ok`). */
    checklist: z.array(releaseChecklistItemSchema),
    notes: z.string().default(""),
  })
  .superRefine((payload, ctx) => {
    const seenKeys = new Set<string>();
    payload.checklist.forEach((item, index) => {
      if (seenKeys.has(item.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["checklist", index, "key"],
          message: `Ítem duplicado en el checklist: \`${item.key}\`.`,
        });
      }
      seenKeys.add(item.key);
    });
  });

export type ReleaseChecklistItem = z.infer<typeof releaseChecklistItemSchema>;
export type ReleaseVersions = z.infer<typeof releaseVersionsSchema>;
export type ReleasePayload = z.infer<typeof releasePayloadSchema>;

export const releaseDefinition = defineArtifactType<ReleasePayload>({
  type: "release",
  schemaVersion: "2.0",
  label: "Release",
  description:
    "Snapshot inmutable a desplegar: versiones selladas de cada input, checklist confirmado y git tag.",
  phase: "release",
  // §8.4: page.*.composition → release.*
  dependsOn: ["page.composition"],
  requiredForGate: true,
  payloadSchema: releasePayloadSchema,
});
