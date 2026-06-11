import { z } from "zod";

import {
  cmsCollectionsPayloadSchema,
  flattenSitemap,
  type CmsCollectionsPayload,
  type SpecIntakePayload,
  type SpecSitemapPayload,
} from "@/modules/artifacts/types";

import { zodToProviderSchema } from "./json-schema";
import { buildSystemPrompt, contextSection, projectHeader } from "./prompt-shared";
import { parseProposalWith } from "./proposal";
import { defineSkill, readPayload, type SkillContext } from "./types";
import { lengthBounds, noEmptyFields, schemaValid } from "./validations";

/**
 * Skill 2 (§9.3): `generate-cms-schema` — de la spec aprobada (intake +
 * estrategia + sitemap) a una propuesta de colecciones del CMS
 * (`cms.collections`), de las que el generator deriva Payload (§7.3, §10.2).
 */

export const generateCmsSchemaParamsSchema = z.object({});

export type GenerateCmsSchemaParams = z.infer<typeof generateCmsSchemaParamsSchema>;

// ---------------------------------------------------------------------------
// Mock determinista
// ---------------------------------------------------------------------------

function mockCollections(context: SkillContext): CmsCollectionsPayload {
  const intake = readPayload<SpecIntakePayload>(context, "spec.intake");
  const sitemap = readPayload<SpecSitemapPayload>(context, "spec.sitemap");
  if (!intake || !sitemap) {
    throw new Error("generate-cms-schema requiere intake y sitemap aprobados en el contexto.");
  }
  const slugs = new Set(flattenSitemap(sitemap.pages).map((page) => page.slug));

  const collections: CmsCollectionsPayload["collections"] = [
    {
      slug: "testimonials",
      label: "Testimonios",
      description: `Citas de clientes de ${intake.client.name} para prueba social.`,
      timestamps: true,
      fields: [
        { name: "quote", label: "Cita", type: "text", required: true, hasMany: false },
        { name: "author", label: "Autor", type: "text", required: true, hasMany: false },
        { name: "role", label: "Cargo", type: "text", required: false, hasMany: false },
        { name: "company", label: "Empresa", type: "text", required: false, hasMany: false },
      ],
    },
  ];

  if (slugs.has("blog")) {
    collections.push({
      slug: "posts",
      label: "Artículos del blog",
      description: "Contenido editorial publicado desde el CMS.",
      timestamps: true,
      fields: [
        { name: "title", label: "Título", type: "text", required: true, hasMany: false },
        { name: "excerpt", label: "Extracto", type: "text", required: true, hasMany: false },
        { name: "body", label: "Cuerpo", type: "richText", required: true, hasMany: false },
        { name: "publishedAt", label: "Fecha de publicación", type: "date", required: true, hasMany: false },
        { name: "cover", label: "Imagen de portada", type: "image", required: false, hasMany: false },
      ],
    });
  }

  if (slugs.has("proyectos")) {
    collections.push({
      slug: "case-studies",
      label: "Proyectos",
      description: "Casos de cliente con resultados comparables.",
      timestamps: true,
      fields: [
        { name: "title", label: "Título", type: "text", required: true, hasMany: false },
        { name: "summary", label: "Resumen", type: "text", required: true, hasMany: false },
        { name: "body", label: "Detalle", type: "richText", required: false, hasMany: false },
        {
          name: "sector",
          label: "Sector",
          type: "select",
          required: false,
          hasMany: false,
          options: ["industria", "servicios", "tecnología", "otro"],
        },
        {
          name: "testimonial",
          label: "Testimonio relacionado",
          type: "relation",
          required: false,
          hasMany: false,
          relationTo: "testimonials",
        },
      ],
    });
  }

  if (slugs.has("carreras")) {
    collections.push({
      slug: "vacantes",
      label: "Vacantes",
      description: "Ofertas de empleo gestionadas desde el CMS.",
      timestamps: true,
      fields: [
        { name: "title", label: "Puesto", type: "text", required: true, hasMany: false },
        { name: "location", label: "Ubicación", type: "text", required: true, hasMany: false },
        { name: "description", label: "Descripción", type: "richText", required: true, hasMany: false },
        { name: "open", label: "Abierta", type: "boolean", required: false, hasMany: false },
      ],
    });
  }

  return { collections };
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export const generateCmsSchemaSkill = defineSkill<GenerateCmsSchemaParams>({
  name: "generate-cms-schema",
  version: "1.0",
  label: "Proponer modelo de datos (CMS)",
  description:
    "Propone las colecciones del CMS (campos tipados y relaciones) a partir de la spec aprobada.",
  reads: [
    { type: "spec.intake", mode: "approved", required: true },
    { type: "spec.strategy", mode: "approved", required: true },
    { type: "spec.sitemap", mode: "approved", required: true },
    { type: "cms.collections", mode: "current", required: false },
  ],
  writes: { types: ["cms.collections"] },
  requiresApproval: true,
  paramsSchema: generateCmsSchemaParamsSchema,
  validations: [
    schemaValid(),
    noEmptyFields(),
    lengthBounds([
      { path: /(^|\.)label$/, label: "Etiqueta", max: 60 },
      { path: /(^|\.)description$/, label: "Descripción", max: 240 },
    ]),
  ],
  modelPolicy: { preferred: "anthropic", fallbacks: ["openai", "mock"] },
  costBudget: { maxTokens: 8000 },
  availableIn: ["cockpit", "spec-os"],
  relevantFor: (artifactType) =>
    artifactType === "cms.collections" || artifactType === "spec.sitemap",
  resolveTarget: () => ({ type: "cms.collections", key: null }),

  buildPrompt: (context) => ({
    system: buildSystemPrompt(
      "proponer el MODELO DE DATOS del CMS: colecciones con campos tipados y relaciones, derivadas de la spec aprobada.",
      [
        "Solo colecciones que el sitio del sitemap realmente consume (testimonios, casos, posts…); el contenido fijo de página NO es una colección.",
        "Slugs de colección en minúsculas con guiones y en plural; nombres de campo en camelCase.",
        "Tipos de campo permitidos: text, richText, number, boolean, date, image, select (con options) y relation (con relationTo a una colección del propio modelo).",
        "Marca `required` solo en los campos sin los que un documento no tiene sentido.",
        "Entre 1 y 6 colecciones: el modelo mínimo que cubre el alcance, no un ERP.",
      ],
    ),
    user: [
      projectHeader(context),
      "",
      contextSection(context, "Intake aprobado", "spec.intake"),
      "",
      contextSection(context, "Estrategia aprobada", "spec.strategy"),
      "",
      contextSection(context, "Sitemap aprobado", "spec.sitemap"),
      "",
      contextSection(context, "Modelo de datos actual (si existe, revísalo en vez de partir de cero)", "cms.collections"),
      "",
      "Propón el modelo de colecciones completo conforme al schema.",
    ].join("\n"),
    schemaName: "cms_collections_payload",
    schema: zodToProviderSchema(cmsCollectionsPayloadSchema),
  }),

  parseProposal: (json) => parseProposalWith(cmsCollectionsPayloadSchema, json),

  buildMockProposal: (context) => mockCollections(context),
});
