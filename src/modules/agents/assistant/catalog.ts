import {
  ARTIFACT_TYPE_KEYS,
  getArtifactType,
  getArtifactTypeOrNull,
  type ArtifactTypeKey,
} from "@/modules/artifacts/types";

import { skillsForSurface } from "../skills";
import type {
  AssistantReadInfo,
  AssistantSkillInfo,
  AssistantSurface,
  AssistantTypeOption,
} from "./types";

/**
 * Catálogo del asistente contextual (§9.2): proyecta el registry de skills
 * (funciones, Zod, prompts) a descriptores SERIALIZABLES que el panel client
 * puede recibir como props. Solo se ejecuta en el servidor (lo importan el
 * launcher server component y nada más) — el registry entero nunca viaja al
 * bundle del cliente.
 */

/** Tipos multi-instancia del MVP (instance key obligatoria, §8.1). */
const MULTI_INSTANCE_TYPES: readonly ArtifactTypeKey[] = ["page.composition"];

function typeLabel(typeKey: string): string {
  return getArtifactTypeOrNull(typeKey)?.label ?? typeKey;
}

/** Skills disponibles en una superficie, como descriptores serializables. */
export function listAssistantSkills(
  surface: AssistantSurface,
  artifactType?: string,
): AssistantSkillInfo[] {
  return skillsForSurface(surface, artifactType).map((skill) => {
    const reads: AssistantReadInfo[] = skill.reads.map((read) => ({
      typeKey: read.type,
      label: typeLabel(read.type),
      mode: read.mode,
      required: read.required,
    }));
    return {
      name: skill.name,
      version: skill.version,
      label: skill.label,
      description: skill.description,
      reads,
      writes: skill.writes.types.map((typeKey) => ({
        typeKey,
        label: typeLabel(typeKey),
      })),
      preferredProvider: skill.modelPolicy.preferred,
      fallbackProviders: [...skill.modelPolicy.fallbacks],
      maxTokens: skill.costBudget.maxTokens,
    };
  });
}

/**
 * Opciones de tipo de artefacto con sus aristas upstream declaradas (§8.4) —
 * el selector de target de `revise-artifact` y el bloque "qué LEE" dinámico.
 */
export function listAssistantTypeOptions(): AssistantTypeOption[] {
  return ARTIFACT_TYPE_KEYS.map((typeKey) => {
    const definition = getArtifactType(typeKey);
    return {
      typeKey,
      label: definition.label,
      multi: MULTI_INSTANCE_TYPES.includes(typeKey),
      dependsOn: definition.dependsOn.map((upstream) => ({
        typeKey: upstream,
        label: typeLabel(upstream),
      })),
    };
  });
}
