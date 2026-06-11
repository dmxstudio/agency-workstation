import type {
  AgentRunValidation,
  SkillContextRead,
  SkillDefinition as RuntimeSkillDefinition,
  SkillPromptInput,
} from "../types";
import {
  contextKey,
  effectiveReads,
  runSkillValidations,
  type AgentSkill,
  type SkillContext,
  type SkillContextArtifact,
  type SkillTarget,
  type SkillValidationResult,
} from "./types";

/**
 * Adaptador skill rica → contrato del runner (§9.1 ↔ runtime).
 *
 * Las skills de este directorio llevan el contrato COMPLETO ({@link AgentSkill}:
 * params Zod, modelPolicy, costBudget, availableIn/relevantFor, mocks…). El
 * runner (`runtime/runner.ts`) consume el contrato operativo mínimo
 * (`SkillDefinition` de `../types`) ya RESUELTO para una invocación concreta.
 * `bindSkillForRun` hace esa resolución: valida los params, fija el target y
 * las lecturas efectivas, y cierra los params dentro de la definición.
 *
 * Uso (asistente contextual / server actions del runtime):
 *
 *   const bound = bindSkillForRun(reviseArtifactSkill, rawParams);
 *   await startRun({
 *     projectId,
 *     skill: bound.definition,
 *     provider,
 *     targetType: bound.target.type,
 *     targetKey: bound.target.key,
 *     instruction: bound.instruction, // null salvo revise-artifact
 *   }, actor);
 */

export interface BoundSkill {
  /** Definición operativa para `startRun` (runtime/runner.ts). */
  definition: RuntimeSkillDefinition;
  /** Target resuelto: pasa como `targetType`/`targetKey` de `startRun`. */
  target: SkillTarget;
  /** Instrucción del usuario si los params la llevan (revise-artifact). */
  instruction: string | null;
  /** Params validados por el Zod de la skill. */
  params: Record<string, unknown>;
}

/** Convierte el `ProjectContext` del runtime al contexto que ven las skills. */
export function toSkillContext(input: SkillPromptInput): SkillContext {
  const reads: Record<string, SkillContextArtifact | null> = {};
  let target: SkillContextArtifact | null = null;

  for (const artifact of input.context.artifacts) {
    const entry: SkillContextArtifact = {
      artifactId: artifact.artifactId,
      type: artifact.type,
      key: artifact.key,
      label: artifact.type,
      status: artifact.source === "draft" ? "draft" : "approved",
      version: artifact.version,
      payload: artifact.payload,
    };
    reads[contextKey(artifact.type, artifact.key)] = entry;
    if (artifact.artifactId === input.target.artifactId) {
      target = entry;
    }
  }

  // El target siempre existe como fila aunque aún no tenga contenido legible.
  if (!target) {
    target = {
      artifactId: input.target.artifactId,
      type: input.target.type,
      key: input.target.key,
      label: input.target.type,
      status: "empty",
      version: 0,
      payload: null,
    };
  }

  return {
    projectId: input.context.project.id,
    projectName: input.context.project.name,
    reads,
    target,
  };
}

/** Resultados de validación de skill → forma persistida en el run (§9.6). */
export function toRunValidations(
  results: readonly SkillValidationResult[],
): AgentRunValidation[] {
  return results.map((result) => {
    const detail = result.issues
      .map((issue) => {
        const prefix = issue.severity === "warning" ? "[aviso] " : "";
        return `${prefix}${issue.path ? `${issue.path}: ` : ""}${issue.message}`;
      })
      .join(" · ");
    return {
      key: result.validation,
      label: result.label,
      ok: result.ok,
      ...(detail ? { detail } : {}),
    };
  });
}

/**
 * Resuelve una skill rica + params crudos en la definición operativa que el
 * runner ejecuta. Lanza ZodError si los params no validan — el llamador (la
 * server action que encola el run) lo reporta ANTES de crear nada.
 */
export function bindSkillForRun<TParams extends Record<string, unknown>>(
  skill: AgentSkill<TParams>,
  rawParams: unknown,
): BoundSkill {
  const params = skill.paramsSchema.parse(rawParams ?? {});
  const target = skill.resolveTarget(params);

  const reads: SkillContextRead[] = effectiveReads(skill, params).map((read) => {
    const key = read.keyFrom ? params[read.keyFrom as keyof TParams] : undefined;
    return typeof key === "string" && key.length > 0
      ? { type: read.type, key }
      : { type: read.type };
  });

  const instruction =
    typeof params["instruction"] === "string" ? (params["instruction"] as string) : null;

  /**
   * La instrucción viaja por dos canales (params al bindear, `instruction`
   * del run al ejecutar); ante divergencia gana la del run — es la auditada.
   */
  const paramsFor = (input: SkillPromptInput): TParams =>
    input.instruction != null && "instruction" in (params as Record<string, unknown>)
      ? ({ ...params, instruction: input.instruction } as TParams)
      : params;

  const definition: RuntimeSkillDefinition = {
    name: skill.name,
    version: skill.version,
    label: skill.label,
    reads,
    writes: target.type,
    requiresApproval: true,
    buildPrompt: (input) => {
      const prompt = skill.buildPrompt(toSkillContext(input), paramsFor(input));
      return {
        system: prompt.system,
        user: prompt.user,
        schema: prompt.schema,
        maxTokens: skill.costBudget.maxTokens,
      };
    },
    parseProposal: (json, input) => skill.parseProposal(json, paramsFor(input)),
    validate: (payload, input) =>
      toRunValidations(
        runSkillValidations(
          skill.validations,
          payload,
          toSkillContext(input),
          paramsFor(input),
        ),
      ),
    buildMockProposal: (input) =>
      skill.buildMockProposal(toSkillContext(input), paramsFor(input)),
  };

  return { definition, target, instruction, params };
}
