// Import por ruta profunda (módulo puro, sin DB): mantiene este helper —y a
// quien lo importe— client-safe aunque el barrel de artifacts exporte service.
import {
  flattenSitemap,
  type SpecSitemapPayload,
} from "@/modules/artifacts/types/spec-sitemap";
import type { StudioNavDefaults } from "../registry";

/**
 * `spec.sitemap` aprobado → defaults de Navbar/Footer para inserciones nuevas
 * en el canvas (`createPuckConfig({ nav })`).
 *
 * Espeja `buildSeedNav` del generator (`src/modules/generator/render.ts`):
 * mismos links de header/footer, mismo CTA (página `contacto|contact`), mismo
 * texto legal. La regla de límites de módulos (CLAUDE.md §19.5) impide que
 * `studio` importe `generator`, así que la derivación se duplica aquí — si
 * cambia allí, cambiarla aquí. Solo afecta a defaultProps (inserciones
 * nuevas); las composiciones existentes conservan las props de su Data JSON.
 */
export function buildStudioNavDefaults(
  projectName: string,
  sitemap: SpecSitemapPayload | null,
): StudioNavDefaults {
  if (!sitemap) return { brand: projectName };

  const pages = flattenSitemap(sitemap.pages);
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  const links = (slugs: string[]): { label: string; href: string }[] =>
    slugs
      .map((slug) => bySlug.get(slug))
      .filter((page): page is NonNullable<typeof page> => page != null)
      .map((page) => ({ label: page.title, href: page.path }));

  const contactPage = pages.find((page) => page.slug === "contacto" || page.slug === "contact");
  const footerLinks = links(sitemap.navigation.footer);

  return {
    brand: projectName,
    links: links(sitemap.navigation.header),
    footerColumns: footerLinks.length > 0 ? [{ title: projectName, links: footerLinks }] : [],
    legal: `© ${projectName}. Todos los derechos reservados.`,
    ...(contactPage ? { ctaLabel: contactPage.title, ctaHref: contactPage.path } : {}),
  };
}
