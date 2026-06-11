/**
 * Demo seed (npm run db:seed) — idempotent.
 *
 * Creates:
 * - Demo user        demo@agency.local / demo1234 (admin)
 * - Workspace        "Demo Agency" (slug `demo`)
 * - Project          "Sitio Corporativo Acme" with the 8 MVP artifacts and a
 *   coherent history (§13 cycle on every approval):
 *   - spec.intake       approved v2 (kickoff + re-scope: careers page added)
 *   - spec.strategy     approved v2 (v1 was flagged `outdated` by intake v2
 *     — §8.4 marks, never regenerates — and re-validated as v2 with the new
 *     "candidatos técnicos" audience)
 *   - spec.sitemap      approved v1 (an earlier draft predates the re-scope;
 *     the sealed version adds the `carreras` page)
 *   - design.tokens     approved v1 (Acme corporate palette → brand-* vars)
 *   - cms.collections   approved v1 (case-studies, job-openings, testimonials)
 *   - content.page      approved v1 (copy + SEO for inicio/servicios/contacto)
 *   - page.composition  ONE PER PAGE (keyed by path, derived from the
 *     approved sitemap via syncCompositionArtifacts), with per-page history:
 *       inicio    approved v1 — the exact scaffold the Generator emits for
 *                 the home page (built with the generator's own renderer)
 *       servicios approved v1 — hand-authored Puck Data with CMS bindings
 *       nosotros  draft — unapproved changes (scaffold + extra section), so
 *                 the Studio shows a real pending draft
 *       blog / carreras / contacto stay `empty` (fallback scaffold)
 *   - release           empty (deploy is a future phase)
 * - One open manual task + the activity/audit feed of the whole story
 *
 * The three artifacts the Generator REQUIRES (§7.3: spec.sitemap,
 * cms.collections, design.tokens) end up approved, so the demo project is
 * generable right after seeding (see scripts/e2e-generator.ts).
 *
 * Everything flows through the real domain services (`createWorkspace`,
 * `createProject`, `saveDraft`, `submitForReview`, `approve`), so states,
 * sealed versions, derived tasks and audit events are produced by the same
 * code paths the app uses.
 *
 * Idempotency: if the demo project already exists the seed prints the
 * credentials and exits without touching anything. To re-generate from
 * scratch: delete `./.data` and run `npm run db:migrate && npm run db:seed`.
 */
import { randomBytes, scrypt } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { newId } from "../src/db/ids";
import { projects, tasks, users, workspaces } from "../src/db/schema";
import {
  approve,
  getProjectArtifacts,
  saveDraft,
  submitForReview,
  syncCompositionArtifacts,
  type HumanActor,
} from "../src/modules/artifacts/service";
import type { CmsCollectionsPayload } from "../src/modules/artifacts/types/cms-collections";
import type { ContentPagePayload } from "../src/modules/artifacts/types/content-page";
import type { DesignTokensPayload } from "../src/modules/artifacts/types/design-tokens";
import {
  pageCompositionPayloadSchema,
  type PageCompositionPayload,
} from "../src/modules/artifacts/types/page-composition";
import {
  compositionFilePath,
  renderHumanScaffolds,
} from "../src/modules/generator/render";
import type { SpecIntakePayload } from "../src/modules/artifacts/types/spec-intake";
import type { SpecSitemapPayload } from "../src/modules/artifacts/types/spec-sitemap";
import type { SpecStrategyPayload } from "../src/modules/artifacts/types/spec-strategy";
import { logAudit } from "../src/modules/platform-core/audit";
import { createProject } from "../src/modules/platform-core/projects";
import { createWorkspace } from "../src/modules/platform-core/workspaces";

// ---------------------------------------------------------------------------
// Demo fixtures
// ---------------------------------------------------------------------------

const DEMO_EMAIL = "demo@agency.local";
const DEMO_PASSWORD = "demo1234";
const DEMO_NAME = "Demo Admin";
const DEMO_WORKSPACE_NAME = "Demo Agency";
const DEMO_WORKSPACE_SLUG = "demo";
const DEMO_PROJECT_NAME = "Sitio Corporativo Acme";

// ---------------------------------------------------------------------------
// Password hashing — mirrors the local auth provider format exactly
// (`scrypt:<N>:<r>:<p>:<salt b64>:<hash b64>`). Duplicated here on purpose:
// the provider lives behind `next/headers` (cookies) and cannot be imported
// from a plain Node script.
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, hash) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(
          [
            "scrypt",
            SCRYPT_N,
            SCRYPT_R,
            SCRYPT_P,
            salt.toString("base64"),
            hash.toString("base64"),
          ].join(":"),
        );
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Realistic demo payloads (Spanish — the product UI language)
// ---------------------------------------------------------------------------

const intakeV1: SpecIntakePayload = {
  objective:
    "Renovar la presencia digital de Acme Industrial con un sitio corporativo que transmita fiabilidad y genere solicitudes de presupuesto cualificadas.",
  client: {
    name: "Acme Industrial S.A.",
    industry: "Fabricación de maquinaria de envasado",
    website: "https://www.acme-industrial.example",
    contactName: "Laura Gómez",
    contactEmail: "laura.gomez@acme-industrial.example",
  },
  scope: {
    inScope: [
      "Sitio corporativo de 6 páginas (inicio, servicios, proyectos, nosotros, blog, contacto)",
      "Formulario de contacto con solicitud de presupuesto",
      "Blog corporativo editable desde el CMS",
      "SEO técnico básico y analítica de visitas",
    ],
    outOfScope: [
      "E-commerce y pagos online",
      "Área privada de clientes",
      "Campañas de paid media",
    ],
  },
  constraints: {
    budget: "12.000 € (presupuesto cerrado)",
    deadline: "2026-09-15",
    technical: [
      "Integración del formulario con HubSpot CRM",
      "Hosting en la infraestructura actual del cliente (Vercel)",
    ],
    legal: [
      "RGPD: banner de consentimiento de cookies",
      "Aviso legal y política de privacidad revisados por su asesoría",
    ],
  },
  brandInputs: {
    hasLogo: true,
    hasStyleGuide: false,
    assetsUrl: "https://drive.example.com/acme-brand",
    notes:
      "Logo vectorial disponible. No existe guía de estilo formal: solo colores corporativos (azul #003D7A y gris) y tipografía del catálogo impreso.",
  },
  successCriteria: [
    "Sitio publicado antes del 15 de septiembre de 2026",
    "20 solicitudes de presupuesto al mes a los 3 meses del lanzamiento",
    "Carga inferior a 2 segundos en móvil (LCP)",
  ],
};

/** v2: ampliación de alcance acordada con el cliente tras el kickoff. */
const intakeV2: SpecIntakePayload = {
  ...intakeV1,
  scope: {
    ...intakeV1.scope,
    inScope: [
      ...intakeV1.scope.inScope,
      "Página de carreras con listado de vacantes gestionado desde el CMS",
    ],
  },
  successCriteria: [
    ...intakeV1.successCriteria,
    "Al menos 5 candidaturas mensuales a través de la página de carreras",
  ],
};

const strategyV1: SpecStrategyPayload = {
  audiences: [
    {
      name: "Directores de operaciones de pymes industriales",
      description:
        "Deciden la compra de maquinaria; valoran fiabilidad, plazos de entrega y servicio postventa.",
      needs: [
        "Comparar especificaciones técnicas sin fricción",
        "Ver casos de éxito con resultados medibles",
        "Solicitar presupuesto en menos de un minuto",
      ],
    },
    {
      name: "Ingenieros de planta",
      description:
        "Prescriptores técnicos; consultan fichas de producto y documentación de mantenimiento.",
      needs: [
        "Documentación técnica descargable",
        "Información de repuestos y tiempos de respuesta del SAT",
      ],
    },
  ],
  positioning:
    "Acme Industrial es el fabricante ibérico de maquinaria de envasado con el servicio postventa más rápido: soporte técnico propio en menos de 24 horas.",
  valueProposition:
    "Maquinaria fiable y mantenimiento garantizado: reducimos las paradas de producción de nuestros clientes.",
  differentiators: [
    "Servicio técnico propio con cobertura nacional en 24 h",
    "40 años fabricando en España",
    "Stock permanente de repuestos originales",
  ],
  toneOfVoice: {
    attributes: ["cercano", "técnico", "directo", "fiable"],
    notes:
      "Evitar jerga comercial vacía; hablar con datos y plazos concretos. Tratamiento de usted en las páginas corporativas.",
  },
};

const sitemapDraft: SpecSitemapPayload = {
  pages: [
    {
      title: "Inicio",
      slug: "inicio",
      description: "Propuesta de valor, líneas de producto y casos destacados.",
      children: [],
    },
    {
      title: "Servicios",
      slug: "servicios",
      description: "Líneas de maquinaria y servicios de mantenimiento.",
      children: [
        { title: "Maquinaria de envasado", slug: "maquinaria-envasado", children: [] },
        { title: "Líneas de producción", slug: "lineas-produccion", children: [] },
        {
          title: "Mantenimiento y repuestos",
          slug: "mantenimiento-repuestos",
          children: [],
        },
      ],
    },
    {
      title: "Proyectos",
      slug: "proyectos",
      description: "Casos de éxito con resultados medibles.",
      children: [],
    },
    {
      title: "Nosotros",
      slug: "nosotros",
      description: "Historia, equipo, planta de producción y certificaciones.",
      children: [],
    },
    { title: "Blog", slug: "blog", children: [] },
    {
      title: "Contacto",
      slug: "contacto",
      description: "Formulario de solicitud de presupuesto conectado a HubSpot.",
      children: [],
    },
  ],
  navigation: {
    header: ["inicio", "servicios", "proyectos", "nosotros", "contacto"],
    footer: ["servicios", "blog", "contacto"],
  },
};

/**
 * v2 de la estrategia: re-validación tras la ampliación de alcance del intake
 * (página de carreras) — añade la audiencia de talento técnico.
 */
const strategyV2: SpecStrategyPayload = {
  ...strategyV1,
  audiences: [
    ...strategyV1.audiences,
    {
      name: "Candidatos técnicos (talento)",
      description:
        "Perfiles de ingeniería y oficios industriales que evalúan a Acme como empleador desde la nueva página de carreras.",
      needs: [
        "Ver vacantes activas con requisitos y ubicación claros",
        "Entender la estabilidad y el proyecto industrial de la empresa",
      ],
    },
  ],
};

/**
 * Sitemap final aprobado: IA simplificada tras la re-validación de la
 * estrategia. Los casos de éxito pasan a vivir como colección CMS bindeada en
 * «Servicios» (en lugar de una página propia) y se añade «Carreras» (alcance
 * v2 del intake).
 */
const sitemapFinal: SpecSitemapPayload = {
  pages: [
    {
      title: "Inicio",
      slug: "inicio",
      description: "Propuesta de valor, líneas de producto y casos destacados.",
      children: [],
    },
    {
      title: "Servicios",
      slug: "servicios",
      description:
        "Maquinaria de envasado, líneas de producción y mantenimiento, con casos de éxito desde el CMS.",
      children: [],
    },
    {
      title: "Nosotros",
      slug: "nosotros",
      description: "Historia, planta de producción y certificaciones.",
      children: [],
    },
    {
      title: "Blog",
      slug: "blog",
      description: "Noticias y actualidad técnica de Acme.",
      children: [],
    },
    {
      title: "Carreras",
      slug: "carreras",
      description: "Vacantes activas gestionadas desde el CMS.",
      children: [],
    },
    {
      title: "Contacto",
      slug: "contacto",
      description: "Formulario de solicitud de presupuesto conectado a HubSpot.",
      children: [],
    },
  ],
  navigation: {
    header: ["inicio", "servicios", "nosotros", "blog", "contacto"],
    footer: ["servicios", "blog", "carreras", "contacto"],
  },
};

/** Paleta corporativa de Acme (azul #003D7A) sobre las claves `brand-*` que el template mapea a utilities Tailwind. */
const tokensV1: DesignTokensPayload = {
  colors: {
    "brand-200": "#c4d7eb",
    "brand-500": "#1e5a96",
    "brand-600": "#003d7a",
    "brand-700": "#002b56",
  },
  typography: {
    fontFamilies: {
      sans: '"Inter", system-ui, sans-serif',
      mono: '"JetBrains Mono", monospace',
    },
    baseSizePx: 16,
    scaleRatio: 1.25,
  },
  spacing: { sm: "0.5rem", md: "1rem", lg: "2rem", xl: "4rem" },
  radii: { sm: "0.25rem", md: "0.5rem" },
  components: [
    "Navbar",
    "Hero",
    "Features",
    "ImageText",
    "Cta",
    "Stats",
    "ContactForm",
    "Footer",
  ],
};

/** Modelo de datos del CMS: 3 colecciones realistas para el sitio de Acme. */
const collectionsV1: CmsCollectionsPayload = {
  collections: [
    {
      slug: "case-studies",
      label: "Casos de éxito",
      description:
        "Proyectos entregados con resultados medibles; alimentan la página de servicios.",
      fields: [
        { name: "title", label: "Título", type: "text", required: true, hasMany: false },
        { name: "summary", label: "Resumen", type: "richText", required: true, hasMany: false },
        {
          name: "sector",
          label: "Sector",
          type: "select",
          options: ["Alimentación", "Farmacéutico", "Cosmética", "Logística"],
          required: false,
          hasMany: false,
        },
        {
          name: "outcome",
          label: "Resultado medible",
          type: "text",
          required: false,
          hasMany: false,
        },
        {
          name: "deliveredAt",
          label: "Fecha de entrega",
          type: "date",
          required: false,
          hasMany: false,
        },
      ],
      timestamps: true,
    },
    {
      slug: "job-openings",
      label: "Vacantes",
      description: "Ofertas de empleo publicadas en la página de carreras.",
      fields: [
        { name: "title", label: "Puesto", type: "text", required: true, hasMany: false },
        {
          name: "department",
          label: "Departamento",
          type: "select",
          options: ["Ingeniería", "Producción", "SAT", "Comercial"],
          required: false,
          hasMany: false,
        },
        { name: "location", label: "Ubicación", type: "text", required: false, hasMany: false },
        {
          name: "description",
          label: "Descripción",
          type: "richText",
          required: false,
          hasMany: false,
        },
        {
          name: "active",
          label: "Vacante activa",
          type: "boolean",
          required: false,
          hasMany: false,
        },
      ],
      timestamps: true,
    },
    {
      slug: "testimonials",
      label: "Testimonios",
      description: "Citas de clientes; opcionalmente enlazadas a un caso de éxito.",
      fields: [
        { name: "author", label: "Autor", type: "text", required: true, hasMany: false },
        { name: "role", label: "Cargo", type: "text", required: false, hasMany: false },
        { name: "company", label: "Empresa", type: "text", required: false, hasMany: false },
        { name: "quote", label: "Cita", type: "richText", required: true, hasMany: false },
        {
          name: "caseStudy",
          label: "Caso relacionado",
          type: "relation",
          relationTo: "case-studies",
          required: false,
          hasMany: false,
        },
      ],
      timestamps: true,
    },
  ],
};

/** Sistema de contenido: mensajes clave + copy y SEO de 3 páginas. */
const contentV1: ContentPagePayload = {
  keyMessages: [
    "Maquinaria fiable que reduce paradas de producción",
    "Servicio técnico propio en menos de 24 horas",
    "40 años fabricando en España",
  ],
  pages: [
    {
      slug: "inicio",
      title: "Inicio",
      sections: [
        {
          id: "hero",
          heading: "Maquinaria de envasado que no se detiene",
          body: "Diseñamos y fabricamos líneas de envasado con servicio técnico propio: respuesta en menos de 24 horas en toda la península.",
          cta: { label: "Solicitar presupuesto", href: "/contacto" },
        },
        {
          id: "lineas",
          heading: "Líneas de producto",
          body: "Envasadoras verticales y horizontales, llenadoras volumétricas y líneas completas llave en mano adaptadas a su planta.",
        },
        {
          id: "sat",
          heading: "SAT propio y repuestos originales",
          body: "Stock permanente de repuestos y técnicos propios en toda la península: su producción no espera.",
          cta: { label: "Conocer el servicio técnico", href: "/servicios" },
        },
      ],
      seo: {
        title: "Acme Industrial — Maquinaria de envasado",
        description:
          "Fabricante de maquinaria de envasado con servicio técnico propio en 24 horas. 40 años de experiencia.",
        keywords: ["maquinaria de envasado", "líneas de producción", "SAT industrial"],
      },
    },
    {
      slug: "servicios",
      title: "Servicios",
      sections: [
        {
          id: "hero",
          heading: "Un único proveedor para toda la vida útil de su maquinaria",
          body: "De la ingeniería de línea al mantenimiento preventivo, con un equipo propio de principio a fin.",
        },
        {
          id: "maquinaria",
          heading: "Maquinaria de envasado",
          body: "Envasadoras a medida para alimentación, farmacia y cosmética, integradas con sus sistemas MES/ERP.",
        },
        {
          id: "mantenimiento",
          heading: "Mantenimiento y repuestos",
          body: "Contratos de mantenimiento preventivo con SLA de 24 horas y stock de repuestos originales.",
          cta: { label: "Pedir una auditoría de línea", href: "/contacto" },
        },
      ],
      seo: {
        title: "Servicios — Acme Industrial",
        description:
          "Maquinaria de envasado, líneas de producción y mantenimiento con SLA de 24 horas.",
        keywords: ["mantenimiento industrial", "envasadoras", "líneas de envasado"],
      },
    },
    {
      slug: "contacto",
      title: "Contacto",
      sections: [
        {
          id: "hero",
          heading: "Cuéntenos su proyecto",
          body: "Respondemos a toda solicitud de presupuesto en menos de 24 horas laborables.",
        },
        {
          id: "datos",
          body: "Polígono Industrial Norte, nave 12 · 28850 Torrejón de Ardoz (Madrid) · +34 916 000 000 · ventas@acme-industrial.example",
        },
      ],
      seo: {
        title: "Contacto — Acme Industrial",
        description:
          "Solicite presupuesto para su línea de envasado: respuesta en menos de 24 horas laborables.",
        keywords: ["presupuesto maquinaria de envasado"],
      },
    },
  ],
};

/**
 * Composición de la página «Servicios» (artefacto `page.composition` keyed
 * `key="servicios"`, schema v2 = Data JSON de Puck del template). Dos
 * bindings CMS:
 *
 * - `TestimonialQuote.testimonial` usa el placeholder `$seedRef` que el
 *   `scripts/seed.mts` del proyecto generado resuelve a una referencia viva
 *   `{ collection, docId, …snapshot }` (render real del template).
 * - `ImageText` lleva en `props.source` una referencia viva a
 *   `case-studies` cuyo snapshot copia el campo `summary`. Es el binding que
 *   la regeneración vigila: si una versión futura de `cms.collections`
 *   elimina `summary`, aparece el conflicto `binding-missing-field` keyed por
 *   página en la pantalla del Generator (scripts/e2e-generator.ts lo
 *   demuestra). El componente ignora props desconocidas, así que la página
 *   renderiza idéntica en el template.
 */
const serviciosCompositionV1: PageCompositionPayload = {
  root: {
    props: {
      title: "Servicios — Acme Industrial",
      description:
        "Maquinaria de envasado, líneas de producción y mantenimiento con SLA de 24 horas.",
    },
  },
  content: [
    {
      type: "Navbar",
      props: {
        id: "Navbar-servicios-1",
        brand: "Sitio Corporativo Acme",
        tone: "light",
        sticky: true,
        links: [
          { label: "Inicio", href: "/" },
          { label: "Servicios", href: "/servicios" },
          { label: "Nosotros", href: "/nosotros" },
          { label: "Blog", href: "/blog" },
          { label: "Contacto", href: "/contacto" },
        ],
        ctaLabel: "Contacto",
        ctaHref: "/contacto",
      },
    },
    {
      type: "Hero",
      props: {
        id: "Hero-servicios-2",
        eyebrow: "Servicios",
        title: "Un único proveedor para toda la vida útil de su maquinaria",
        subtitle: "Ingeniería, fabricación y mantenimiento con equipo propio.",
        align: "center",
        tone: "light",
        padding: "spacious",
        size: "normal",
        primaryCta: "Pedir una auditoría de línea",
        primaryCtaHref: "/contacto",
        secondaryCta: "",
        secondaryCtaStyle: "ghost",
      },
    },
    {
      type: "ImageText",
      props: {
        id: "caso-destacado",
        title: "Caso destacado",
        body: "Línea de envasado llave en mano para Atlántica Foods: −38 % de paradas no planificadas en el primer trimestre.",
        mediaSide: "right",
        tone: "subtle",
        padding: "normal",
        // Binding vivo a case-studies (snapshot del campo `summary`).
        source: {
          collection: "case-studies",
          docId: 1,
          title: "Caso de éxito 1",
          summary: "Resumen del caso destacado que alimenta esta sección.",
        },
      },
    },
    {
      type: "TestimonialQuote",
      props: {
        id: "TestimonialQuote-servicios-4",
        testimonial: { $seedRef: { collection: "testimonials", index: 0 } },
        tone: "light",
        padding: "normal",
      },
    },
    {
      type: "Cta",
      props: {
        id: "Cta-servicios-5",
        title: "Pedir una auditoría de línea",
        subtitle: "Respondemos en menos de 24 horas laborables.",
        cta: "Contactar",
        ctaHref: "/contacto",
        align: "center",
        tone: "brand",
        padding: "normal",
      },
    },
    {
      type: "Footer",
      props: {
        id: "Footer-servicios-6",
        brand: "Sitio Corporativo Acme",
        tagline: "Maquinaria fiable que reduce paradas de producción",
        tone: "dark",
        columns: [
          {
            title: "Sitio Corporativo Acme",
            links: [
              { label: "Servicios", href: "/servicios" },
              { label: "Blog", href: "/blog" },
              { label: "Carreras", href: "/carreras" },
              { label: "Contacto", href: "/contacto" },
            ],
          },
        ],
        legal: "© Sitio Corporativo Acme. Todos los derechos reservados.",
      },
    },
  ],
  zones: {},
};

// ---------------------------------------------------------------------------
// Composition scaffolds — built with the GENERATOR's own renderer so the
// approved home composition is byte-equal to what `generateProject` used to
// scaffold for that page (the demo never invents a second truth).
// ---------------------------------------------------------------------------

const scaffoldFiles = renderHumanScaffolds({
  projectName: DEMO_PROJECT_NAME,
  sitemap: sitemapFinal,
  collections: collectionsV1,
  tokens: tokensV1,
  content: contentV1,
  compositions: {},
});

/** Puck Data the Generator scaffolds for a sitemap page (from approved copy). */
function scaffoldComposition(slug: string): PageCompositionPayload {
  const raw = scaffoldFiles.get(compositionFilePath(slug));
  if (!raw) {
    throw new Error(`El generator no produjo scaffold de composición para «${slug}».`);
  }
  return pageCompositionPayloadSchema.parse(JSON.parse(raw));
}

/**
 * Borrador SIN aprobar de «Nosotros»: el scaffold del generator más una
 * sección nueva insertada antes del footer — deja al Studio un draft real
 * (estado `draft`, v0, diff no vacío) para la demo.
 */
function nosotrosDraftComposition(): PageCompositionPayload {
  const data = scaffoldComposition("nosotros");
  data.content.splice(Math.max(data.content.length - 1, 0), 0, {
    type: "ImageText",
    props: {
      id: "ImageText-nosotros-planta",
      title: "Nuestra planta de producción",
      body: "12.000 m² en Torrejón de Ardoz con líneas de mecanizado propias y banco de pruebas: cada máquina se valida antes de la entrega.",
      mediaSide: "right",
      tone: "subtle",
      padding: "normal",
    },
  });
  return data;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function printCredentials(): void {
  console.log("\n────────────────────────────────────────────");
  console.log("Credenciales demo");
  console.log(`  URL:        http://localhost:3000/login`);
  console.log(`  Email:      ${DEMO_EMAIL}`);
  console.log(`  Contraseña: ${DEMO_PASSWORD}`);
  console.log(`  Workspace:  ${DEMO_WORKSPACE_NAME} (/w/${DEMO_WORKSPACE_SLUG})`);
  console.log("────────────────────────────────────────────");
}

async function main(): Promise<void> {
  const db = getDb();

  // --- Demo user (idempotent by unique email) ------------------------------
  let userId: string;
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, DEMO_EMAIL), isNull(users.deletedAt)))
    .limit(1);
  if (existingUser[0]) {
    userId = existingUser[0].id;
    console.log(`Usuario demo ya existe (${userId}).`);
  } else {
    userId = newId.user();
    await db.insert(users).values({
      id: userId,
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      name: DEMO_NAME,
    });
    console.log(`Usuario demo creado (${userId}).`);
  }

  // --- Workspace (idempotent by unique slug) -------------------------------
  let workspaceId: string;
  const existingWorkspace = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.slug, DEMO_WORKSPACE_SLUG), isNull(workspaces.deletedAt)))
    .limit(1);
  if (existingWorkspace[0]) {
    workspaceId = existingWorkspace[0].id;
    console.log(`Workspace "${DEMO_WORKSPACE_NAME}" ya existe (${workspaceId}).`);
  } else {
    const workspace = await createWorkspace(
      DEMO_WORKSPACE_NAME,
      DEMO_WORKSPACE_SLUG,
      userId,
    );
    workspaceId = workspace.id;
    console.log(`Workspace "${DEMO_WORKSPACE_NAME}" creado (${workspaceId}).`);
  }

  // --- Project (idempotency cutoff: existing project ⇒ nothing to do) ------
  const existingProject = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.name, DEMO_PROJECT_NAME),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (existingProject[0]) {
    console.log(
      `Proyecto "${DEMO_PROJECT_NAME}" ya existe (${existingProject[0].id}); seed omitido.`,
    );
    printCredentials();
    return;
  }

  const project = await createProject(workspaceId, DEMO_PROJECT_NAME, userId);
  console.log(`Proyecto "${DEMO_PROJECT_NAME}" creado (${project.id}) con sus 8 artefactos.`);

  const actor: HumanActor = { id: userId, role: "admin", workspaceId };
  const artifacts = await getProjectArtifacts(project.id);
  const byType = new Map(artifacts.map((item) => [item.artifact.type, item.artifact]));
  const intake = byType.get("spec.intake");
  const strategy = byType.get("spec.strategy");
  const sitemap = byType.get("spec.sitemap");
  const tokens = byType.get("design.tokens");
  const collections = byType.get("cms.collections");
  const content = byType.get("content.page");
  if (!intake || !strategy || !sitemap || !tokens || !collections || !content) {
    throw new Error("El grafo de artefactos del proyecto demo no se instanció correctamente.");
  }

  // --- spec.intake → approved v1 (ciclo §13 completo) ----------------------
  await saveDraft(intake.id, intakeV1, actor);
  await submitForReview(intake.id, actor);
  await approve(intake.id, actor, "Visto bueno en la reunión de kickoff con el cliente.");
  console.log("spec.intake: borrador → revisión → aprobado (v1).");

  // --- spec.strategy → approved v1 ------------------------------------------
  await saveDraft(strategy.id, strategyV1, actor);
  await submitForReview(strategy.id, actor);
  await approve(strategy.id, actor, "Estrategia validada con la dirección comercial de Acme.");
  console.log("spec.strategy: borrador → revisión → aprobado (v1).");

  // --- spec.sitemap → draft (pendiente de revisión) -------------------------
  await saveDraft(sitemap.id, sitemapDraft, actor);
  console.log("spec.sitemap: borrador guardado (en draft).");

  // --- spec.intake v2 → re-aprobación que propaga `outdated` (§8.4) ---------
  // Editing an approved artifact opens the draft of its next version; the
  // approval seals v2 and MARKS the dependent strategy as outdated (it never
  // regenerates anything), deriving the re-validation task.
  await saveDraft(intake.id, intakeV2, actor);
  await submitForReview(intake.id, actor);
  const reapproval = await approve(
    intake.id,
    actor,
    "Ampliación de alcance acordada: se añade la página de carreras.",
  );
  console.log(
    `spec.intake: v2 aprobada; propagación outdated → ${reapproval.outdatedDependentIds.length} dependiente(s) marcados (spec.strategy).`,
  );

  // --- spec.strategy v2 → re-validación que limpia el flag (§8.4) -----------
  await saveDraft(strategy.id, strategyV2, actor);
  await submitForReview(strategy.id, actor);
  await approve(
    strategy.id,
    actor,
    "Re-validada tras la ampliación de alcance: se añade la audiencia de talento técnico.",
  );
  console.log("spec.strategy: v2 aprobada (re-validación; el flag outdated se limpia).");

  // --- spec.sitemap → versión final aprobada ---------------------------------
  // (La propagación de strategy v2 marcó el borrador como outdated; aprobar la
  // versión final limpia el flag y cierra la tarea derivada.)
  await saveDraft(sitemap.id, sitemapFinal, actor);
  await submitForReview(sitemap.id, actor);
  await approve(
    sitemap.id,
    actor,
    "IA final: los casos de éxito pasan al CMS dentro de «Servicios» y se añade «Carreras».",
  );
  console.log("spec.sitemap: v1 aprobada (6 páginas, incluye «Carreras»).");

  // --- design.tokens → approved v1 -------------------------------------------
  await saveDraft(tokens.id, tokensV1, actor);
  await submitForReview(tokens.id, actor);
  await approve(tokens.id, actor, "Paleta corporativa validada con el manual de marca de Acme.");
  console.log("design.tokens: v1 aprobada (paleta brand-* + tipografía).");

  // --- cms.collections → approved v1 -----------------------------------------
  await saveDraft(collections.id, collectionsV1, actor);
  await submitForReview(collections.id, actor);
  await approve(
    collections.id,
    actor,
    "Modelo de datos validado: casos de éxito, vacantes y testimonios.",
  );
  console.log("cms.collections: v1 aprobada (case-studies, job-openings, testimonials).");

  // --- content.page → approved v1 --------------------------------------------
  await saveDraft(content.id, contentV1, actor);
  await submitForReview(content.id, actor);
  await approve(content.id, actor, "Copy y SEO aprobados por el cliente.");
  console.log("content.page: v1 aprobada (inicio, servicios, contacto).");

  // --- page.composition por página: sync desde el sitemap aprobado ----------
  // Un artefacto por página (key = path). Historia por página: inicio y
  // servicios aprobadas v1, nosotros con borrador sin aprobar, el resto empty.
  const sync = await syncCompositionArtifacts(project.id, actor);
  console.log(
    `page.composition: ${sync.created.length} artefactos creados desde el sitemap (${sync.created
      .map((a) => a.key)
      .join(", ")}).`,
  );
  const compositionByKey = new Map(sync.compositions.map((a) => [a.key, a]));
  const requireComposition = (key: string) => {
    const artifact = compositionByKey.get(key);
    if (!artifact) throw new Error(`No se creó el artefacto page.composition de «${key}».`);
    return artifact;
  };

  // inicio (home): el scaffold que el Generator emitía para la portada,
  // ahora sellado como artefacto por página (misma verdad, ciclo §13).
  const inicioComposition = requireComposition("inicio");
  await saveDraft(inicioComposition.id, scaffoldComposition("inicio"), actor);
  await submitForReview(inicioComposition.id, actor);
  await approve(
    inicioComposition.id,
    actor,
    "Composición de «Inicio»: scaffold del Generator desde el copy aprobado, validado como composición de portada.",
  );
  console.log("page.composition[inicio]: v1 aprobada (scaffold del Generator como Data de Puck).");

  // servicios: composición autorada con bindings CMS reales.
  const serviciosComposition = requireComposition("servicios");
  await saveDraft(serviciosComposition.id, serviciosCompositionV1, actor);
  await submitForReview(serviciosComposition.id, actor);
  await approve(
    serviciosComposition.id,
    actor,
    "Composición de «Servicios» (Data de Puck) con bindings CMS: testimonio ($seedRef) y caso destacado (case-studies, snapshot de summary).",
  );
  console.log("page.composition[servicios]: v1 aprobada (Data de Puck con bindings CMS).");

  // nosotros: borrador con cambios sin aprobar (estado draft, sin versión).
  const nosotrosComposition = requireComposition("nosotros");
  await saveDraft(nosotrosComposition.id, nosotrosDraftComposition(), actor);
  console.log("page.composition[nosotros]: borrador guardado (cambios sin aprobar).");

  // --- Manual open task (mirrors the Cockpit's create-task action) ----------
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(tasks)
      .values({
        id: newId.task(),
        projectId: project.id,
        kind: "manual",
        title:
          "Recopilar assets de marca del cliente (logo vectorial y fotografías de planta)",
        status: "open",
        assigneeId: userId,
        artifactId: null,
        dedupeKey: null,
      })
      .returning();
    await logAudit(
      {
        workspaceId,
        projectId: project.id,
        actorId: userId,
        action: "task.created",
        entityType: "task",
        entityId: inserted[0].id,
        detail: { title: inserted[0].title, kind: "manual", assigneeId: userId },
      },
      tx,
    );
  });
  console.log("Tarea manual abierta creada.");

  console.log("\nSeed completado:");
  console.log("  - spec.intake       approved v2 (2 versiones inmutables)");
  console.log("  - spec.strategy     approved v2 (marcada outdated por intake v2 y re-validada)");
  console.log("  - spec.sitemap      approved v1 (6 páginas; borrador previo al re-scope)");
  console.log("  - design.tokens     approved v1");
  console.log("  - cms.collections   approved v1 (3 colecciones)");
  console.log("  - content.page      approved v1 (3 páginas con copy/SEO)");
  console.log(
    `  - page.composition  ${sync.created.length} artefactos (uno por página): «inicio» y «servicios» approved v1, «nosotros» en draft, resto empty`,
  );
  console.log("  - release           empty (fase futura)");
  console.log("  - 1 tarea manual abierta");
  console.log("\nEl proyecto demo es GENERABLE: los 3 artefactos requeridos por el");
  console.log("Generator están aprobados. Siguiente paso:");
  console.log("  npx tsx scripts/e2e-generator.ts   (o el botón «Generar» en la UI)");
  printCredentials();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
