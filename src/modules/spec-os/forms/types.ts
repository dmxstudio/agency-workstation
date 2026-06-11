import type { ValidationIssue } from "@/modules/artifacts/errors";

/**
 * Contrato común de los formularios tipados de Spec OS (§7.2).
 *
 * Cada formulario es un componente client CONTROLADO sobre el payload del
 * artefacto: recibe `value` (unknown — puede venir de un draft antiguo o de
 * una versión sellada), lo normaliza internamente a su forma editable y emite
 * el payload completo en cada cambio. La validación Zod ocurre en el servidor
 * en cada escritura (saveDraft); los errores vuelven como `issues` por path.
 */

/** Mapa path-del-payload → mensaje de error (en español, listo para UI). */
export type IssueMap = Record<string, string>;

/** Une segmentos al formato de path del servidor: `pages.0.children.1.slug`. */
export function pathKey(...segments: (string | number)[]): string {
  return segments.map(String).join(".");
}

/** Busca el mensaje de error para un campo concreto. */
export function issueAt(
  issues: IssueMap,
  ...segments: (string | number)[]
): string | undefined {
  return issues[pathKey(...segments)];
}

/** Convierte la lista de issues del servidor en un mapa por path. */
export function toIssueMap(issues: ValidationIssue[] | undefined): IssueMap {
  const map: IssueMap = {};
  for (const issue of issues ?? []) {
    // El primer mensaje por path gana (suele ser el más específico).
    if (!(issue.path in map)) map[issue.path] = issue.message;
  }
  return map;
}

export interface ArtifactFormProps {
  /** Payload actual (draft, versión sellada o scaffold vacío). */
  value: unknown;
  /** Emite el payload completo actualizado. */
  onChange: (payload: unknown) => void;
  /** Solo lectura (estado in_review/approved/locked o rol sin permisos). */
  readOnly: boolean;
  /** Errores de validación del último guardado, por path. */
  issues: IssueMap;
}
