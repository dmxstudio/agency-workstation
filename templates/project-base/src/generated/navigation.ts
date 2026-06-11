/**
 * @generated-example — OWNED-BY-CODEGEN
 * Site navigation emitted from the `spec.sitemap` artifact. Consumed as the
 * default props of the Navbar/Footer registry components (new insertions in
 * the editor pick these up; already-composed pages keep their own props).
 * Regenerated on spec changes; do not edit by hand.
 */

export type NavLink = { label: string; href: string };
export type FooterColumn = { title: string; links: NavLink[] };

export const mainNav: NavLink[] = [
  { label: "Inicio", href: "/" },
  { label: "Nosotros", href: "/about" },
  { label: "Blog", href: "/blog" },
  { label: "Contacto", href: "/contact" },
];

export const footerColumns: FooterColumn[] = [
  {
    title: "Estudio",
    links: [
      { label: "Nosotros", href: "/about" },
      { label: "Blog", href: "/blog" },
    ],
  },
  {
    title: "Contacto",
    links: [{ label: "Escríbenos", href: "/contact" }],
  },
];

export const legalText = "© 2026 Estudio Demo. Todos los derechos reservados.";
