import { contextKey, type SkillContext, type SkillContextArtifact } from "./types";

/**
 * Piezas compartidas de los prompts de skill. Los prompts son producto:
 * sobrios, en español, versionados en el repo junto a cada skill.
 */

/**
 * System prompt base del asistente único (§9.2): identidad + reglas que
 * aplican a TODAS las skills. Cada skill añade su rol y sus reglas propias.
 */
export function buildSystemPrompt(role: string, rules: readonly string[]): string {
  const allRules = [
    "Trabajas dentro de una plataforma de agencias donde TODO lo que produces es una PROPUESTA: un humano con rol la revisará con un diff y decidirá. Nunca des nada por aprobado.",
    "Escribe SIEMPRE en español neutro profesional. Sin anglicismos gratuitos, sin relleno, sin promesas que el proyecto no haga.",
    "No inventes datos del cliente (cifras, premios, clientes, fechas). Si el contexto no lo dice, no existe.",
    "Responde ÚNICAMENTE con el JSON pedido, conforme al schema. Sin markdown, sin comentarios, sin texto alrededor.",
    ...rules,
  ];
  return [
    "Eres el asistente de proyecto de Agency Workstation, integrado en el flujo de trabajo de una agencia web.",
    `Tarea actual: ${role}`,
    "",
    "Reglas:",
    ...allRules.map((rule, index) => `${index + 1}. ${rule}`),
  ].join("\n");
}

/** Serializa un artefacto leído como bloque de contexto del prompt. */
export function formatContextArtifact(
  title: string,
  artifact: SkillContextArtifact | null,
): string {
  if (!artifact || artifact.payload == null) {
    return `## ${title}\n(sin contenido)`;
  }
  const version = artifact.version > 0 ? `v${artifact.version}` : "borrador";
  return [
    `## ${title} (${artifact.type}${artifact.key ? `:${artifact.key}` : ""}, ${version})`,
    "```json",
    JSON.stringify(artifact.payload, null, 2),
    "```",
  ].join("\n");
}

/** Bloque de contexto para una lectura declarada (por type/key). */
export function contextSection(
  context: SkillContext,
  title: string,
  type: string,
  key?: string | null,
): string {
  return formatContextArtifact(title, context.reads[contextKey(type, key)] ?? null);
}

/** Cabecera de proyecto común a todos los user prompts. */
export function projectHeader(context: SkillContext): string {
  return `# Proyecto: ${context.projectName}`;
}
