import { z } from "zod";

/** Shared field schemas for artifact payloads. Error messages in Spanish (UI). */

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

/** Call to action shared by content and composition payloads. */
export const ctaSchema = z.object({
  label: nonEmptyString,
  href: nonEmptyString,
});

export type Cta = z.infer<typeof ctaSchema>;
