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
 *   - release           SEALED as v1 (see step-5 block below)
 * - One open manual task + the activity/audit feed of the whole story
 *
 * STEP 5 (release + client review, §7.7/§7.8) — `ensureReleaseAndReviewRound`
 * runs on every execution (also when the project already existed) and leaves,
 * idempotently:
 *   - EVERY page of the approved sitemap with an approved `page.composition`
 *     (pending drafts are approved; empty pages get the Generator scaffold
 *     built from the REAL approved payloads in the DB),
 *   - the generated repo up to date (generate/regenerate through the real
 *     Generator service — the deploy provider builds from the git TAG, so the
 *     repo must incorporate the approved compositions before sealing),
 *   - the §7.8 release checklist all green,
 *   - release v1 SEALED for real (immutable version of the `release` artifact
 *     + git tag `release-1`) via `createRelease`,
 *   - one OPEN review round («Cliente Acme — ronda 1») with 2 demo client
 *     comments: one open (its derived task §12.2 is visible in the Cockpit)
 *     and one already resolved. NO client approval — that moment is left for
 *     the user to live in /review/<token>.
 *   - It never deploys: builds take minutes and belong to the user/e2e
 *     (`npx tsx scripts/e2e-deploy-review.ts` or the Deploy screen).
 * The review link is printed at the very end of the seed.
 *
 * STEP 6 (agents, §7.9/§9) — `ensureAgentDemo` also runs on every execution:
 *   - the workspace gets a `mock` BYOK key («Proveedor de demostración»),
 *     created through the real `addKey` path (validated, AES-256-GCM at rest,
 *     audited; the mock provider never actually consumes a key),
 *   - ONE agent run settled in `proposed` over the «nosotros» composition
 *     (revise-artifact, instruction «Haz el tono más cercano y menciona el
 *     servicio 24h», via the REAL runner with the deterministic mock
 *     provider): draft + validaciones + diff waiting for the HUMAN decision
 *     (§8.6/§13 — the seed never decides it). Created only when the project
 *     has no runs yet; once decided, re-seeding never re-opens the moment.
 *   With the pending proposal, the LIVE release checklist shows «nosotros»
 *   sin aprobar — expected: release v1 froze a green checklist when sealed.
 *
 * The three artifacts the Generator REQUIRES (§7.3: spec.sitemap,
 * cms.collections, design.tokens) end up approved, so the demo project is
 * generable right after seeding (see scripts/e2e-generator.ts).
 *
 * Everything flows through the real domain services (`createWorkspace`,
 * `createProject`, `saveDraft`, `submitForReview`, `approve`,
 * `createRelease`, `createReviewRequest`, `addClientComment`), so states,
 * sealed versions, derived tasks and audit events are produced by the same
 * code paths the app uses.
 *
 * Idempotency: if the demo project already exists the seed only ensures the
 * step-5 state (no-ops when it is already there) and re-prints credentials +
 * review link. To re-generate from scratch: delete `./.data` and run
 * `npm run db:migrate && npm run db:seed`.
 */
import { randomBytes, scrypt } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

import { and, eq, isNull } from "drizzle-orm";

import { getDb, type Db } from "../src/db/client";
import { newId } from "../src/db/ids";
import {
  agentRuns,
  artifactVersions,
  projects,
  tasks,
  users,
  workspaceLlmKeys,
  workspaces,
} from "../src/db/schema";
import { addKey } from "../src/modules/agents/keys/service";
import { startRun, waitForRunSettled } from "../src/modules/agents/runtime/runner";
import { bindSkillForRun, getSkill } from "../src/modules/agents/skills";
import {
  approve,
  getProjectArtifacts,
  saveDraft,
  submitForReview,
  syncCompositionArtifacts,
  type HumanActor,
  type ProjectArtifact,
} from "../src/modules/artifacts/service";
import {
  cmsCollectionsPayloadSchema,
  type CmsCollectionsPayload,
} from "../src/modules/artifacts/types/cms-collections";
import {
  contentPagePayloadSchema,
  type ContentPagePayload,
} from "../src/modules/artifacts/types/content-page";
import {
  designTokensPayloadSchema,
  type DesignTokensPayload,
} from "../src/modules/artifacts/types/design-tokens";
import {
  pageCompositionPayloadSchema,
  type PageCompositionPayload,
} from "../src/modules/artifacts/types/page-composition";
import { releasePayloadSchema } from "../src/modules/artifacts/types/release";
import { getBuildMarkerPath, getReleaseBuildDir } from "../src/modules/deploy";
import { formatConflict, type Conflict } from "../src/modules/generator/conflicts";
import { hasManifest } from "../src/modules/generator/engine";
import { getProjectRepoDir } from "../src/modules/generator/paths";
import {
  compositionFilePath,
  renderHumanScaffolds,
} from "../src/modules/generator/render";
import {
  generateProject,
  getGenerations,
  regenerateProject,
  type GenerationSummary,
} from "../src/modules/generator/service";
import {
  addClientComment,
  createRelease,
  createReviewRequest,
  listReviewRequests,
  resolveComment,
  runReleaseChecklist,
} from "../src/modules/review/service";
import {
  flattenSitemap,
  specSitemapPayloadSchema,
  type SpecSitemapPayload,
} from "../src/modules/artifacts/types/spec-sitemap";
import type { SpecIntakePayload } from "../src/modules/artifacts/types/spec-intake";
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
// Step 5 — release + client review round (§7.7, §7.8, §8.5, §12.2)
// ---------------------------------------------------------------------------

const DEMO_REVIEW_LABEL = "Cliente Acme — ronda 1";
const DEMO_CLIENT_NAME = "Laura Gómez";

/** Sealed (immutable) payload of an artifact version, straight from the DB. */
async function loadSealedPayload(
  db: Db,
  artifactId: string,
  version: number,
): Promise<unknown> {
  const rows = await db
    .select({ payload: artifactVersions.payload })
    .from(artifactVersions)
    .where(
      and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.version, version)),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error(`No existe la versión sellada v${version} del artefacto ${artifactId}.`);
  }
  return rows[0].payload;
}

function isSealed(item: ProjectArtifact | undefined): item is ProjectArtifact {
  if (!item) return false;
  const { status, currentVersion } = item.artifact;
  return (status === "approved" || status === "locked") && currentVersion > 0;
}

function failOnConflicts(conflicts: Conflict[]): void {
  if (conflicts.length === 0) return;
  throw new Error(
    `La generación reportó conflictos (§18.2) — resuélvelos desde la pantalla Generator:\n` +
      conflicts.map((conflict) => `  - ${formatConflict(conflict)}`).join("\n"),
  );
}

/**
 * True when the last generation already consumed the CURRENT sealed versions
 * of every generator input (singletons + approved per-page compositions) —
 * used to keep the seed idempotent: re-running it never piles up no-op
 * `generations` rows.
 */
function generationIsCurrent(summary: GenerationSummary, items: ProjectArtifact[]): boolean {
  const singletonVersion = (type: string): number => {
    const item = items.find((i) => i.artifact.type === type && i.artifact.key == null);
    return isSealed(item) ? item.artifact.currentVersion : 0;
  };
  for (const type of [
    "spec.sitemap",
    "cms.collections",
    "design.tokens",
    "content.page",
  ] as const) {
    if ((summary.inputVersions[type] ?? 0) !== singletonVersion(type)) return false;
  }
  // A page with a PENDING proposal/draft over a sealed version (§8.6 — e.g.
  // the demo agent run on «nosotros») still counts by its sealed version: the
  // sealed payload is the page's truth until a human decides, and regenerating
  // here would destructively drop the page from the repo.
  const sealedCompositions = items.filter(
    (i) =>
      i.artifact.type === "page.composition" &&
      i.artifact.key != null &&
      i.artifact.currentVersion > 0,
  );
  const consumed = summary.compositionVersions ?? {};
  if (Object.keys(consumed).length !== sealedCompositions.length) return false;
  return sealedCompositions.every(
    (i) => consumed[i.artifact.key as string] === i.artifact.currentVersion,
  );
}

/**
 * Leaves the demo project ready for the full step-5 walkthrough, idempotently:
 * every sitemap page approved → repo regenerated → checklist §7.8 green →
 * release v1 sealed → open review round with 2 client comments (one open with
 * its derived task, one resolved) and NO client approval yet. Returns the
 * round's token so the caller prints the shareable link at the very end.
 *
 * It deliberately NEVER deploys (builds take minutes): that is the user's
 * moment in the Deploy screen, or `npx tsx scripts/e2e-deploy-review.ts`.
 */
async function ensureReleaseAndReviewRound(
  db: Db,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<string> {
  const actor: HumanActor = { id: userId, role: "admin", workspaceId };
  console.log("\n— Paso 5: release + ronda de review (idempotente) —");

  // --- (a) every page of the APPROVED sitemap gets an approved composition --
  const sync = await syncCompositionArtifacts(projectId, actor);
  if (sync.created.length > 0) {
    console.log(
      `page.composition: ${sync.created.length} artefacto(s) sincronizados del sitemap (${sync.created
        .map((a) => a.key)
        .join(", ")}).`,
    );
  }
  let items = await getProjectArtifacts(projectId);
  const singleton = (type: string) =>
    items.find((i) => i.artifact.type === type && i.artifact.key == null);
  const sitemapItem = singleton("spec.sitemap");
  const cmsItem = singleton("cms.collections");
  const tokensItem = singleton("design.tokens");
  const contentItem = singleton("content.page");
  if (!isSealed(sitemapItem) || !isSealed(cmsItem) || !isSealed(tokensItem)) {
    throw new Error("Paso 5: faltan los inputs aprobados del generator (sitemap/cms/tokens).");
  }
  const sitemapPayload = specSitemapPayloadSchema.parse(
    await loadSealedPayload(db, sitemapItem.artifact.id, sitemapItem.artifact.currentVersion),
  );
  const flatPages = flattenSitemap(sitemapPayload.pages);

  // Generator scaffolds for the still-empty pages, rendered from the REAL
  // approved payloads in the DB (never from this file's fixtures: an existing
  // demo DB may have evolved past them, e.g. via the e2e drills).
  let scaffolds: Map<string, string> | null = null;
  const scaffoldFor = async (slug: string): Promise<PageCompositionPayload> => {
    if (!scaffolds) {
      const collections = cmsCollectionsPayloadSchema.parse(
        await loadSealedPayload(db, cmsItem.artifact.id, cmsItem.artifact.currentVersion),
      );
      const tokens = designTokensPayloadSchema.parse(
        await loadSealedPayload(db, tokensItem.artifact.id, tokensItem.artifact.currentVersion),
      );
      const content = isSealed(contentItem)
        ? contentPagePayloadSchema.parse(
            await loadSealedPayload(
              db,
              contentItem.artifact.id,
              contentItem.artifact.currentVersion,
            ),
          )
        : null;
      scaffolds = renderHumanScaffolds({
        projectName: DEMO_PROJECT_NAME,
        sitemap: sitemapPayload,
        collections,
        tokens,
        content,
        compositions: {},
      });
    }
    const raw = scaffolds.get(compositionFilePath(slug));
    if (!raw) {
      throw new Error(`El generator no produjo scaffold de composición para «${slug}».`);
    }
    return pageCompositionPayloadSchema.parse(JSON.parse(raw));
  };

  let approvedCount = 0;
  for (const page of flatPages) {
    const item = items.find(
      (i) => i.artifact.type === "page.composition" && i.artifact.key === page.pagePath,
    );
    if (!item) {
      throw new Error(`Paso 5: falta el artefacto page.composition de «${page.pagePath}».`);
    }
    // A page that already has a sealed version is left alone EVEN IF a newer
    // draft is pending (e.g. the paso-6 agent proposal on «nosotros»): the
    // seed must never decide a proposal — that moment belongs to the user
    // (§8.6/§13). Only never-sealed pages are walked through the cycle here.
    const hasSealedVersion = item.artifact.currentVersion > 0;
    if (hasSealedVersion) continue;
    let status = item.artifact.status;
    if (status === "empty") {
      await saveDraft(item.artifact.id, await scaffoldFor(page.slug), actor);
      status = "draft";
    }
    if (status === "draft") {
      await submitForReview(item.artifact.id, actor);
      status = "in_review";
    }
    if (status !== "in_review") {
      throw new Error(
        `Paso 5: estado inesperado «${status}» en la composición de «${page.pagePath}».`,
      );
    }
    await approve(
      item.artifact.id,
      actor,
      "Composición aprobada para el primer release (checklist §7.8 del paso 5).",
    );
    approvedCount += 1;
    console.log(`page.composition[${page.pagePath}]: aprobada.`);
  }
  if (approvedCount === 0) {
    console.log("page.composition: todas las páginas del sitemap ya estaban aprobadas.");
  }
  items = await getProjectArtifacts(projectId);

  // --- (b) generated repo up to date (the provider builds from the git TAG) --
  // NOTE (template-statics): regeneration only rewrites codegen-owned files;
  // files copied verbatim from the template (e.g. `src/puck/*`) are human
  // territory after the initial copy and are NEVER re-copied (§18.2). Template
  // upgrades for already-generated repos have no product story yet — the demo
  // repo received the section-anchor change via an explicit git commit.
  const repoDir = getProjectRepoDir(projectId);
  if (!hasManifest(repoDir)) {
    const result = await generateProject(projectId, actor);
    failOnConflicts(result.summary.conflicts);
    console.log(
      `Proyecto generado en ${result.repoDir} (${result.summary.created.length} archivos, commit ${result.summary.commit?.slice(0, 10) ?? "—"}).`,
    );
  } else {
    const [last] = await getGenerations(projectId, 1);
    const lastSummary = last?.generation.summary as GenerationSummary | undefined;
    const upToDate =
      last?.generation.status === "success" &&
      lastSummary != null &&
      generationIsCurrent(lastSummary, items);
    if (upToDate) {
      console.log("Generación al día: la última generación ya consume las versiones selladas actuales.");
    } else {
      const result = await regenerateProject(projectId, actor);
      failOnConflicts(result.summary.conflicts);
      console.log(
        `Proyecto regenerado: ${result.summary.written.length} reescritos, ${result.summary.created.length} creados` +
          (result.summary.commit ? ` (commit ${result.summary.commit.slice(0, 10)}).` : " (sin cambios)."),
      );
    }
  }
  if (!readPuckAnchorsPresent(repoDir)) {
    console.warn(
      "AVISO: el repo demo no incluye las anclas de sección del template (src/puck/primitives.tsx sin withBlockAnchors).\n" +
        "  La regeneración NO re-copia archivos estáticos del template (son territorio humano tras la copia inicial, §18.2)\n" +
        "  y no existe aún una historia de «upgrade de template». Opciones honestas: re-crear el repo demo\n" +
        "  (npx tsx scripts/e2e-studio.ts) o portar el cambio con un commit humano en el repo generado.",
    );
  }

  // --- (c) release checklist §7.8 — enforced before sealing v1 ---------------
  const releaseItem = singleton("release");
  if (!releaseItem) {
    throw new Error("Paso 5: el proyecto no tiene artefacto release.");
  }
  let releaseVersion = releaseItem.artifact.currentVersion;
  const checklist = await runReleaseChecklist(projectId);
  for (const item of checklist) {
    console.log(`  ${item.ok ? "✓" : "✗"} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  const failing = checklist.filter((item) => !item.ok);
  if (failing.length > 0) {
    if (releaseVersion === 0) {
      throw new Error(
        `El checklist de release no quedó en verde: ${failing.map((item) => item.key).join(", ")}.`,
      );
    }
    // Release v1 already sealed (its payload froze a green checklist): the
    // LIVE checklist may legitimately be red now — e.g. the paso-6 agent
    // proposal pending on «nosotros». The seed reports it and moves on.
    console.log(
      "  (release v1 ya sellado; el checklist refleja el estado VIVO — p.ej. una propuesta de agente pendiente — y no bloquea el seed)",
    );
  }

  // --- (d) release v1: sealed for real via createRelease ---------------------
  if (releaseVersion === 0) {
    const created = await createRelease(
      projectId,
      "Release v1 de la demo: todas las composiciones del sitemap aprobadas y checklist §7.8 en verde.",
      actor,
    );
    releaseVersion = created.version.version;
    console.log(
      `release: v${releaseVersion} sellado (tag ${created.gitTag} → ${created.taggedCommit.slice(0, 10)}).`,
    );
    // Stale-build cleanup: scripts/smoke-deploy.ts may have sealed a LOCAL
    // build of `release-1` over a manual pre-release tag. `createRelease`
    // re-tags (`git tag --force`), so that old build's commit no longer
    // matches and would trip the provider's immutability guard on deploy.
    // It never belonged to a platform release — remove it so the provider
    // builds the real one.
    const markerPath = getBuildMarkerPath(projectId, created.payload.releaseNumber);
    if (existsSync(markerPath)) {
      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as { commit?: string };
      if (marker.commit !== created.taggedCommit) {
        rmSync(getReleaseBuildDir(projectId, created.payload.releaseNumber), {
          recursive: true,
          force: true,
        });
        console.log(
          "  (build local previo de release-1 — sellado sobre un tag manual anterior al release real — eliminado)",
        );
      }
    }
  } else {
    console.log(`release: ya existe v${releaseVersion}; no se sella otro.`);
  }

  // --- (e) open review round («Cliente Acme — ronda 1») ----------------------
  const summaries = await listReviewRequests(projectId);
  let summary = summaries.find((s) => s.request.label === DEMO_REVIEW_LABEL);
  if (!summary) {
    const request = await createReviewRequest(projectId, releaseVersion, DEMO_REVIEW_LABEL, actor);
    summary = { request, commentCount: 0, openCommentCount: 0, approvalCount: 0 };
    console.log(`review: ronda «${DEMO_REVIEW_LABEL}» abierta sobre release v${releaseVersion}.`);
  } else {
    console.log(
      `review: la ronda «${DEMO_REVIEW_LABEL}» ya existe (${summary.commentCount} comentarios); no se recrea.`,
    );
  }
  const request = summary.request;

  // --- (f) the 2 demo client comments (one open + task, one resolved) --------
  if (request.status === "open" && summary.commentCount === 0) {
    const releasePayload = releasePayloadSchema.parse(
      await loadSealedPayload(db, releaseItem.artifact.id, request.releaseVersion),
    );
    const pageKeys = Object.keys(releasePayload.versions.compositions).sort();
    const pickPage = (preferred: string, fallbackIndex: number): string =>
      pageKeys.includes(preferred)
        ? preferred
        : pageKeys[Math.min(fallbackIndex, pageKeys.length - 1)];
    const sectionIdFor = async (pageKey: string): Promise<string | null> => {
      const item = items.find(
        (i) => i.artifact.type === "page.composition" && i.artifact.key === pageKey,
      );
      const version = releasePayload.versions.compositions[pageKey];
      if (!item || !version) return null;
      const parsed = pageCompositionPayloadSchema.safeParse(
        await loadSealedPayload(db, item.artifact.id, version),
      );
      if (!parsed.success) return null;
      const block =
        parsed.data.content.find((b) => b.type !== "Navbar" && b.type !== "Footer") ??
        parsed.data.content[0];
      const id = block?.props?.id;
      return typeof id === "string" ? id : null;
    };

    const openPage = pickPage("inicio", 0);
    const openComment = await addClientComment(request.token, {
      pageKey: openPage,
      sectionId: await sectionIdFor(openPage),
      authorName: DEMO_CLIENT_NAME,
      body:
        "El titular transmite fiabilidad, pero el plazo de respuesta del SAT (24 h) debería verse en la primera pantalla: es nuestro principal argumento de venta.",
    });
    console.log(
      `review: comentario de cliente ABIERTO en «${openPage}» (${openComment.id}) — su tarea derivada §12.2 queda visible en el Cockpit.`,
    );

    const resolvedPage = pickPage("servicios", Math.min(1, pageKeys.length - 1));
    const resolvedComment = await addClientComment(request.token, {
      pageKey: resolvedPage,
      sectionId: await sectionIdFor(resolvedPage),
      authorName: DEMO_CLIENT_NAME,
      body:
        "El caso destacado menciona a Atlántica Foods: confirmad con su responsable que podemos citarlos antes de publicar.",
    });
    await resolveComment(resolvedComment.id, actor);
    console.log(
      `review: comentario de cliente en «${resolvedPage}» (${resolvedComment.id}) creado y RESUELTO (su tarea derivada queda cerrada).`,
    );
    console.log("review: sin aprobación de cliente todavía — ese momento es del usuario.");
  }

  return request.token;
}

// ---------------------------------------------------------------------------
// Step 6 — agents (§7.9, §9): mock BYOK key + ONE pending proposal (§8.6)
// ---------------------------------------------------------------------------

const DEMO_LLM_KEY_LABEL = "Proveedor de demostración";
const DEMO_AGENT_INSTRUCTION = "Haz el tono más cercano y menciona el servicio 24h";

/**
 * Leaves the paso-6 demo state, idempotently:
 * - the workspace has a `mock` BYOK key («Proveedor de demostración») — the
 *   mock provider needs no key to run, but the row makes BYOK visible in the
 *   demo data and exercises the real `addKey` path (validation + encryption
 *   at rest + audit);
 * - ONE agent run settled in `proposed` over the «nosotros» composition
 *   (revise-artifact via the REAL runner with the mock provider), so the user
 *   opens the demo and LIVES the human decision (§8.6/§13): approve, edit or
 *   reject from /runs/<runId>, the Studio or the assistant.
 *
 * Idempotency cutoff: the run is only created when the project has NO agent
 * runs yet. Once the user (or an e2e drill) decides it, re-seeding never
 * re-opens the moment — a pristine demo is `rm -rf .data && migrate && seed`.
 */
async function ensureAgentDemo(
  db: Db,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<{ runId: string; created: boolean } | null> {
  const actor: HumanActor = { id: userId, role: "admin", workspaceId };
  console.log("\n— Paso 6: agentes — key mock + propuesta pendiente (idempotente) —");

  // --- (a) mock BYOK key, idempotent by (workspace, provider, label) --------
  const existingKey = await db
    .select({ id: workspaceLlmKeys.id })
    .from(workspaceLlmKeys)
    .where(
      and(
        eq(workspaceLlmKeys.workspaceId, workspaceId),
        eq(workspaceLlmKeys.provider, "mock"),
        eq(workspaceLlmKeys.label, DEMO_LLM_KEY_LABEL),
        isNull(workspaceLlmKeys.deletedAt),
      ),
    )
    .limit(1);
  if (existingKey[0]) {
    console.log(`llm_key: «${DEMO_LLM_KEY_LABEL}» (mock) ya existe; no se recrea.`);
  } else {
    const key = await addKey(
      {
        workspaceId,
        provider: "mock",
        label: DEMO_LLM_KEY_LABEL,
        // Demo value: the mock provider never consumes it, but it goes through
        // the real path (validated, AES-256-GCM at rest, audited, last4 only).
        apiKey: "mock-demo-2026",
      },
      actor,
    );
    console.log(`llm_key: «${DEMO_LLM_KEY_LABEL}» (mock) añadida (····${key.last4}).`);
  }

  // --- (b) ONE run in `proposed` over «nosotros» (only if no runs exist) ----
  const existingRun = await db
    .select({ id: agentRuns.id, status: agentRuns.status })
    .from(agentRuns)
    .where(eq(agentRuns.projectId, projectId))
    .limit(1);
  if (existingRun[0]) {
    console.log(
      "agent run: el proyecto ya tiene runs; no se crea otra propuesta (demo impoluta: borra ./.data y re-siembra).",
    );
    return null;
  }

  const items = await getProjectArtifacts(projectId);
  const nosotros = items.find(
    (item) => item.artifact.type === "page.composition" && item.artifact.key === "nosotros",
  );
  if (
    !nosotros ||
    nosotros.artifact.currentVersion === 0 ||
    nosotros.artifact.status === "locked" ||
    nosotros.artifact.status === "in_review"
  ) {
    console.warn(
      "AVISO: no existe una composición «nosotros» aprobada y decidible; se omite el agent run demo.",
    );
    return null;
  }

  // The REAL production path: bind (Zod over params) → startRun (queued row +
  // async execution) → settled. Deterministic mock provider: no network, $0.
  const bound = bindSkillForRun(getSkill("revise-artifact"), {
    instruction: DEMO_AGENT_INSTRUCTION,
    targetType: "page.composition",
    targetKey: "nosotros",
  });
  const run = await startRun(
    {
      projectId,
      skill: bound.definition,
      provider: "mock",
      targetType: bound.target.type,
      targetKey: bound.target.key,
      instruction: bound.instruction,
    },
    actor,
  );
  const settled = await waitForRunSettled(run.id);
  if (settled.status !== "proposed") {
    throw new Error(
      `El agent run demo no quedó en proposed (estado «${settled.status}»: ${settled.errorDetail ?? "sin detalle"}).`,
    );
  }
  console.log(
    `agent run: revise-artifact@${settled.skillVersion} (mock) → PROPUESTA pendiente sobre «nosotros» (${run.id}).`,
  );
  console.log(`  instrucción: «${DEMO_AGENT_INSTRUCTION}»`);
  console.log(
    "  El run NO aprueba nada (§19): deja un draft + validaciones + diff esperando tu decisión.",
  );
  return { runId: run.id, created: true };
}

/** True when the generated repo's template statics carry the section anchors. */
function readPuckAnchorsPresent(repoDir: string): boolean {
  const primitives = path.join(repoDir, "src", "puck", "primitives.tsx");
  if (!existsSync(primitives)) return false;
  return readFileSync(primitives, "utf8").includes("withBlockAnchors");
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

/** The pending agent proposal: where the user lives the human decision (§13). */
function printAgentRunLink(
  projectId: string,
  agentDemo: { runId: string; created: boolean } | null,
): void {
  if (!agentDemo) return;
  console.log("\n────────────────────────────────────────────");
  console.log("Agent run demo (propuesta PENDIENTE de decisión humana)");
  console.log(`  Run:   http://localhost:3000/w/${DEMO_WORKSPACE_SLUG}/p/${projectId}/runs/${agentDemo.runId}`);
  console.log("  skill: revise-artifact (mock, $0) sobre la composición «nosotros»");
  console.log("  Aprueba, edita-y-aprueba o rechaza: la decisión es tuya (§8.6, §19).");
  console.log("────────────────────────────────────────────");
}

/** The shareable client link of the demo review round (R8: token = credential). */
function printReviewLink(token: string): void {
  console.log("\n────────────────────────────────────────────");
  console.log(`Ronda de review del cliente («${DEMO_REVIEW_LABEL}»)`);
  console.log(`  Link:  http://localhost:3000/review/${token}`);
  console.log("  (la página del cliente embebe el deployment del slot preview;");
  console.log("   despliega el release desde la pantalla Deploy o con");
  console.log("   npx tsx scripts/e2e-deploy-review.ts para verla servida)");
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
      `Proyecto "${DEMO_PROJECT_NAME}" ya existe (${existingProject[0].id}); historia base omitida.`,
    );
    // The step-5/6 state is still ensured (idempotent: no-ops when present).
    const token = await ensureReleaseAndReviewRound(
      db,
      workspaceId,
      existingProject[0].id,
      userId,
    );
    const agentDemo = await ensureAgentDemo(db, workspaceId, existingProject[0].id, userId);
    printCredentials();
    printReviewLink(token);
    printAgentRunLink(existingProject[0].id, agentDemo);
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

  // --- Paso 5: composiciones restantes + release v1 + ronda de review -------
  const token = await ensureReleaseAndReviewRound(db, workspaceId, project.id, userId);

  // --- Paso 6: agentes — key mock BYOK + UNA propuesta pendiente (§8.6) -----
  const agentDemo = await ensureAgentDemo(db, workspaceId, project.id, userId);

  console.log("\nSeed completado:");
  console.log("  - spec.intake       approved v2 (2 versiones inmutables)");
  console.log("  - spec.strategy     approved v2 (marcada outdated por intake v2 y re-validada)");
  console.log("  - spec.sitemap      approved v1 (6 páginas; borrador previo al re-scope)");
  console.log("  - design.tokens     approved v1");
  console.log("  - cms.collections   approved v1 (3 colecciones)");
  console.log("  - content.page      approved v1 (3 páginas con copy/SEO)");
  console.log(
    `  - page.composition  ${sync.created.length} artefactos (uno por página), TODAS las páginas del sitemap aprobadas (el borrador de «nosotros» quedó sellado como v1)`,
  );
  console.log("  - release           v1 SELLADO (versión inmutable + tag git release-1)");
  console.log(
    `  - review            ronda abierta «${DEMO_REVIEW_LABEL}»: 1 comentario abierto (con tarea derivada en el Cockpit) + 1 resuelto; SIN aprobación de cliente`,
  );
  console.log("  - 1 tarea manual abierta");
  console.log(
    `  - llm_key mock      «${DEMO_LLM_KEY_LABEL}» (BYOK §16; cifrada en reposo, solo last4 visible)`,
  );
  if (agentDemo) {
    console.log(
      "  - agent run         revise-artifact (mock) en estado PROPOSED sobre «nosotros» — draft + diff + validaciones esperando TU decisión (§8.6)",
    );
  }
  console.log("\nSiguiente paso (deploy real, lo hace el usuario o el e2e):");
  console.log("  npx tsx scripts/e2e-deploy-review.ts   (o la pantalla Deploy del proyecto)");
  printCredentials();
  printReviewLink(token);
  printAgentRunLink(project.id, agentDemo);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
