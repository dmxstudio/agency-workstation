import type { Config, Viewport } from "@puckeditor/core";
import type { CmsCollectionsPayload } from "@/modules/artifacts";
import { withBlockAnchors } from "./primitives";
import { Hero, HeroSplit, HeroMinimal } from "./sections/heroes";
import { Section, Columns, Spacer, Divider } from "./sections/structure";
import {
  Heading,
  Paragraph,
  ButtonRow,
  ImageText,
  Steps,
  Timeline,
  Quote,
  VideoEmbed,
  Banner,
} from "./sections/content";
import {
  Features,
  FeatureList,
  Pricing,
  Cta,
  CtaBanner,
  Stats,
  Faq,
  LogoCloud,
  Gallery,
  Team,
  Newsletter,
  ContactForm,
} from "./sections/marketing";
import { createCmsSections } from "./sections/cms";
import { createNavigationSections, type StudioNavDefaults } from "./sections/navigation";

/**
 * Config de Puck del Visual Studio (§7.4) — 34 componentes gobernados,
 * espejo del registry del template (`templates/project-base/src/puck/config.tsx`):
 * mismos nombres de componente, mismas categorías, mismo root. El Data JSON
 * que produce este config renderiza idéntico en el renderer del template.
 *
 * Es una FACTORY (no un export estático) porque dos piezas dependen de
 * artefactos aprobados del proyecto:
 * - las secciones CMS-bound validan sus bindings contra `cms.collections`;
 * - los defaultProps de Navbar/Footer salen del sitemap aprobado (en el
 *   template los emite el codegen; aquí llegan por parámetro).
 */
export interface CreatePuckConfigOptions {
  /** Payload del artefacto `cms.collections` aprobado (o null si no existe aún). */
  cmsCollections?: CmsCollectionsPayload | null;
  /** Defaults de navegación derivados del sitemap aprobado / proyecto. */
  nav?: StudioNavDefaults;
}

export function createPuckConfig(options: CreatePuckConfigOptions = {}): Config {
  const collections = options.cmsCollections?.collections ?? [];
  const { TestimonialQuote, TestimonialWall, PostFeature, BlogPosts } =
    createCmsSections(collections);
  const { Navbar, Footer } = createNavigationSections(options.nav);

  return {
    // Igual que el template: cada bloque renderiza su id Puck como id DOM de
    // la raíz de la sección (anclas de comentarios del review, `#<sectionId>`).
    components: withBlockAnchors({
      // estructura
      Section,
      Columns,
      Spacer,
      Divider,
      // heroes
      Hero,
      HeroSplit,
      HeroMinimal,
      // contenido
      Heading,
      Paragraph,
      ButtonRow,
      ImageText,
      Steps,
      Timeline,
      Quote,
      VideoEmbed,
      Banner,
      // marketing
      Features,
      FeatureList,
      Pricing,
      Cta,
      CtaBanner,
      Stats,
      Faq,
      LogoCloud,
      Gallery,
      Team,
      Newsletter,
      ContactForm,
      // cms
      TestimonialQuote,
      TestimonialWall,
      PostFeature,
      BlogPosts,
      // navegación
      Navbar,
      Footer,
    }),
    categories: {
      estructura: {
        title: "Estructura",
        components: ["Section", "Columns", "Spacer", "Divider"],
      },
      heroes: {
        title: "Heroes",
        components: ["Hero", "HeroSplit", "HeroMinimal"],
      },
      contenido: {
        title: "Contenido",
        components: [
          "Heading",
          "Paragraph",
          "ButtonRow",
          "ImageText",
          "Steps",
          "Timeline",
          "Quote",
          "VideoEmbed",
          "Banner",
        ],
      },
      marketing: {
        title: "Marketing",
        components: [
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
        ],
      },
      cms: {
        title: "Contenido CMS",
        components: ["TestimonialQuote", "TestimonialWall", "PostFeature", "BlogPosts"],
      },
      navegacion: {
        title: "Navegación",
        components: ["Navbar", "Footer"],
      },
    },
    root: {
      fields: {
        title: { type: "text", label: "Título de la página (SEO)" },
        description: { type: "textarea", label: "Meta descripción" },
      },
      defaultProps: { title: "", description: "" },
      render: ({ children }: { children: React.ReactNode }) => (
        <div className="min-h-screen bg-white font-sans text-neutral-900 antialiased">
          {children}
        </div>
      ),
    },
  };
}

/**
 * Config sin contexto de proyecto (sin colecciones ni nav). Útil para
 * renderizar Data JSON existente o para tests; el editor real debe usar
 * `createPuckConfig` con los artefactos aprobados del proyecto.
 */
export const puckConfig: Config = createPuckConfig();

/** Mismos viewports que el template (preview responsive §7.4). */
export const editorViewports: Viewport[] = [
  { width: 375, height: "auto", label: "Móvil" },
  { width: 768, height: "auto", label: "Tablet" },
  { width: 1280, height: "auto", label: "Escritorio" },
];
