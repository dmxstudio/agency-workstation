import type { z } from "zod";

import { ArtifactValidationError } from "@/modules/artifacts/errors";

/**
 * Validación Zod del JSON devuelto por el proveedor (paso `parseProposal` del
 * contrato §9.1). Reutiliza el error tipado de artifacts para que el runner
 * reporte issues con la misma forma que cualquier escritura de payload.
 */
export function parseProposalWith<T>(schema: z.ZodType<T>, json: unknown): T {
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ArtifactValidationError(
      "La propuesta del modelo no valida contra el schema del tipo de artefacto.",
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
