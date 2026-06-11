import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema";

/**
 * Lecturas auxiliares del editor del Studio (server-only: importar SOLO desde
 * Server Components / código de servidor, nunca desde el island client —
 * por eso NO se re-exportan en `./index.ts`).
 */

/**
 * Feedback del último rechazo de un artefacto (§8.2/§13 paso 5): `reject()`
 * lo persiste en el audit log (`artifact.rejected` → `detail.feedback`).
 * Devuelve null si no hay rechazo registrado o el detail no trae feedback.
 */
export async function getLatestRejectionFeedback(artifactId: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ detail: auditLog.detail })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "artifact.rejected"),
        eq(auditLog.entityType, "artifact"),
        eq(auditLog.entityId, artifactId),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(1);

  const detail = rows[0]?.detail;
  if (detail && typeof detail === "object" && "feedback" in detail) {
    const feedback = (detail as { feedback?: unknown }).feedback;
    return typeof feedback === "string" && feedback.trim() !== "" ? feedback : null;
  }
  return null;
}
