import type { ComponentConfig } from "@puckeditor/core";
import { mutedClass, type Tone } from "../primitives";

/**
 * Navegación — RENDERS y fields copiados verbatim del template
 * (`templates/project-base/src/puck/sections/navigation.tsx`). Divergencia
 * controlada: el template saca los defaultProps de `site.config.ts` +
 * `src/generated/navigation.ts` (codegen del proyecto); la plataforma no
 * tiene esos módulos, así que aquí son una factory que recibe los defaults
 * (derivados de spec.sitemap aprobado) desde `createPuckConfig`.
 *
 * Los defaultProps SOLO afectan a inserciones nuevas en el editor; las
 * páginas ya compuestas conservan las props de su Data JSON, así que esta
 * divergencia no toca la compatibilidad de render.
 */

export interface StudioNavDefaults {
  /** Nombre del sitio (spec/proyecto). */
  brand?: string;
  /** Descripción corta para el tagline del footer. */
  tagline?: string;
  /** Navegación principal (sitemap aprobado → header). */
  links?: { label: string; href: string }[];
  /** Columnas del footer (sitemap aprobado → footer). */
  footerColumns?: { title: string; links: { label: string; href: string }[] }[];
  /** Texto legal del footer. */
  legal?: string;
  /** CTA del navbar. */
  ctaLabel?: string;
  ctaHref?: string;
}

export type NavbarProps = {
  brand: string;
  tone: "light" | "dark";
  sticky: boolean;
  links: { label: string; href: string }[];
  ctaLabel: string;
  ctaHref: string;
};

export type FooterProps = {
  brand: string;
  tagline: string;
  tone: Tone;
  columns: { title: string; links: { label: string; href: string }[] }[];
  legal: string;
};

export interface NavigationSections {
  Navbar: ComponentConfig<NavbarProps>;
  Footer: ComponentConfig<FooterProps>;
}

export function createNavigationSections(nav: StudioNavDefaults = {}): NavigationSections {
  const Navbar: ComponentConfig<NavbarProps> = {
    label: "Barra de navegación",
    fields: {
      brand: { type: "text", label: "Marca" },
      tone: {
        type: "radio",
        label: "Tono",
        options: [
          { label: "Claro", value: "light" },
          { label: "Oscuro", value: "dark" },
        ],
      },
      sticky: {
        type: "radio",
        label: "Fija al hacer scroll",
        options: [
          { label: "Sí", value: true },
          { label: "No", value: false },
        ],
      },
      links: {
        type: "array",
        label: "Enlaces",
        getItemSummary: (item) => item.label || "Enlace",
        arrayFields: {
          label: { type: "text", label: "Etiqueta" },
          href: { type: "text", label: "Destino" },
        },
        defaultItemProps: { label: "Enlace", href: "#" },
      },
      ctaLabel: { type: "text", label: "CTA" },
      ctaHref: { type: "text", label: "CTA — destino" },
    },
    defaultProps: {
      brand: nav.brand ?? "Marca",
      tone: "light",
      sticky: true,
      links: [...(nav.links ?? [])],
      ctaLabel: nav.ctaLabel ?? "Contactar",
      ctaHref: nav.ctaHref ?? "#",
    },
    render: (p) => (
      <header
        className={`${p.sticky ? "sticky top-0 z-40" : ""} border-b ${
          p.tone === "dark"
            ? "border-neutral-800 bg-neutral-950 text-neutral-50"
            : "border-neutral-200 bg-white text-neutral-900"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight">{p.brand}</span>
          <nav className="hidden gap-6 text-sm font-medium md:flex">
            {p.links.map((l, i) => (
              <a key={i} href={l.href || "#"} className="hover:text-brand-600">
                {l.label}
              </a>
            ))}
          </nav>
          {p.ctaLabel ? (
            <a
              href={p.ctaHref || "#"}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
            >
              {p.ctaLabel}
            </a>
          ) : null}
        </div>
      </header>
    ),
  };

  const Footer: ComponentConfig<FooterProps> = {
    label: "Footer",
    fields: {
      brand: { type: "text", label: "Marca" },
      tagline: { type: "text", label: "Tagline" },
      tone: {
        type: "radio",
        label: "Tono",
        options: [
          { label: "Oscuro", value: "dark" },
          { label: "Sutil", value: "subtle" },
        ],
      },
      columns: {
        type: "array",
        label: "Columnas",
        getItemSummary: (item) => item.title || "Columna",
        arrayFields: {
          title: { type: "text", label: "Título" },
          links: {
            type: "array",
            label: "Enlaces",
            getItemSummary: (item) => item.label || "Enlace",
            arrayFields: {
              label: { type: "text", label: "Etiqueta" },
              href: { type: "text", label: "Destino" },
            },
            defaultItemProps: { label: "Enlace", href: "#" },
          },
        },
        defaultItemProps: { title: "Columna", links: [] },
      },
      legal: { type: "text", label: "Texto legal" },
    },
    defaultProps: {
      brand: nav.brand ?? "Marca",
      tagline: nav.tagline ?? "",
      tone: "dark",
      columns: (nav.footerColumns ?? []).map((col) => ({
        title: col.title,
        links: [...col.links],
      })),
      legal: nav.legal ?? "",
    },
    render: (p) => (
      <footer
        className={
          p.tone === "dark" ? "bg-neutral-950 text-neutral-50" : "bg-neutral-100 text-neutral-900"
        }
      >
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 md:grid-cols-4">
          <div>
            <p className="text-lg font-bold tracking-tight">{p.brand}</p>
            <p className={`mt-2 text-sm ${mutedClass[p.tone === "dark" ? "dark" : "subtle"]}`}>
              {p.tagline}
            </p>
          </div>
          {p.columns.map((col, i) => (
            <div key={i}>
              <h3 className="text-sm font-semibold uppercase tracking-wider">{col.title}</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {col.links.map((l, j) => (
                  <li key={j}>
                    <a href={l.href || "#"} className="opacity-70 hover:opacity-100">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-neutral-800 px-6 py-4">
          <p className="mx-auto max-w-7xl text-xs opacity-60">{p.legal}</p>
        </div>
      </footer>
    ),
  };

  return { Navbar, Footer };
}
