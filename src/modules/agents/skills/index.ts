import { composePageDraftSkill } from "./compose-page-draft";
import { generateCmsSchemaSkill } from "./generate-cms-schema";
import { generateSpecDraftSkill } from "./generate-spec-draft";
import { reviseArtifactSkill } from "./revise-artifact";
import { writePageCopySkill } from "./write-page-copy";
import type { AgentSkill, SkillName, SkillSurface } from "./types";

/**
 * Registro de las 5 skills del MVP (§9.3) — lista CERRADA. El asistente
 * contextual único (§9.2) y el runner consumen este registro; añadir una
 * skill nueva exige volver a la spec.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export const skillRegistry: Readonly<Record<SkillName, AgentSkill<any>>> = {
  "generate-spec-draft": generateSpecDraftSkill,
  "generate-cms-schema": generateCmsSchemaSkill,
  "write-page-copy": writePageCopySkill,
  "compose-page-draft": composePageDraftSkill,
  "revise-artifact": reviseArtifactSkill,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export function isSkillName(name: string): name is SkillName {
  return Object.prototype.hasOwnProperty.call(skillRegistry, name);
}

/** Lookup estricto: lanza si el nombre no es una de las 5 skills. */
export function getSkill(name: string): AgentSkill {
  if (!isSkillName(name)) {
    throw new Error(`Skill desconocida: ${name}`);
  }
  return skillRegistry[name];
}

/** Todas las skills en orden canónico (§9.3). */
export function listSkills(): AgentSkill[] {
  return Object.values(skillRegistry);
}

/**
 * Skills que el asistente contextual ofrece en una superficie, opcionalmente
 * filtradas por el tipo de artefacto en pantalla (§9.2).
 */
export function skillsForSurface(
  surface: SkillSurface,
  artifactType?: string,
): AgentSkill[] {
  return listSkills().filter(
    (skill) =>
      skill.availableIn.includes(surface) &&
      (artifactType == null || skill.relevantFor(artifactType)),
  );
}

// Contrato y tipos compartidos del modelo de skills.
export {
  SKILL_NAMES,
  contextKey,
  defineSkill,
  effectiveReads,
  readPayload,
  runSkillValidations,
  validationsPass,
  type AgentSkill,
  type LlmProviderId,
  type SkillContext,
  type SkillContextArtifact,
  type SkillCostBudget,
  type SkillIssueSeverity,
  type SkillModelPolicy,
  type SkillName,
  type SkillPrompt,
  type SkillRead,
  type SkillSurface,
  type SkillTarget,
  type SkillValidation,
  type SkillValidationIssue,
  type SkillValidationResult,
  type SkillWrite,
} from "./types";

export {
  bindSkillForRun,
  toRunValidations,
  toSkillContext,
  type BoundSkill,
} from "./bind";
export { zodToProviderSchema, findProviderSchemaViolations } from "./json-schema";
export { parseProposalWith } from "./proposal";
export {
  REGISTRY_COMPONENT_NAMES,
  COMPOSABLE_COMPONENTS,
  COMPOSABLE_COMPONENT_NAMES,
  buildCompositionJsonSchema,
  isRegistryComponent,
  type ComposableComponentSpec,
  type RegistryComponentName,
} from "./registry-catalog";

export {
  generateSpecDraftSkill,
  generateSpecDraftParamsSchema,
  type GenerateSpecDraftParams,
} from "./generate-spec-draft";
export {
  generateCmsSchemaSkill,
  generateCmsSchemaParamsSchema,
  type GenerateCmsSchemaParams,
} from "./generate-cms-schema";
export {
  writePageCopySkill,
  writePageCopyParamsSchema,
  type WritePageCopyParams,
} from "./write-page-copy";
export {
  composePageDraftSkill,
  composePageDraftParamsSchema,
  type ComposePageDraftParams,
} from "./compose-page-draft";
export {
  reviseArtifactSkill,
  reviseArtifactParamsSchema,
  type ReviseArtifactParams,
} from "./revise-artifact";
