import type { z } from "zod";

import { validateCompositionBindings } from "@/modules/artifacts/bindings";
import {
  getArtifactTypeOrNull,
  pageCompositionPayloadSchema,
  type CmsCollectionsPayload,
  type SpecIntakePayload,
  type SpecStrategyPayload,
} from "@/modules/artifacts/types";

import { isRegistryComponent } from "./registry-catalog";
import {
  readPayload,
  type SkillValidation,
  type SkillValidationIssue,
} from "./types";

/**
 * Validaciones de skill — funciones PURAS por tipo de artefacto (§16).
 * Marcan, nunca resuelven; el humano decide con el resultado a la vista (§13
 * paso 3). Severidades: `error` bloquea el "validaciones en verde" del run;
 * `warning` informa sin bloquear.
 */

// ---------------------------------------------------------------------------
// Helpers de recorrido
// ---------------------------------------------------------------------------

interface StringLeaf {
  path: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Todas las hojas string del payload con su ruta (`pages[0].seo.title`). */
function collectStringLeaves(value: unknown, path = "", out: StringLeaf[] = []): StringLeaf[] {
  if (typeof value === "string") {
    out.push({ path, value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringLeaves(item, `${path}[${index}]`, out));
    return out;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectStringLeaves(child, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

/** Normaliza para comparación honesta: minúsculas y sin diacríticos. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ---------------------------------------------------------------------------
// schema-valid
// ---------------------------------------------------------------------------

/**
 * `schema-valid`: la propuesta valida contra el Zod del tipo del TARGET
 * (`context.target.type`). Es la misma validación que artifacts ejecuta en
 * cada escritura — aquí se adelanta para que el run la reporte.
 */
export function schemaValid(): SkillValidation {
  return {
    name: "schema-valid",
    label: "Schema del tipo de artefacto",
    run: (proposal, context) => {
      const targetType = context.target?.type;
      const definition = targetType ? getArtifactTypeOrNull(targetType) : null;
      if (!definition) {
        return [
          {
            validation: "schema-valid",
            path: "",
            message: `No se pudo resolver el tipo del artefacto target (${targetType ?? "desconocido"}).`,
            severity: "error",
          },
        ];
      }
      const result = (definition.payloadSchema as z.ZodType).safeParse(proposal);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        validation: "schema-valid",
        path: issue.path.map(String).join("."),
        message: issue.message,
        severity: "error" as const,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// no-empty-fields
// ---------------------------------------------------------------------------

export interface NoEmptyFieldsOptions {
  /** Rutas donde un string vacío es legítimo (p.ej. `/eyebrow$/`). */
  ignorePaths?: readonly RegExp[];
  /** `warning` para targets arbitrarios (revise-artifact). Default: `error`. */
  severity?: "error" | "warning";
}

/** `no-empty-fields`: ningún campo de texto se queda vacío o en blanco. */
export function noEmptyFields(options: NoEmptyFieldsOptions = {}): SkillValidation {
  const ignore = options.ignorePaths ?? [];
  const severity = options.severity ?? "error";
  return {
    name: "no-empty-fields",
    label: "Sin campos vacíos",
    run: (proposal) =>
      collectStringLeaves(proposal)
        .filter(
          (leaf) =>
            leaf.value.trim().length === 0 &&
            !ignore.some((pattern) => pattern.test(leaf.path)),
        )
        .map((leaf) => ({
          validation: "no-empty-fields",
          path: leaf.path,
          message: "Campo de texto vacío en la propuesta.",
          severity,
        })),
  };
}

// ---------------------------------------------------------------------------
// length-bounds
// ---------------------------------------------------------------------------

export interface LengthBound {
  /** Rutas a las que aplica el límite, p.ej. `/seo\.description$/`. */
  path: RegExp;
  label: string;
  min?: number;
  max?: number;
}

/**
 * `length-bounds`: límites de longitud por campo (SEO, titulares…).
 * Severidad `warning`: una descripción larga no invalida la propuesta, pero
 * el revisor debe verla.
 */
export function lengthBounds(bounds: readonly LengthBound[]): SkillValidation {
  return {
    name: "length-bounds",
    label: "Longitudes dentro de límites",
    run: (proposal) => {
      const issues: SkillValidationIssue[] = [];
      for (const leaf of collectStringLeaves(proposal)) {
        for (const bound of bounds) {
          if (!bound.path.test(leaf.path)) continue;
          const length = leaf.value.trim().length;
          if (bound.max != null && length > bound.max) {
            issues.push({
              validation: "length-bounds",
              path: leaf.path,
              message: `${bound.label}: ${length} caracteres (máximo recomendado ${bound.max}).`,
              severity: "warning",
            });
          }
          if (bound.min != null && length > 0 && length < bound.min) {
            issues.push({
              validation: "length-bounds",
              path: leaf.path,
              message: `${bound.label}: ${length} caracteres (mínimo recomendado ${bound.min}).`,
              severity: "warning",
            });
          }
        }
      }
      return issues;
    },
  };
}

// ---------------------------------------------------------------------------
// tone-match
// ---------------------------------------------------------------------------

/** Stopwords frecuentes del español (heurística de idioma). */
const SPANISH_MARKERS = [
  " de ",
  " la ",
  " el ",
  " que ",
  " los ",
  " las ",
  " con ",
  " para ",
  " una ",
  " del ",
];

/**
 * `tone-match` — heurística HONESTA y deliberadamente modesta (no juzga
 * calidad): (a) el texto menciona al cliente o algún término del tono/marca
 * aprobados (intake + strategy del contexto); (b) el texto largo parece estar
 * en español. Ambas como `warning`: señales para el revisor, no veredictos.
 */
export function toneMatch(): SkillValidation {
  return {
    name: "tone-match",
    label: "Tono y marca (heurístico)",
    run: (proposal, context) => {
      const intake = readPayload<SpecIntakePayload>(context, "spec.intake");
      const strategy = readPayload<SpecStrategyPayload>(context, "spec.strategy");

      const referenceTerms = new Set<string>();
      if (intake?.client.name) {
        for (const word of intake.client.name.split(/\s+/)) {
          if (word.length > 3) referenceTerms.add(normalize(word));
        }
      }
      for (const attribute of strategy?.toneOfVoice.attributes ?? []) {
        referenceTerms.add(normalize(attribute));
      }

      const text = collectStringLeaves(proposal)
        .map((leaf) => leaf.value)
        .join(" \n ");
      const normalized = ` ${normalize(text)} `;
      const issues: SkillValidationIssue[] = [];

      if (referenceTerms.size > 0) {
        const mentions = [...referenceTerms].some((term) => normalized.includes(term));
        if (!mentions) {
          issues.push({
            validation: "tone-match",
            path: "",
            message:
              "La propuesta no menciona al cliente ni ningún atributo del tono aprobado — revisar alineación de marca manualmente.",
            severity: "warning",
          });
        }
      }

      const wordCount = normalized.split(/\s+/).filter(Boolean).length;
      if (wordCount > 30 && !SPANISH_MARKERS.some((marker) => normalized.includes(marker))) {
        issues.push({
          validation: "tone-match",
          path: "",
          message: "El texto no parece estar en español (idioma del proyecto).",
          severity: "warning",
        });
      }

      return issues;
    },
  };
}

// ---------------------------------------------------------------------------
// components-exist (compose)
// ---------------------------------------------------------------------------

interface BlockLike {
  type: string;
  props: Record<string, unknown> & { id: string };
}

function isBlockLike(value: unknown): value is BlockLike {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    isRecord(value.props) &&
    typeof value.props.id === "string"
  );
}

/** Bloques de un Data de Puck, incluidos los anidados en slots/zones. */
function collectBlocks(value: unknown, path = "", out: { path: string; block: BlockLike }[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (isBlockLike(item)) {
        out.push({ path: `${path}[${index}]`, block: item });
        collectBlocks(item.props, `${path}[${index}].props`, out);
        return;
      }
      collectBlocks(item, `${path}[${index}]`, out);
    });
    return out;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectBlocks(child, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

/**
 * `components-exist`: todos los bloques (incluidos slots anidados) usan
 * nombres EXACTOS del component registry del Studio/template.
 */
export function componentsExist(): SkillValidation {
  return {
    name: "components-exist",
    label: "Componentes del registry",
    run: (proposal) => {
      const parsed = pageCompositionPayloadSchema.safeParse(proposal);
      if (!parsed.success) return []; // schema-valid ya reporta la forma
      const issues: SkillValidationIssue[] = [];
      const blocks = [
        ...collectBlocks(parsed.data.content, "content"),
        ...collectBlocks(parsed.data.zones ?? {}, "zones"),
      ];
      for (const { path, block } of blocks) {
        if (!isRegistryComponent(block.type)) {
          issues.push({
            validation: "components-exist",
            path,
            message: `El componente \`${block.type}\` no existe en el registry del Studio.`,
            severity: "error",
          });
        }
      }
      return issues;
    },
  };
}

// ---------------------------------------------------------------------------
// bindings-valid (compose) — reusa validateCompositionBindings de artifacts
// ---------------------------------------------------------------------------

/**
 * `bindings-valid`: los bindings CMS de la composición apuntan a colecciones
 * y campos existentes del `cms.collections` aprobado del contexto. Si el
 * proyecto aún no tiene colecciones aprobadas, no hay nada que validar.
 */
export function bindingsValid(): SkillValidation {
  return {
    name: "bindings-valid",
    label: "Bindings CMS válidos",
    run: (proposal, context) => {
      const parsed = pageCompositionPayloadSchema.safeParse(proposal);
      if (!parsed.success) return []; // schema-valid ya reporta la forma
      const collections = readPayload<CmsCollectionsPayload>(context, "cms.collections");
      if (!collections) return [];
      const page = context.target?.key ?? "(página)";
      return validateCompositionBindings(parsed.data, collections, page).map((conflict) => ({
        validation: "bindings-valid",
        path: `${conflict.sectionId}.${conflict.prop}`,
        message: conflict.message,
        severity: "error" as const,
      }));
    },
  };
}
