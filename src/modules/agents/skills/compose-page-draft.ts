import { z } from "zod";

import {
  flattenSitemap,
  pageCompositionPayloadSchema,
  type CompositionBlock,
  type ContentPagePayload,
  type PageCompositionPayload,
  type SpecIntakePayload,
  type SpecSitemapPayload,
  type SpecStrategyPayload,
} from "@/modules/artifacts/types";

import { buildSystemPrompt, contextSection, projectHeader } from "./prompt-shared";
import { parseProposalWith } from "./proposal";
import { buildCompositionJsonSchema, COMPOSABLE_COMPONENT_NAMES } from "./registry-catalog";
import { defineSkill, readPayload, type SkillContext } from "./types";
import {
  bindingsValid,
  componentsExist,
  lengthBounds,
  noEmptyFields,
  schemaValid,
} from "./validations";

/**
 * Skill 4 (§9.3): `compose-page-draft` — composición inicial de UNA página
 * (`page.composition`, keyed por `pageKey`) con componentes del registry del
 * Studio. El payload es Data de Puck VÁLIDO: renderiza tal cual en el canvas
 * del Studio y en el sitio generado (compatibilidad de render sagrada).
 */

export const composePageDraftParamsSchema = z.object({
  /** Key de la instancia `page.composition` (page path: `home`, `legal/terms`). */
  pageKey: z.string().min(1, "pageKey es obligatorio."),
});

export type ComposePageDraftParams = z.infer<typeof composePageDraftParamsSchema>;

// ---------------------------------------------------------------------------
// Mock determinista
// ---------------------------------------------------------------------------

/** Corte determinista en límite de palabra. */
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return cut.slice(0, lastSpace > 0 ? lastSpace : max).replace(/[,;:.\s]+$/, "");
}

/** Ids de bloque deterministas: `<Componente>-<pageKey>-<posición>`. */
function blockId(type: string, pageKey: string, position: number): string {
  return `${type}-${pageKey.replace(/\//g, "-")}-${position}`;
}

function mockComposition(
  context: SkillContext,
  params: ComposePageDraftParams,
): PageCompositionPayload {
  const sitemap = readPayload<SpecSitemapPayload>(context, "spec.sitemap");
  if (!sitemap) {
    throw new Error("compose-page-draft requiere el sitemap aprobado en el contexto.");
  }
  const page = flattenSitemap(sitemap.pages).find((flat) => flat.pagePath === params.pageKey);
  if (!page) {
    throw new Error(
      `La página \`${params.pageKey}\` no existe en el sitemap aprobado del proyecto.`,
    );
  }

  const intake = readPayload<SpecIntakePayload>(context, "spec.intake");
  const strategy = readPayload<SpecStrategyPayload>(context, "spec.strategy");
  const content = readPayload<ContentPagePayload>(context, "content.page");
  const clientName = intake?.client.name ?? context.projectName;
  const pageCopy = content?.pages.find((entry) => entry.slug === page.slug);
  const intro = pageCopy?.sections[0];
  const detail = pageCopy?.sections[1];

  const valueProposition =
    strategy?.valueProposition ?? `La propuesta de valor de ${clientName}.`;
  const positioning = strategy?.positioning ?? `${clientName} presenta su nueva web.`;
  const differentiators = strategy?.differentiators ?? [];

  const isHome = page.path === "/";
  const isContact = page.slug === "contacto";
  const blocks: CompositionBlock[] = [];
  let position = 0;
  const nextId = (type: string) => blockId(type, params.pageKey, (position += 1));

  if (isHome) {
    blocks.push({
      type: "Hero",
      props: {
        id: nextId("Hero"),
        eyebrow: intake?.client.industry ?? clientName,
        title: intro?.heading ?? truncateAtWord(valueProposition, 90),
        subtitle: intro?.body ?? positioning,
        align: "center",
        tone: "dark",
        padding: "spacious",
        size: "large",
        primaryCta: intro?.cta?.label ?? "Solicitar propuesta",
        primaryCtaHref: intro?.cta?.href ?? "/contacto",
        secondaryCta: "Conocer los servicios",
        secondaryCtaStyle: "ghost",
      },
    });
    const items = (differentiators.length > 0 ? differentiators : [valueProposition])
      .slice(0, 3)
      .map((text) => ({
        icon: "✔",
        title: truncateAtWord(text, 48),
        body: text,
      }));
    blocks.push({
      type: "Features",
      props: {
        id: nextId("Features"),
        eyebrow: "Diferenciales",
        title: detail?.heading ?? "Por qué elegirnos",
        subtitle: detail?.body ?? truncateAtWord(valueProposition, 140),
        columns: "3",
        tone: "light",
        padding: "normal",
        items,
      },
    });
    blocks.push({
      type: "Cta",
      props: {
        id: nextId("Cta"),
        title: "¿Hablamos de tu proyecto?",
        subtitle: truncateAtWord(intake?.objective ?? valueProposition, 140),
        cta: "Contactar",
        ctaHref: "/contacto",
        align: "center",
        tone: "brand",
        padding: "normal",
      },
    });
  } else {
    blocks.push({
      type: "HeroMinimal",
      props: {
        id: nextId("HeroMinimal"),
        title: intro?.heading ?? `${page.title} de ${clientName}`,
        tone: "dark",
        padding: "spacious",
      },
    });
    blocks.push({
      type: "Paragraph",
      props: {
        id: nextId("Paragraph"),
        text: intro?.body ?? `${page.title}: ${valueProposition}`,
        size: "l",
        align: "left",
      },
    });
    if (isContact) {
      blocks.push({
        type: "ContactForm",
        props: {
          id: nextId("ContactForm"),
          title: "Cuéntanos tu proyecto",
          subtitle: "Respondemos en uno o dos días laborables.",
          layout: "split",
          showPhone: true,
          tone: "subtle",
          padding: "normal",
        },
      });
    } else {
      blocks.push({
        type: "Cta",
        props: {
          id: nextId("Cta"),
          title: detail?.heading ?? "¿Hablamos de tu proyecto?",
          subtitle: truncateAtWord(detail?.body ?? valueProposition, 140),
          cta: "Contactar",
          ctaHref: "/contacto",
          align: "center",
          tone: "brand",
          padding: "normal",
        },
      });
    }
  }

  return {
    root: {
      props: {
        title: pageCopy?.seo.title ?? truncateAtWord(`${page.title} — ${clientName}`, 70),
        description: pageCopy?.seo.description ?? truncateAtWord(valueProposition, 160),
      },
    },
    content: blocks,
    zones: {},
  };
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export const composePageDraftSkill = defineSkill<ComposePageDraftParams>({
  name: "compose-page-draft",
  version: "1.0",
  label: "Componer borrador de página",
  description:
    "Propone la composición inicial de una página del sitemap con componentes del registry.",
  reads: [
    { type: "spec.intake", mode: "approved", required: false },
    { type: "spec.strategy", mode: "approved", required: false },
    { type: "spec.sitemap", mode: "approved", required: true },
    { type: "content.page", mode: "approved", required: false },
    { type: "cms.collections", mode: "approved", required: false },
    { type: "design.tokens", mode: "approved", required: false },
  ],
  writes: { types: ["page.composition"], keyFrom: "pageKey" },
  requiresApproval: true,
  paramsSchema: composePageDraftParamsSchema,
  validations: [
    schemaValid(),
    // Props visuales que legítimamente pueden quedar vacías en el registry.
    noEmptyFields({
      ignorePaths: [
        /eyebrow$/,
        /secondaryCta$/,
        /subtitle$/,
        /root\.props\.description$/,
      ],
    }),
    lengthBounds([
      { path: /root\.props\.title$/, label: "Título SEO", max: 70 },
      { path: /root\.props\.description$/, label: "Descripción SEO", max: 170 },
    ]),
    componentsExist(),
    bindingsValid(),
  ],
  modelPolicy: { preferred: "anthropic", fallbacks: ["openai", "mock"] },
  costBudget: { maxTokens: 8000 },
  availableIn: ["cockpit", "studio"],
  relevantFor: (artifactType) => artifactType === "page.composition",
  resolveTarget: (params) => ({ type: "page.composition", key: params.pageKey }),

  buildPrompt: (context, params) => ({
    system: buildSystemPrompt(
      "componer el BORRADOR INICIAL de una página como Data de Puck, usando EXCLUSIVAMENTE componentes del registry gobernado.",
      [
        `Componentes disponibles (nombres exactos): ${COMPOSABLE_COMPONENT_NAMES.join(", ")}. Ningún otro existe.`,
        "Entre 3 y 7 bloques: estructura editorial con jerarquía (un hero arriba, un cierre con CTA), no un collage.",
        "`props.id` único y estable por bloque, con el formato `<Componente>-<página>-<posición>` (p.ej. `Hero-home-1`).",
        "Usa el copy aprobado de la página cuando exista; no lo reescribas, compónlo.",
        "Los ajustes visuales son variantes enumeradas (tone, padding, align…): elige con criterio editorial sobrio.",
        "No inventes bindings CMS: vincular documentos reales es trabajo humano en el Studio.",
        "Enlaces internos solo a rutas del sitemap (p.ej. `/contacto`).",
      ],
    ),
    user: [
      projectHeader(context),
      `Página a componer: \`${params.pageKey}\``,
      "",
      contextSection(context, "Sitemap aprobado", "spec.sitemap"),
      "",
      contextSection(context, "Estrategia aprobada", "spec.strategy"),
      "",
      contextSection(context, "Copy aprobado del sitio", "content.page"),
      "",
      contextSection(context, "Colecciones CMS aprobadas (solo referencia)", "cms.collections"),
      "",
      contextSection(context, "Design tokens aprobados (solo referencia)", "design.tokens"),
      "",
      `Propón el Data de Puck completo de la página \`${params.pageKey}\` conforme al schema.`,
    ].join("\n"),
    schemaName: "page_composition_payload",
    schema: buildCompositionJsonSchema(),
  }),

  parseProposal: (json) => parseProposalWith(pageCompositionPayloadSchema, json),

  buildMockProposal: (context, params) => mockComposition(context, params),
});
