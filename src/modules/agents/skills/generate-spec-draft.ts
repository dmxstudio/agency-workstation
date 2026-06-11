import { z } from "zod";

import {
  specSitemapPayloadSchema,
  specStrategyPayloadSchema,
  type SpecIntakePayload,
  type SpecSitemapPayload,
  type SpecStrategyPayload,
  type SitemapNode,
} from "@/modules/artifacts/types";

import { zodToProviderSchema } from "./json-schema";
import { buildSystemPrompt, contextSection, projectHeader } from "./prompt-shared";
import { parseProposalWith } from "./proposal";
import { defineSkill, readPayload, type SkillContext, type SkillRead } from "./types";
import { lengthBounds, noEmptyFields, schemaValid, toneMatch } from "./validations";

/**
 * Skill 1 (§9.3): `generate-spec-draft` — del intake aprobado a borradores de
 * estrategia y sitemap. El target se selecciona por params (`target`): una
 * primera invocación propone `spec.strategy`; una segunda, con la estrategia
 * ya aprobada, propone `spec.sitemap`.
 */

export const generateSpecDraftParamsSchema = z.object({
  /** Qué artefacto de spec proponer en esta invocación. */
  target: z.enum(["strategy", "sitemap"]).default("strategy"),
});

export type GenerateSpecDraftParams = z.infer<typeof generateSpecDraftParamsSchema>;

const READS_STRATEGY: SkillRead[] = [
  { type: "spec.intake", mode: "approved", required: true },
  { type: "spec.strategy", mode: "current", required: false },
];

const READS_SITEMAP: SkillRead[] = [
  { type: "spec.intake", mode: "approved", required: true },
  { type: "spec.strategy", mode: "approved", required: true },
  { type: "spec.sitemap", mode: "current", required: false },
];

// ---------------------------------------------------------------------------
// Mock determinista
// ---------------------------------------------------------------------------

function requireIntake(context: SkillContext): SpecIntakePayload {
  const intake = readPayload<SpecIntakePayload>(context, "spec.intake");
  if (!intake) {
    throw new Error("generate-spec-draft requiere el intake aprobado en el contexto.");
  }
  return intake;
}

function mockStrategy(context: SkillContext): SpecStrategyPayload {
  const intake = requireIntake(context);
  const clientName = intake.client.name;
  const industry = intake.client.industry?.trim();

  const audiences: SpecStrategyPayload["audiences"] = [
    {
      name: industry
        ? `Responsables de compra en ${industry.toLowerCase()}`
        : "Responsables de compra",
      description: `Perfil con capacidad de decisión que evalúa a ${clientName} frente a alternativas establecidas.`,
      needs: [
        "Entender la oferta y su alcance en una primera visita",
        "Señales claras de fiabilidad y experiencia demostrable",
        "Una vía de contacto directa y sin fricción",
      ],
    },
    {
      name: "Equipos técnicos y operativos del cliente final",
      description:
        "Quienes usarán o integrarán el resultado del proyecto y validan la decisión de compra.",
      needs: [
        "Detalle concreto de servicios y proceso de trabajo",
        "Casos y resultados comparables a su situación",
      ],
    },
  ];

  const differentiators = intake.scope.inScope
    .slice(0, 3)
    .map((item) => `Cobertura completa de: ${item.toLowerCase()}`);

  return {
    audiences,
    positioning: `${clientName} se posiciona como un socio fiable y especializado${
      industry ? ` en ${industry.toLowerCase()}` : ""
    }, con un objetivo claro: ${intake.objective.toLowerCase()}`,
    valueProposition: `Una presencia digital que convierte la experiencia de ${clientName} en confianza medible: mensajes claros, prueba de resultados y un camino de contacto evidente.`,
    differentiators:
      differentiators.length > 0
        ? differentiators
        : [`La especialización y trayectoria de ${clientName} como aval principal`],
    toneOfVoice: {
      attributes: ["profesional", "cercano", "directo"],
      notes: `Tono sobrio y concreto, alineado con la marca de ${clientName}: afirmaciones respaldadas por el alcance acordado, sin superlativos vacíos.`,
    },
  };
}

function mockSitemap(context: SkillContext): SpecSitemapPayload {
  const intake = requireIntake(context);
  const inScopeText = intake.scope.inScope.join(" ").toLowerCase();

  const pages: SitemapNode[] = [
    {
      title: "Inicio",
      slug: "home",
      description: "Propuesta de valor, prueba social y llamada a contacto.",
      children: [],
    },
    {
      title: "Servicios",
      slug: "servicios",
      description: "Detalle de la oferta dentro del alcance acordado.",
      children: [],
    },
    {
      title: "Sobre nosotros",
      slug: "nosotros",
      description: "Trayectoria, equipo y forma de trabajar.",
      children: [],
    },
  ];
  if (inScopeText.includes("proyecto") || inScopeText.includes("portfolio")) {
    pages.push({
      title: "Proyectos",
      slug: "proyectos",
      description: "Casos y resultados comparables.",
      children: [],
    });
  }
  if (inScopeText.includes("blog")) {
    pages.push({
      title: "Blog",
      slug: "blog",
      description: "Contenido editorial gestionado desde el CMS.",
      children: [],
    });
  }
  if (inScopeText.includes("carrera") || inScopeText.includes("vacante")) {
    pages.push({
      title: "Carreras",
      slug: "carreras",
      description: "Vacantes gestionadas desde el CMS.",
      children: [],
    });
  }
  pages.push({
    title: "Contacto",
    slug: "contacto",
    description: "Formulario de contacto y datos directos.",
    children: [],
  });

  const slugs = pages.map((page) => page.slug);
  return {
    pages,
    navigation: {
      header: slugs,
      footer: slugs.filter((slug) => slug !== "home"),
    },
  };
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export const generateSpecDraftSkill = defineSkill<GenerateSpecDraftParams>({
  name: "generate-spec-draft",
  version: "1.0",
  label: "Generar borrador de spec",
  description:
    "Propone la estrategia (o el sitemap, con la estrategia aprobada) a partir del intake aprobado.",
  reads: READS_STRATEGY,
  writes: { types: ["spec.strategy", "spec.sitemap"] },
  requiresApproval: true,
  paramsSchema: generateSpecDraftParamsSchema,
  validations: [
    schemaValid(),
    noEmptyFields(),
    lengthBounds([
      { path: /(^|\.)positioning$/, label: "Posicionamiento", max: 400 },
      { path: /(^|\.)valueProposition$/, label: "Propuesta de valor", max: 400 },
      { path: /(^|\.)title$/, label: "Título de página", max: 60 },
    ]),
    toneMatch(),
  ],
  modelPolicy: { preferred: "anthropic", fallbacks: ["openai", "mock"] },
  costBudget: { maxTokens: 8000 },
  availableIn: ["cockpit", "spec-os"],
  relevantFor: (artifactType) =>
    artifactType === "spec.intake" ||
    artifactType === "spec.strategy" ||
    artifactType === "spec.sitemap",
  resolveTarget: (params) => ({
    type: params.target === "sitemap" ? "spec.sitemap" : "spec.strategy",
    key: null,
  }),
  resolveReads: (params) => (params.target === "sitemap" ? READS_SITEMAP : READS_STRATEGY),

  buildPrompt: (context, params) => {
    if (params.target === "sitemap") {
      return {
        system: buildSystemPrompt(
          "proponer el SITEMAP del proyecto (arquitectura de información) a partir del intake y la estrategia aprobados.",
          [
            "Slugs en minúsculas con guiones (`sobre-nosotros`); la página de inicio usa el slug `home`.",
            "Sitemap acotado al alcance del intake: ni páginas fuera de alcance ni páginas vacías de propósito. Entre 4 y 9 páginas para un sitio corporativo típico.",
            "Anidación máxima de un nivel y solo si aporta jerarquía real.",
            "`navigation.header` y `navigation.footer` solo referencian slugs existentes del árbol.",
            "Cada página lleva una `description` de una frase: su propósito, no su contenido.",
          ],
        ),
        user: [
          projectHeader(context),
          "",
          contextSection(context, "Intake aprobado", "spec.intake"),
          "",
          contextSection(context, "Estrategia aprobada", "spec.strategy"),
          "",
          contextSection(context, "Sitemap actual (si existe, revísalo en vez de partir de cero)", "spec.sitemap"),
          "",
          "Propón el sitemap completo del sitio conforme al schema.",
        ].join("\n"),
        schemaName: "spec_sitemap_payload",
        schema: zodToProviderSchema(specSitemapPayloadSchema),
      };
    }
    return {
      system: buildSystemPrompt(
        "proponer la ESTRATEGIA del proyecto (audiencias, posicionamiento, propuesta de valor, diferenciadores y tono) a partir del intake aprobado.",
        [
          "Entre 2 y 4 audiencias accionables: quién es, qué necesita; nada de demografía decorativa.",
          "Posicionamiento y propuesta de valor: una o dos frases cada uno, concretas y defendibles solo con lo que dice el intake.",
          "Diferenciadores derivados del alcance y los criterios de éxito reales, no genéricos.",
          "El tono de voz son 2-4 adjetivos útiles para quien escriba el copy después.",
        ],
      ),
      user: [
        projectHeader(context),
        "",
        contextSection(context, "Intake aprobado", "spec.intake"),
        "",
        contextSection(context, "Estrategia actual (si existe, revísala en vez de partir de cero)", "spec.strategy"),
        "",
        "Propón la estrategia completa conforme al schema.",
      ].join("\n"),
      schemaName: "spec_strategy_payload",
      schema: zodToProviderSchema(specStrategyPayloadSchema),
    };
  },

  parseProposal: (json, params) =>
    params.target === "sitemap"
      ? parseProposalWith(specSitemapPayloadSchema, json)
      : parseProposalWith(specStrategyPayloadSchema, json),

  buildMockProposal: (context, params) =>
    params.target === "sitemap" ? mockSitemap(context) : mockStrategy(context),
});
