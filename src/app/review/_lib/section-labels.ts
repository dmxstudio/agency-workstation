/**
 * Etiquetas humanas de los componentes del registry para la superficie de
 * Review (§13): el cliente nunca ve nombres de tipos internos — solo páginas
 * y secciones con títulos legibles. Este mapa es un espejo estático de los
 * `label` del registry del Studio (src/modules/studio/registry/sections/*);
 * se mantiene aquí como datos puros para no arrastrar Puck ni componentes
 * client a las pantallas de review.
 */

const COMPONENT_LABELS: Record<string, string> = {
  // estructura
  Section: "Sección",
  Columns: "Columnas",
  Spacer: "Espaciado",
  Divider: "Separador",
  // heroes
  Hero: "Hero",
  HeroSplit: "Hero a dos columnas",
  HeroMinimal: "Hero minimal",
  // contenido
  Heading: "Encabezado",
  Paragraph: "Párrafo",
  ButtonRow: "Botones",
  ImageText: "Imagen y texto",
  Steps: "Pasos",
  Timeline: "Línea de tiempo",
  Quote: "Cita",
  VideoEmbed: "Vídeo",
  Banner: "Banner",
  // marketing
  Features: "Características",
  FeatureList: "Lista de características",
  Pricing: "Precios",
  Cta: "Llamada a la acción",
  CtaBanner: "Banner de acción",
  Stats: "Cifras",
  Faq: "Preguntas frecuentes",
  LogoCloud: "Logos",
  Gallery: "Galería",
  Team: "Equipo",
  Newsletter: "Newsletter",
  ContactForm: "Formulario de contacto",
  // cms
  TestimonialQuote: "Testimonio",
  TestimonialWall: "Testimonios",
  PostFeature: "Artículo destacado",
  BlogPosts: "Artículos del blog",
  // navegación
  Navbar: "Navegación",
  Footer: "Pie de página",
};

/** Etiqueta humana de un tipo de componente; el tipo crudo solo como fallback. */
export function componentLabel(type: string): string {
  return COMPONENT_LABELS[type] ?? type;
}

/**
 * Etiqueta humana de UNA sección concreta: tipo legible + el título propio
 * del bloque cuando existe (p.ej. «Hero — “Bienvenido a Acme”»).
 */
export function humanSectionLabel(type: string, props: Record<string, unknown>): string {
  const base = componentLabel(type);
  const title = props["title"];
  if (typeof title === "string" && title.trim() !== "") {
    return `${base} — “${title.trim()}”`;
  }
  return base;
}
