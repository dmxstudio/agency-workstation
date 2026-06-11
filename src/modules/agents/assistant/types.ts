import type { LlmProviderKind } from "@/db/schema";
import type { AgentRunStatus } from "@/db/schema";
import type { ArtifactTypeKey } from "@/modules/artifacts/types";
import type { AgentRunUsage, AgentRunValidation } from "../types";
import type { SkillName, SkillSurface } from "../skills/types";

/**
 * Tipos SERIALIZABLES del asistente contextual único (§9.2): viajan entre el
 * server component que monta el panel, las server actions y los client
 * components. Solo datos planos — nada de funciones, Zod ni payloads de
 * artefacto. Las keys LLM jamás aparecen aquí (solo id/label/last4, §19).
 */

export type AssistantSurface = SkillSurface;

/** Una lectura declarada de la skill, resuelta a etiqueta humana (§9.1). */
export interface AssistantReadInfo {
  typeKey: string;
  label: string;
  /** `approved`: solo versiones selladas; `current`: draft del target si existe. */
  mode: "approved" | "current";
  required: boolean;
}

/** Descriptor de skill para el panel — derivado del registry, sin funciones. */
export interface AssistantSkillInfo {
  name: SkillName;
  version: string;
  label: string;
  description: string;
  /**
   * Lecturas estáticas declaradas. Para `revise-artifact` (lecturas dependen
   * del target elegido) va vacío: el panel las computa con `dependsOn` de
   * {@link AssistantTypeOption}.
   */
  reads: AssistantReadInfo[];
  /** Tipos que la skill puede escribir, con etiqueta humana. */
  writes: { typeKey: ArtifactTypeKey; label: string }[];
  preferredProvider: LlmProviderKind;
  fallbackProviders: LlmProviderKind[];
  maxTokens: number;
}

/** Opción de tipo de artefacto (selector de target de `revise-artifact`). */
export interface AssistantTypeOption {
  typeKey: ArtifactTypeKey;
  label: string;
  /** `true` si el tipo es multi-instancia (requiere instance key). */
  multi: boolean;
  /** Tipos upstream declarados (§8.4) — lecturas efectivas de revise-artifact. */
  dependsOn: { typeKey: ArtifactTypeKey; label: string }[];
}

/** Key BYOK visible en el panel: SOLO id/proveedor/etiqueta/last4 (§19). */
export interface AssistantKeyInfo {
  id: string;
  provider: LlmProviderKind;
  label: string;
  last4: string;
  /** `false` = marcada tras un 401 del proveedor (lastValidatedAt null). */
  validated: boolean;
}

/** Estado mínimo de un artefacto del proyecto para avisos y selects. */
export interface AssistantArtifactInfo {
  id: string;
  type: string;
  key: string | null;
  label: string;
  status: string;
  currentVersion: number;
  /** Hay borrador sin sellar (§8.6: la propuesta del run lo reemplazaría). */
  hasDraft: boolean;
  /** El borrador actual es propuesta de otro agent run (vs. trabajo humano). */
  proposedByRun: boolean;
}

/** Datos frescos que el panel pide al abrirse. */
export interface AssistantContextData {
  keys: AssistantKeyInfo[];
  artifacts: AssistantArtifactInfo[];
}

/** Vista de polling de un run — subset serializable de la fila agent_runs. */
export interface RunStatusView {
  id: string;
  status: AgentRunStatus;
  skill: string;
  skillVersion: string;
  provider: LlmProviderKind;
  modelId: string | null;
  targetArtifactId: string | null;
  targetType: string;
  targetKey: string | null;
  instruction: string | null;
  validations: AgentRunValidation[] | null;
  usage: AgentRunUsage | null;
  errorDetail: string | null;
  createdAtIso: string;
  finishedAtIso: string | null;
}

export type AssistantActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
