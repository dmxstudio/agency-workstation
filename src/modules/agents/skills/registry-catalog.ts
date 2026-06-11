/**
 * Catálogo ESTÁTICO del component registry del Studio para las skills.
 *
 * `compose-page-draft` necesita los nombres y props EXACTOS del registry
 * (`src/modules/studio/registry`, espejo del template) para: (a) cerrar el
 * JSON Schema del structured output — los proveedores exigen objetos con
 * `additionalProperties: false`, así que cada componente se enumera con sus
 * props completas —, y (b) validar `components-exist`.
 *
 * Se mantiene como catálogo estático (sin importar el registry, que es .tsx
 * con React) para no romper el límite de módulos agents↛studio en runtime.
 * La sincronía NO se confía a la disciplina: `scripts/smoke-skills.ts`
 * compara este catálogo contra `createPuckConfig()` real (nombres de los 34
 * componentes y props exactas vía defaultProps) y falla si divergen.
 */

type JsonSchemaNode = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Nombres del registry (34 componentes, mismo orden que config.tsx)
// ---------------------------------------------------------------------------

export const REGISTRY_COMPONENT_NAMES = [
  // estructura
  "Section",
  "Columns",
  "Spacer",
  "Divider",
  // heroes
  "Hero",
  "HeroSplit",
  "HeroMinimal",
  // contenido
  "Heading",
  "Paragraph",
  "ButtonRow",
  "ImageText",
  "Steps",
  "Timeline",
  "Quote",
  "VideoEmbed",
  "Banner",
  // marketing
  "Features",
  "FeatureList",
  "Pricing",
  "Cta",
  "CtaBanner",
  "Stats",
  "Faq",
  "LogoCloud",
  "Gallery",
  "Team",
  "Newsletter",
  "ContactForm",
  // cms
  "TestimonialQuote",
  "TestimonialWall",
  "PostFeature",
  "BlogPosts",
  // navegación
  "Navbar",
  "Footer",
] as const;

export type RegistryComponentName = (typeof REGISTRY_COMPONENT_NAMES)[number];

const REGISTRY_NAME_SET: ReadonlySet<string> = new Set(REGISTRY_COMPONENT_NAMES);

export function isRegistryComponent(name: string): boolean {
  return REGISTRY_NAME_SET.has(name);
}

// ---------------------------------------------------------------------------
// Variantes enumeradas (primitives.tsx — sin CSS libre, §11.3)
// ---------------------------------------------------------------------------

const TONES = ["light", "subtle", "dark", "brand"] as const;
const PADDINGS = ["none", "compact", "normal", "spacious"] as const;
const ALIGNS = ["left", "center"] as const;
const BUTTON_STYLES = ["primary", "secondary", "ghost"] as const;

// ---------------------------------------------------------------------------
// Helpers de schema
// ---------------------------------------------------------------------------

const str = (description?: string): JsonSchemaNode =>
  description ? { type: "string", description } : { type: "string" };

const enumStr = (values: readonly string[], description?: string): JsonSchemaNode => ({
  type: "string",
  enum: [...values],
  ...(description ? { description } : {}),
});

const bool = (description?: string): JsonSchemaNode => ({
  type: "boolean",
  ...(description ? { description } : {}),
});

const arrayOf = (itemProps: Record<string, JsonSchemaNode>): JsonSchemaNode => ({
  type: "array",
  items: {
    type: "object",
    properties: itemProps,
    required: Object.keys(itemProps),
    additionalProperties: false,
  },
});

// ---------------------------------------------------------------------------
// Subconjunto COMPONIBLE: componentes que la skill puede proponer
// ---------------------------------------------------------------------------

export interface ComposableComponentSpec {
  name: RegistryComponentName;
  /** Cuándo usarlo — guía para el modelo, español. */
  description: string;
  /** Props EXACTAS del componente (sin `id`; el builder lo añade). */
  props: Record<string, JsonSchemaNode>;
}

/**
 * Componentes que `compose-page-draft` puede emitir. Excluidos a propósito:
 * - `Section`/`Columns`: usan slots (bloques anidados) — fuera del schema
 *   cerrado del MVP; el humano los añade en el Studio.
 * - `VideoEmbed`/`Gallery`: dependen de media real que la skill no tiene.
 * - `TestimonialQuote`/`TestimonialWall`/`PostFeature`/`BlogPosts`: requieren
 *   bindings a documentos CMS reales (docId) — vincular documentos es tarea
 *   humana en el Studio.
 * - `Navbar`/`Footer`: sus defaults salen del sitemap aprobado vía codegen.
 */
export const COMPOSABLE_COMPONENTS: readonly ComposableComponentSpec[] = [
  {
    name: "Hero",
    description: "Cabecera principal con titular, subtítulo y dos CTAs. Una por página como máximo.",
    props: {
      eyebrow: str("Etiqueta corta sobre el titular; puede ser vacía."),
      title: str("Titular que vende el resultado."),
      subtitle: str("Frase de apoyo, sin jerga."),
      align: enumStr(ALIGNS),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      size: enumStr(["normal", "large"]),
      primaryCta: str("Etiqueta del CTA principal."),
      primaryCtaHref: str("Enlace del CTA principal (ruta interna, p.ej. /contacto)."),
      secondaryCta: str("CTA secundario; puede ser vacío."),
      secondaryCtaStyle: enumStr(BUTTON_STYLES),
    },
  },
  {
    name: "HeroSplit",
    description: "Cabecera con texto a un lado y media al otro.",
    props: {
      eyebrow: str(),
      title: str(),
      subtitle: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      mediaSide: enumStr(["left", "right"]),
      mediaRatio: enumStr(["video", "square", "portrait"]),
      cta: str(),
      ctaHref: str(),
    },
  },
  {
    name: "HeroMinimal",
    description: "Cabecera de una sola frase, grande. Ideal para páginas interiores.",
    props: {
      title: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
    },
  },
  {
    name: "Heading",
    description: "Encabezado de sección suelto.",
    props: {
      text: str(),
      level: enumStr(["h2", "h3", "h4"]),
      align: enumStr(ALIGNS),
    },
  },
  {
    name: "Paragraph",
    description: "Párrafo de texto editorial.",
    props: {
      text: str(),
      size: enumStr(["s", "m", "l"]),
      align: enumStr(ALIGNS),
    },
  },
  {
    name: "ButtonRow",
    description: "Fila de botones/CTAs.",
    props: {
      buttons: arrayOf({
        label: str(),
        href: str(),
        style: enumStr(BUTTON_STYLES),
      }),
      align: enumStr(ALIGNS),
    },
  },
  {
    name: "ImageText",
    description: "Bloque editorial de imagen + texto.",
    props: {
      title: str(),
      body: str(),
      mediaSide: enumStr(["left", "right"]),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
    },
  },
  {
    name: "Steps",
    description: "Proceso en pasos numerados.",
    props: {
      eyebrow: str(),
      title: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      steps: arrayOf({ title: str(), body: str() }),
    },
  },
  {
    name: "Timeline",
    description: "Línea de tiempo con hitos.",
    props: {
      title: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      items: arrayOf({ date: str(), title: str(), body: str() }),
    },
  },
  {
    name: "Quote",
    description: "Cita destacada con atribución.",
    props: {
      quote: str(),
      attribution: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
    },
  },
  {
    name: "Banner",
    description: "Anuncio breve con enlace.",
    props: {
      text: str(),
      linkLabel: str(),
      linkHref: str(),
      tone: enumStr(["brand", "dark"]),
    },
  },
  {
    name: "Features",
    description: "Grid de características con icono, título y texto.",
    props: {
      eyebrow: str(),
      title: str(),
      subtitle: str(),
      columns: enumStr(["2", "3", "4"]),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      items: arrayOf({ icon: str("Un solo emoji."), title: str(), body: str() }),
    },
  },
  {
    name: "FeatureList",
    description: "Lista vertical de características.",
    props: {
      title: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      items: arrayOf({ title: str(), body: str() }),
    },
  },
  {
    name: "Pricing",
    description: "Planes de precios.",
    props: {
      eyebrow: str(),
      title: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      tiers: arrayOf({
        name: str(),
        price: str(),
        period: str(),
        description: str(),
        features: str("Una feature por línea (\\n)."),
        cta: str(),
        highlighted: bool(),
      }),
    },
  },
  {
    name: "Cta",
    description: "Llamada a la acción con título y botón.",
    props: {
      title: str(),
      subtitle: str(),
      cta: str(),
      ctaHref: str(),
      align: enumStr(ALIGNS),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
    },
  },
  {
    name: "CtaBanner",
    description: "Banda compacta de llamada a la acción.",
    props: {
      title: str(),
      cta: str(),
      ctaHref: str(),
      tone: enumStr(["brand", "dark"]),
    },
  },
  {
    name: "Stats",
    description: "Métricas destacadas.",
    props: {
      title: str("Puede ser vacío."),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      stats: arrayOf({ value: str(), label: str() }),
    },
  },
  {
    name: "Faq",
    description: "Preguntas frecuentes.",
    props: {
      title: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      items: arrayOf({ question: str(), answer: str() }),
    },
  },
  {
    name: "LogoCloud",
    description: "Logos de clientes (solo nombres).",
    props: {
      title: str(),
      tone: enumStr(TONES),
      logos: arrayOf({ name: str() }),
    },
  },
  {
    name: "Team",
    description: "Equipo: nombres y roles.",
    props: {
      title: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
      members: arrayOf({ name: str(), role: str() }),
    },
  },
  {
    name: "Newsletter",
    description: "Captura de email.",
    props: {
      title: str(),
      subtitle: str(),
      buttonLabel: str(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
    },
  },
  {
    name: "ContactForm",
    description: "Formulario de contacto.",
    props: {
      title: str(),
      subtitle: str(),
      layout: enumStr(["stacked", "split"]),
      showPhone: bool(),
      tone: enumStr(TONES),
      padding: enumStr(PADDINGS),
    },
  },
  {
    name: "Spacer",
    description: "Espacio vertical.",
    props: { size: enumStr(["s", "m", "l", "xl"]) },
  },
  {
    name: "Divider",
    description: "Separador visual.",
    props: { style: enumStr(["line", "dots", "blank"]) },
  },
];

export const COMPOSABLE_COMPONENT_NAMES: readonly string[] = COMPOSABLE_COMPONENTS.map(
  (component) => component.name,
);

// ---------------------------------------------------------------------------
// JSON Schema cerrado del Data de Puck para compose-page-draft
// ---------------------------------------------------------------------------

/**
 * Schema del payload `page.composition` (Data de Puck) CERRADO sobre el
 * subconjunto componible: `content` es un array de bloques `anyOf` donde cada
 * rama enumera un componente con sus props exactas + `props.id` obligatorio.
 * Cumple las reglas de structured outputs (additionalProperties:false, sin
 * minLength). El payload se re-valida con `pageCompositionPayloadSchema`.
 */
export function buildCompositionJsonSchema(): Record<string, unknown> {
  const blockSchemas = COMPOSABLE_COMPONENTS.map((component) => ({
    type: "object",
    description: component.description,
    properties: {
      type: { type: "string", enum: [component.name] },
      props: {
        type: "object",
        properties: {
          id: str("Identificador estable y único del bloque, p.ej. `Hero-home-1`."),
          ...component.props,
        },
        required: ["id", ...Object.keys(component.props)],
        additionalProperties: false,
      },
    },
    required: ["type", "props"],
    additionalProperties: false,
  }));

  return {
    type: "object",
    properties: {
      root: {
        type: "object",
        properties: {
          props: {
            type: "object",
            properties: {
              title: str("Título de la página (SEO)."),
              description: str("Meta descripción (SEO)."),
            },
            required: ["title", "description"],
            additionalProperties: false,
          },
        },
        required: ["props"],
        additionalProperties: false,
      },
      content: {
        type: "array",
        description: "Bloques de la página en orden de render.",
        items: { anyOf: blockSchemas },
      },
    },
    required: ["root", "content"],
    additionalProperties: false,
  };
}
