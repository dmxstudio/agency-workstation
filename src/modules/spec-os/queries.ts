import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { tasks, users, type Task } from "@/db/schema";

/**
 * Lecturas auxiliares de la pantalla de Spec OS (server-only: importar solo
 * desde Server Components / código de servidor, nunca desde componentes client).
 */

/**
 * Tarea derivada de re-validación abierta para un artefacto `outdated`
 * (dedupeKey `outdated:<artifactId>`, §12.2). Su título indica qué dependencia
 * upstream cambió — se muestra en el banner ámbar (§8.4).
 */
export async function getOpenOutdatedTask(
  projectId: string,
  artifactId: string,
): Promise<Task | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.dedupeKey, `outdated:${artifactId}`),
        eq(tasks.status, "open"),
        isNull(tasks.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Nombre de usuario para mostrar (owner del artefacto), o null. */
export async function getUserNameById(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const db = getDb();
  const rows = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.name ?? null;
}
