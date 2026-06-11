import type { Config, Viewport } from "@puckeditor/core";
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
import {
  TestimonialQuote,
  TestimonialWall,
  PostFeature,
  BlogPosts,
} from "./sections/cms";
import { Navbar, Footer } from "./sections/navigation";

/**
 * Section registry — 34 governed components. Every visual decision is an
 * enumerated variant; there is no free-form CSS/HTML field anywhere.
 */
export const puckConfig: Config = {
  components: {
    // structure
    Section,
    Columns,
    Spacer,
    Divider,
    // heroes
    Hero,
    HeroSplit,
    HeroMinimal,
    // content
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
    // cms-bound
    TestimonialQuote,
    TestimonialWall,
    PostFeature,
    BlogPosts,
    // navigation
    Navbar,
    Footer,
  },
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

export const editorViewports: Viewport[] = [
  { width: 375, height: "auto", label: "Móvil" },
  { width: 768, height: "auto", label: "Tablet" },
  { width: 1280, height: "auto", label: "Escritorio" },
];
