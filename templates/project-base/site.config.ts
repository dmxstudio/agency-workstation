/**
 * @generated-example — OWNED-BY-CODEGEN
 * The platform generator rewrites this file from the project's spec artifacts
 * (intake/strategy). Do not edit by hand; manual edits will be flagged as
 * conflicts on the next regeneration. See TEMPLATE.md.
 */
export const siteConfig = {
  /** Display name of the site (brand). */
  name: "Estudio Demo",
  /** URL-safe identifier of the project. */
  slug: "estudio-demo",
  /** Default meta description. */
  description: "Sitio de ejemplo generado desde el template base.",
  /** Path (in the `pages` collection) rendered at the root URL `/`. */
  homePath: "home",
  /** BCP-47 language tag for the <html lang> attribute. */
  locale: "es",
} as const;

export type SiteConfig = typeof siteConfig;
