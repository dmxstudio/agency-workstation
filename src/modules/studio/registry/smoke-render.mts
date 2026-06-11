/**
 * Smoke test del registry del Studio: renderToString de un Data JSON con el
 * MISMO renderer que usa el template (`Render` de `@puckeditor/core/rsc`).
 * Caza imports rotos, renders no RSC-safe y regresiones del shape de binding.
 *
 *   npx tsx src/modules/studio/registry/smoke-render.mts
 *
 * No es un test runner: imprime OK/FAIL y sale con código != 0 si falla.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Render } from "@puckeditor/core/rsc";
import type { Data } from "@puckeditor/core";

import { createPuckConfig } from "./config";
import { bindingPlaceholder } from "./bindings";
import { tokensCss } from "./tokens-css";
import { studioCanvasCss } from "./canvas-css";

const config = createPuckConfig({
  cmsCollections: {
    collections: [
      {
        slug: "case-studies",
        label: "Casos de estudio",
        fields: [
          { name: "author", label: "Autor", type: "text", required: true, hasMany: false },
          { name: "quote", label: "Cita", type: "richText", required: true, hasMany: false },
          { name: "company", label: "Empresa", type: "text", required: false, hasMany: false },
        ],
        timestamps: true,
      },
    ],
  },
  nav: {
    brand: "Acme",
    links: [{ label: "Inicio", href: "/" }],
    footerColumns: [{ title: "Acme", links: [{ label: "Contacto", href: "/contacto" }] }],
    legal: "© Acme.",
  },
});

const dp = <T,>(name: string): T => {
  const component = config.components[name];
  if (!component?.defaultProps) throw new Error(`Sin defaultProps: ${name}`);
  return structuredClone(component.defaultProps) as T;
};

const block = (type: string, id: string, extra: Record<string, unknown> = {}) => ({
  type,
  props: { ...dp<Record<string, unknown>>(type), id, ...extra },
});

const data: Data = {
  root: { props: { title: "Smoke" } },
  content: [
    block("Navbar", "Navbar-1"),
    block("Hero", "Hero-1"),
    block("Section", "Section-1", {
      content: [
        block("Heading", "Heading-1"),
        block("Paragraph", "Paragraph-1"),
      ],
    }),
    block("Features", "Features-1"),
    block("TestimonialQuote", "TestimonialQuote-1", {
      testimonial: {
        docId: 1,
        collection: "case-studies",
        quote: bindingPlaceholder("case-studies", "quote"),
        author: bindingPlaceholder("case-studies", "author"),
        company: bindingPlaceholder("case-studies", "company"),
      },
    }),
    block("Footer", "Footer-1"),
  ],
  zones: {},
};

const html = renderToString(createElement(Render, { config, data }));

const checks: [string, boolean][] = [
  ["Hero default title", html.includes("Un titular que vende el resultado")],
  ["Navbar brand from nav defaults", html.includes("Acme")],
  ["Slot content (Heading inside Section)", html.includes("Encabezado de sección")],
  ["Features grid", html.includes("Todo lo que necesitas")],
  [
    "Binding placeholder rendered",
    html.includes("[contenido de case-studies.quote]") &&
      html.includes("[contenido de case-studies.author]"),
  ],
  ["Brand utility classes present", html.includes("bg-brand-600")],
  ["Footer legal", html.includes("© Acme.")],
];

const css = tokensCss({
  colors: { "brand-600": "#003d7a", "brand-200": "#c4d7eb" },
  typography: { fontFamilies: { sans: "Inter, sans-serif" }, baseSizePx: 16 },
  spacing: {},
  radii: {},
  components: [],
});
checks.push(
  ["tokensCss emits sorted brand vars", css.includes("--brand-200: #c4d7eb;") && css.includes("--brand-600: #003d7a;")],
  ["studioCanvasCss includes neutral palette", studioCanvasCss(null).includes(".bg-neutral-100")],
);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} comprobaciones (${html.length} bytes de HTML)`);
if (failed > 0) process.exit(1);
