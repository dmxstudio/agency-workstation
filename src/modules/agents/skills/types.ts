import type { z } from "zod";

import type { LlmProviderKind } from "@/db/schema";
import type { ArtifactTypeKey } from "@/modules/artifacts/types";

/**
 * Contrato operativo de skill (§9.1) — la unidad real del Agent Runtime.
 *
 * Reglas de diseño, por construcción:
 * - Una skill DECLARA qué lee y qué escribe; el runner materializa las
 *   lecturas (Project Context API) y persiste la escritura SOLO como
 *   propuesta (`saveProposalDraft` de artifacts → draft + diff, §8.6).
 * - `requiresApproval` es literalmente `true` en el tipo: no existe una skill
 *   sin aprobación humana. Ningún camino de este módulo aprueba artefactos
 *   (§19 / §13) — las decisiones viven en `src/modules/artifacts`.
 * - Los prompts están versionados EN EL REPO (campo `version` + archivo de la
 *   skill): un agent run referencia `name@version` exactos (§9.1, §9.6).
 * - `buildMockProposal` hace del proveedor `mock` un proveedor de primera
 *   clase: determinista (sin reloj ni aleatoriedad), produce payloads VÁLIDOS
 *   en español a partir del contexto real.
 *
 * Límite de módulos: agents → artifacts está permitido SOLO para tipos Zod,
 * bindings y errores (igual que spec-os → artifacts). Importar `approve`,
 * `reject` o las server actions de artifacts desde este módulo está prohibido
 * y el smoke (`scripts/smoke-skills.ts`) lo impone con un assert estático.
 */

// ---------------------------------------------------------------------------
// Identidades básicas
// ---------------------------------------------------------------------------

/**
 * Proveedores LLM soportados (§16, BYOK §7.9). `mock` es de primera clase.
 * Mismo universo que el enum `llm_provider` del schema (`LlmProviderKind`).
 */
export type LlmProviderId = LlmProviderKind;

/** Superficies donde el asistente contextual único (§9.2) ofrece la skill. */
export type SkillSurface = "cockpit" | "spec-os" | "studio";

/** Las 5 skills del MVP (§9.3) — lista CERRADA, ni una más. */
export const SKILL_NAMES = [
  "generate-spec-draft",
  "generate-cms-schema",
  "write-page-copy",
  "compose-page-draft",
  "revise-artifact",
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

// ---------------------------------------------------------------------------
// Lecturas / escritura declaradas
// ---------------------------------------------------------------------------

/**
 * Lectura declarada de la skill. Para tipos multi-instancia (`page.composition`)
 * la key concreta sale de los params (`keyFrom` = nombre del param).
 */
export interface SkillRead {
  type: ArtifactTypeKey;
  /** Param del que sale la instance key (tipos multi-instancia). */
  keyFrom?: string;
  /**
   * `approved`: payload de la última versión SELLADA (la skill solo confía en
   * conocimiento aprobado). `current`: draft si existe, si no la sellada —
   * para el artefacto que la skill va a reescribir.
   */
  mode: "approved" | "current";
  /** Si `true`, el run falla cuando el artefacto no tiene contenido legible. */
  required: boolean;
}

/** Escritura declarada: tipos posibles del target (documentación/UI). */
export interface SkillWrite {
  /** Tipos de artefacto que esta skill puede escribir. */
  types: readonly ArtifactTypeKey[];
  /** Param del que sale la instance key del target (multi-instancia). */
  keyFrom?: string;
}

/** Target concreto de una invocación (resuelto desde los params). */
export interface SkillTarget {
  type: ArtifactTypeKey;
  /** Instance key (`artifacts.key`) para tipos multi-instancia; null si singleton. */
  key: string | null;
}

// ---------------------------------------------------------------------------
// Contexto (lo materializa el runner vía Project Context API §9.4)
// ---------------------------------------------------------------------------

/** Snapshot de un artefacto leído para el run (queda auditado: id + versión). */
export interface SkillContextArtifact {
  artifactId: string;
  type: string;
  key: string | null;
  label: string;
  status: string;
  /** Versión sellada leída (0 = sin versión sellada; payload puede ser draft). */
  version: number;
  payload: unknown;
}

/**
 * Contexto de ejecución de una skill. `reads` está keyed por
 * {@link contextKey} (`type` o `type:key`); un valor `null` significa
 * "declarado pero sin contenido" (solo válido para lecturas no requeridas).
 */
export interface SkillContext {
  projectId: string;
  projectName: string;
  reads: Record<string, SkillContextArtifact | null>;
  /** El artefacto target de la escritura (su fila existe siempre; puede estar `empty`). */
  target: SkillContextArtifact | null;
}

/** Key canónica de una lectura en `SkillContext.reads`. */
export function contextKey(type: string, key?: string | null): string {
  return key ? `${type}:${key}` : type;
}

/** Lectura tipada del contexto; `null` si no está o no tiene payload. */
export function readPayload<T>(
  context: SkillContext,
  type: string,
  key?: string | null,
): T | null {
  const entry = context.reads[contextKey(type, key)];
  if (!entry || entry.payload == null) return null;
  return entry.payload as T;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * Prompt listo para `LlmProvider.complete({ system, user, schema, maxTokens })`.
 * `schema` es JSON Schema del payload target derivado del Zod del tipo:
 * `additionalProperties: false` en todos los objetos cerrados y SIN
 * minLength/maxLength/minimum/maximum/pattern (no soportados por los
 * structured outputs de los proveedores) — ver `json-schema.ts`.
 */
export interface SkillPrompt {
  system: string;
  user: string;
  /** Nombre del schema (lo usa el `json_schema.name` de OpenAI). */
  schemaName: string;
  schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validaciones (funciones puras, §16)
// ---------------------------------------------------------------------------

export type SkillIssueSeverity = "error" | "warning";

export interface SkillValidationIssue {
  /** Nombre de la validación que emitió el issue (p.ej. `no-empty-fields`). */
  validation: string;
  /** Ruta dentro del payload propuesto, p.ej. `pages[0].seo.description`. */
  path: string;
  message: string;
  severity: SkillIssueSeverity;
}

export interface SkillValidationResult {
  validation: string;
  label: string;
  ok: boolean;
  issues: SkillValidationIssue[];
}

/**
 * Una validación de skill: función PURA sobre (propuesta, contexto, params).
 * Nunca toca DB ni red; nunca modifica la propuesta (marca, no resuelve).
 */
export interface SkillValidation {
  name: string;
  /** Etiqueta humana en español (UI del agent run log). */
  label: string;
  run: (
    proposal: unknown,
    context: SkillContext,
    params: Record<string, unknown>,
  ) => SkillValidationIssue[];
}

/** Ejecuta todas las validaciones de la skill y agrega resultados. */
export function runSkillValidations(
  validations: readonly SkillValidation[],
  proposal: unknown,
  context: SkillContext,
  params: Record<string, unknown>,
): SkillValidationResult[] {
  return validations.map((validation) => {
    let issues: SkillValidationIssue[];
    try {
      issues = validation.run(proposal, context, params);
    } catch (error) {
      issues = [
        {
          validation: validation.name,
          path: "",
          message: `La validación falló al ejecutarse: ${
            error instanceof Error ? error.message : String(error)
          }`,
          severity: "error",
        },
      ];
    }
    return {
      validation: validation.name,
      label: validation.label,
      ok: issues.every((issue) => issue.severity !== "error"),
      issues,
    };
  });
}

/** `true` si ningún resultado tiene issues de severidad `error`. */
export function validationsPass(results: readonly SkillValidationResult[]): boolean {
  return results.every((result) => result.ok);
}

// ---------------------------------------------------------------------------
// Definición de skill
// ---------------------------------------------------------------------------

export interface SkillModelPolicy {
  preferred: LlmProviderId;
  fallbacks: readonly LlmProviderId[];
}

export interface SkillCostBudget {
  /** Límite de output tokens por run (§9.1 costBudget). */
  maxTokens: number;
}

/**
 * Definición completa de una skill (§9.1 + ajustes §9.1 de la spec:
 * `version`, `modelPolicy`, `costBudget`).
 */
export interface AgentSkill<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  name: SkillName;
  /** Versión de la skill+prompts (los runs referencian `name@version`). */
  version: string;
  /** Etiqueta humana, español. */
  label: string;
  /** Descripción corta para el asistente contextual, español. */
  description: string;
  /** Lecturas declaradas (las efectivas pueden depender de params: `resolveReads`). */
  reads: readonly SkillRead[];
  writes: SkillWrite;
  /** SIEMPRE true: no existe skill sin aprobación humana (§8.6, §13). */
  requiresApproval: true;
  /** Params de la invocación, validados con Zod ANTES de encolar el run. */
  paramsSchema: z.ZodType<TParams>;
  validations: readonly SkillValidation[];
  modelPolicy: SkillModelPolicy;
  costBudget: SkillCostBudget;
  /** Superficies donde el asistente contextual la ofrece (§9.2). */
  availableIn: readonly SkillSurface[];
  /** ¿Es relevante con este tipo de artefacto en pantalla? (asistente contextual). */
  relevantFor: (artifactType: string) => boolean;
  /** Target concreto del write para unos params dados. */
  resolveTarget: (params: TParams) => SkillTarget;
  /**
   * Lecturas efectivas para unos params dados (p.ej. `revise-artifact` lee el
   * target + sus dependencias §8.4). Si falta, valen las declaradas en `reads`.
   */
  resolveReads?: (params: TParams) => SkillRead[];
  /** Construye el prompt versionado (system/user/schema) desde el contexto. */
  buildPrompt: (context: SkillContext, params: TParams) => SkillPrompt;
  /**
   * Valida el JSON del proveedor con el Zod del tipo target y devuelve el
   * payload tipado. Lanza `ArtifactValidationError` si no valida.
   */
  parseProposal: (json: unknown, params: TParams) => unknown;
  /**
   * Propuesta del proveedor `mock`: determinista, válida, en español,
   * derivada del contexto. Sin timestamps de reloj ni aleatoriedad.
   */
  buildMockProposal: (context: SkillContext, params: TParams) => unknown;
}

/** Identity helper que preserva el tipo concreto de params. */
export function defineSkill<TParams extends Record<string, unknown>>(
  definition: AgentSkill<TParams>,
): AgentSkill<TParams> {
  return definition;
}

/** Lecturas efectivas de una invocación (resolveReads ?? reads). */
export function effectiveReads<TParams extends Record<string, unknown>>(
  skill: AgentSkill<TParams>,
  params: TParams,
): SkillRead[] {
  return skill.resolveReads ? skill.resolveReads(params) : [...skill.reads];
}
