import { getSessionUser } from "@/modules/platform-core/auth/adapter";

import { listAssistantSkills, listAssistantTypeOptions } from "./catalog";
import { AssistantPanel } from "./assistant-panel";
import type { AssistantSurface } from "./types";

/**
 * Montaje del asistente contextual (server component, §9.2): resuelve sesión
 * y rol, proyecta el registry de skills a descriptores serializables para la
 * superficie actual y monta el panel client. Renderiza null para clientes y
 * sin sesión — el asistente es una herramienta del equipo interno (§13).
 *
 * Uso (Cockpit / Spec OS / Studio):
 *   <AssistantLauncher surface="spec-os" slug={slug} projectId={projectId}
 *     artifactType={artifact.type} artifactKey={artifact.key ?? undefined} />
 */

export interface AssistantLauncherProps {
  surface: AssistantSurface;
  slug: string;
  projectId: string;
  /** Tipo del artefacto abierto (filtra skills con `relevantFor`, §9.2). */
  artifactType?: string;
  /** Instance key del artefacto abierto (Studio: pageKey). */
  artifactKey?: string;
}

export async function AssistantLauncher({
  surface,
  slug,
  projectId,
  artifactType,
  artifactKey,
}: AssistantLauncherProps) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "member")) return null;

  const skills = listAssistantSkills(surface, artifactType);
  if (skills.length === 0) return null;

  return (
    <AssistantPanel
      surface={surface}
      projectId={projectId}
      basePath={`/w/${slug}/p/${projectId}`}
      settingsHref={`/w/${slug}/settings`}
      skills={skills}
      typeOptions={listAssistantTypeOptions()}
      artifactType={artifactType}
      artifactKey={artifactKey}
    />
  );
}
