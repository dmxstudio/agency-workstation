import { z } from "zod";

import {
  ARTIFACT_TYPE_KEYS,
  getArtifactType,
  type CmsCollectionsPayload,
  type ContentPagePayload,
  type DesignTokensPayload,
  type PageCompositionPayload,
  type ReleasePayload,
  type SpecIntakePayload,
  type SpecSitemapPayload,
  type SpecStrategyPayload,
} from "@/modules/artifacts/types";

import { zodToProviderSchema } from "./json-schema";
import { buildSystemPrompt, formatContextArtifact, projectHeader } from "./prompt-shared";
import { parseProposalWith } from "./proposal";
import { buildCompositionJsonSchema } from "./registry-catalog";
import {
  contextKey,
  defineSkill,
  type SkillContext,
  type SkillRead,
} from "./types";
import {
  bindingsValid,
  componentsExist,
  lengthBounds,
  noEmptyFields,
  schemaValid,
} from "./validations";

/**
 * Skill 5 (§9.3): `revise-artifact` — iteración dirigida sobre CUALQUIER
 * artefacto con schema ("haz el tono más premium"), con diff. Lee el target
 * (draft o aprobado) más sus dependencias §8.4 y propone una nueva versión
 * del MISMO target.
 */

export const reviseArtifactParamsSchema = z
  .object({
    /** Instrucción humana de la revisión. Obligatoria. */
    instruction: z.string().min(1, "La instrucción de revisión es obligatoria."),
    targetType: z.enum(ARTIFACT_TYPE_KEYS),
    /** Instance key para tipos multi-instancia (`page.composition`). */
    targetKey: z.string().optional(),
  })
  .superRefine((params, ctx) => {
    if (params.targetType === "page.composition" && !params.targetKey) {
      ctx.addIssue({
        code: "custom",
        path: ["targetKey"],
        message: "Los artefactos multi-instancia requieren `targetKey` (path de la página).",
      });
    }
  });

export type ReviseArtifactParams = z.infer<typeof reviseArtifactParamsSchema>;

// ---------------------------------------------------------------------------
// Mock determinista: una revisión visible y válida por tipo
// ---------------------------------------------------------------------------

function revisionNote(instruction: string): string {
  return `Revisión aplicada: ${instruction}`;
}

function mockRevision(context: SkillContext, params: ReviseArtifactParams): unknown {
  const target = context.target;
  if (!target || target.payload == null) {
    throw new Error("revise-artifact requiere un artefacto con contenido (draft o aprobado).");
  }
  const payload = structuredClone(target.payload);
  const note = revisionNote(params.instruction);

  switch (params.targetType) {
    case "spec.intake": {
      const intake = payload as SpecIntakePayload;
      intake.brandInputs.notes = [intake.brandInputs.notes, note]
        .filter(Boolean)
        .join(" — ");
      return intake;
    }
    case "spec.strategy": {
      const strategy = payload as SpecStrategyPayload;
      strategy.toneOfVoice.notes = [strategy.toneOfVoice.notes, note]
        .filter(Boolean)
        .join(" — ");
      return strategy;
    }
    case "spec.sitemap": {
      const sitemap = payload as SpecSitemapPayload;
      if (sitemap.pages[0]) sitemap.pages[0].description = note;
      return sitemap;
    }
    case "content.page": {
      const content = payload as ContentPagePayload;
      content.keyMessages = [...content.keyMessages, note];
      return content;
    }
    case "cms.collections": {
      const collections = payload as CmsCollectionsPayload;
      if (collections.collections[0]) collections.collections[0].description = note;
      return collections;
    }
    case "design.tokens": {
      const tokens = payload as DesignTokensPayload;
      tokens.typography.scaleRatio = tokens.typography.scaleRatio === 1.25 ? 1.2 : 1.25;
      return tokens;
    }
    case "page.composition": {
      const composition = payload as PageCompositionPayload;
      composition.root.props.description = note;
      return composition;
    }
    case "release": {
      const release = payload as ReleasePayload;
      release.notes = [release.notes, note].filter(Boolean).join(" — ");
      return release;
    }
  }
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export const reviseArtifactSkill = defineSkill<ReviseArtifactParams>({
  name: "revise-artifact",
  version: "1.0",
  label: "Revisar artefacto con instrucción",
  description:
    "Itera sobre cualquier artefacto con una instrucción dirigida y propone la nueva versión con diff.",
  reads: [],
  writes: { types: [...ARTIFACT_TYPE_KEYS], keyFrom: "targetKey" },
  requiresApproval: true,
  paramsSchema: reviseArtifactParamsSchema,
  validations: [
    schemaValid(),
    // El target puede ser de cualquier tipo: los strings vacíos legítimos
    // (props visuales) no deben bloquear; se reportan como warning.
    noEmptyFields({ severity: "warning", ignorePaths: [/eyebrow$/, /secondaryCta$/] }),
    lengthBounds([
      { path: /seo\.title$|root\.props\.title$/, label: "Título SEO", max: 70 },
      { path: /seo\.description$|root\.props\.description$/, label: "Descripción SEO", max: 170 },
    ]),
    componentsExist(),
    bindingsValid(),
  ],
  modelPolicy: { preferred: "anthropic", fallbacks: ["openai", "mock"] },
  costBudget: { maxTokens: 8000 },
  availableIn: ["cockpit", "spec-os", "studio"],
  relevantFor: () => true,
  resolveTarget: (params) => ({
    type: params.targetType,
    key: params.targetKey ?? null,
  }),
  resolveReads: (params) => {
    const definition = getArtifactType(params.targetType);
    const reads: SkillRead[] = [
      {
        type: params.targetType,
        ...(params.targetKey ? { keyFrom: "targetKey" } : {}),
        mode: "current",
        required: true,
      },
    ];
    for (const upstream of definition.dependsOn) {
      reads.push({ type: upstream, mode: "approved", required: false });
    }
    return reads;
  },

  buildPrompt: (context, params) => {
    const definition = getArtifactType(params.targetType);
    const targetLabel = context.target?.label ?? definition.label;
    const dependencies = definition.dependsOn
      .map((upstream) =>
        formatContextArtifact(
          `Dependencia aprobada: ${getArtifactType(upstream).label}`,
          context.reads[contextKey(upstream)] ?? null,
        ),
      )
      .join("\n\n");

    return {
      system: buildSystemPrompt(
        `revisar el artefacto «${targetLabel}» (${definition.type}) aplicando UNA instrucción concreta y devolver el payload completo revisado.`,
        [
          "Aplica la instrucción y NADA más: conserva la estructura, los identificadores estables (ids de sección/bloque, slugs, nombres de campo) y todo lo que la instrucción no toque. El diff debe ser mínimo y legible.",
          "El resultado es el payload COMPLETO del artefacto (no un parche).",
          "Si la instrucción contradice las dependencias aprobadas, prioriza la instrucción pero limita el cambio a este artefacto.",
          params.targetType === "page.composition"
            ? "Es un Data de Puck: usa solo componentes del registry y mantén `props.id` de los bloques existentes."
            : "Respeta las validaciones del tipo (slugs, formatos, campos requeridos).",
        ],
      ),
      user: [
        projectHeader(context),
        `Instrucción de revisión: ${params.instruction}`,
        "",
        formatContextArtifact(
          `Artefacto a revisar: ${targetLabel}`,
          context.reads[contextKey(params.targetType, params.targetKey)] ?? context.target,
        ),
        "",
        dependencies,
        "",
        "Devuelve el payload revisado completo conforme al schema.",
      ].join("\n"),
      schemaName: `${params.targetType.replace(/\./g, "_")}_payload`,
      schema:
        params.targetType === "page.composition"
          ? buildCompositionJsonSchema()
          : zodToProviderSchema(definition.payloadSchema as z.ZodType),
    };
  },

  parseProposal: (json, params) =>
    parseProposalWith(getArtifactType(params.targetType).payloadSchema as z.ZodType, json),

  buildMockProposal: (context, params) => mockRevision(context, params),
});
