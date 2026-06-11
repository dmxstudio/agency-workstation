import { z } from "zod";

import {
  contentPagePayloadSchema,
  flattenSitemap,
  slugSchema,
  type ContentPagePayload,
  type PageContent,
  type SpecIntakePayload,
  type SpecSitemapPayload,
  type SpecStrategyPayload,
} from "@/modules/artifacts/types";

import { zodToProviderSchema } from "./json-schema";
import { buildSystemPrompt, contextSection, projectHeader } from "./prompt-shared";
import { parseProposalWith } from "./proposal";
import { defineSkill, readPayload, type SkillContext } from "./types";
import { lengthBounds, noEmptyFields, schemaValid, toneMatch } from "./validations";

/**
 * Skill 3 (§9.3): `write-page-copy` — copies por página dentro del content
 * system (`content.page`): mensajes clave, secciones y SEO, alineados con la
 * estrategia aprobada. `pageScope` limita qué páginas se (re)escriben; las
 * demás se conservan tal cual están en el artefacto actual.
 */

export const writePageCopyParamsSchema = z.object({
  /** Slugs del sitemap a (re)escribir; sin él, todas las páginas. */
  pageScope: z.array(slugSchema).min(1).optional(),
});

export type WritePageCopyParams = z.infer<typeof writePageCopyParamsSchema>;

// ---------------------------------------------------------------------------
// Mock determinista
// ---------------------------------------------------------------------------

/** Corte determinista en límite de palabra (sin "…" a mitad de palabra). */
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max).replace(/[,;:.\s]+$/, "")}.`;
}

function mockCopy(context: SkillContext, params: WritePageCopyParams): ContentPagePayload {
  const intake = readPayload<SpecIntakePayload>(context, "spec.intake");
  const strategy = readPayload<SpecStrategyPayload>(context, "spec.strategy");
  const sitemap = readPayload<SpecSitemapPayload>(context, "spec.sitemap");
  if (!strategy || !sitemap) {
    throw new Error("write-page-copy requiere estrategia y sitemap aprobados en el contexto.");
  }
  const current = readPayload<ContentPagePayload>(context, "content.page");
  const clientName = intake?.client.name ?? context.projectName;

  const flatPages = flattenSitemap(sitemap.pages);
  const scope = params.pageScope ? new Set(params.pageScope) : null;
  const currentBySlug = new Map((current?.pages ?? []).map((page) => [page.slug, page]));

  const pages: PageContent[] = flatPages.map((page) => {
    const existing = currentBySlug.get(page.slug);
    if (scope && !scope.has(page.slug) && existing) return existing;

    const isHome = page.path === "/";
    const isContact = page.slug === "contacto";
    const heading = isHome
      ? truncateAtWord(strategy.valueProposition, 90)
      : `${page.title} de ${clientName}`;
    const body = isHome
      ? `${strategy.positioning} ${strategy.differentiators[0] ?? ""}`.trim()
      : `${page.title}: ${strategy.valueProposition}`;

    return {
      slug: page.slug,
      title: page.title,
      sections: [
        {
          id: "intro",
          heading,
          body,
          ...(isHome || isContact
            ? { cta: { label: isContact ? "Enviar consulta" : "Solicitar propuesta", href: "/contacto" } }
            : {}),
        },
        {
          id: "detalle",
          heading: isHome ? "Por qué elegirnos" : `Qué encontrarás en ${page.title.toLowerCase()}`,
          body:
            strategy.differentiators.length > 0
              ? strategy.differentiators.join(". ")
              : strategy.valueProposition,
        },
      ],
      seo: {
        title: truncateAtWord(`${page.title} — ${clientName}`, 70),
        description: truncateAtWord(strategy.valueProposition, 160),
        keywords: [],
      },
    };
  });

  return {
    keyMessages:
      strategy.differentiators.length > 0
        ? strategy.differentiators.slice(0, 3)
        : [truncateAtWord(strategy.valueProposition, 120)],
    pages,
  };
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export const writePageCopySkill = defineSkill<WritePageCopyParams>({
  name: "write-page-copy",
  version: "1.0",
  label: "Escribir copy de páginas",
  description:
    "Propone mensajes clave, copy por página y SEO básico alineados con la estrategia aprobada.",
  reads: [
    { type: "spec.intake", mode: "approved", required: false },
    { type: "spec.strategy", mode: "approved", required: true },
    { type: "spec.sitemap", mode: "approved", required: true },
    { type: "content.page", mode: "current", required: false },
  ],
  writes: { types: ["content.page"] },
  requiresApproval: true,
  paramsSchema: writePageCopyParamsSchema,
  validations: [
    schemaValid(),
    noEmptyFields(),
    lengthBounds([
      { path: /seo\.title$/, label: "Título SEO", max: 70 },
      { path: /seo\.description$/, label: "Descripción SEO", max: 170, min: 60 },
      { path: /sections\[\d+\]\.heading$/, label: "Encabezado de sección", max: 110 },
    ]),
    toneMatch(),
  ],
  modelPolicy: { preferred: "anthropic", fallbacks: ["openai", "mock"] },
  costBudget: { maxTokens: 8000 },
  availableIn: ["cockpit", "spec-os"],
  relevantFor: (artifactType) =>
    artifactType === "content.page" || artifactType === "spec.strategy",
  resolveTarget: () => ({ type: "content.page", key: null }),

  buildPrompt: (context, params) => ({
    system: buildSystemPrompt(
      "escribir el COPY del sitio: mensajes clave, secciones por página y SEO, dentro del content system.",
      [
        "El tono lo manda la estrategia aprobada (`toneOfVoice`): aplícalo, no lo cites.",
        "Cada página del sitemap tiene su entrada en `pages` (slug exacto del sitemap); 2-4 secciones por página con `id` estable en kebab-case o camelCase (`intro`, `detalle`, `prueba-social`).",
        "SEO: `title` ≤ 60 caracteres, `description` entre 80 y 160; concretos, sin keyword stuffing.",
        "CTAs solo donde aporten (inicio, contacto, servicios) y siempre hacia rutas internas existentes.",
        params.pageScope
          ? `SOLO reescribe las páginas con slug: ${params.pageScope.join(", ")}. Copia el resto tal cual están en el contenido actual.`
          : "Escribe todas las páginas del sitemap.",
      ],
    ),
    user: [
      projectHeader(context),
      "",
      contextSection(context, "Estrategia aprobada", "spec.strategy"),
      "",
      contextSection(context, "Sitemap aprobado", "spec.sitemap"),
      "",
      contextSection(context, "Contenido actual (consérvalo donde no toque reescribir)", "content.page"),
      "",
      "Propón el content system completo conforme al schema.",
    ].join("\n"),
    schemaName: "content_page_payload",
    schema: zodToProviderSchema(contentPagePayloadSchema),
  }),

  parseProposal: (json) => parseProposalWith(contentPagePayloadSchema, json),

  buildMockProposal: (context, params) => mockCopy(context, params),
});
