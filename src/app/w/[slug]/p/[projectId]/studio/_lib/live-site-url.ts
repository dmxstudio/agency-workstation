import { getDeployProvider } from "@/modules/deploy";
import { getGeneratedSiteUrl, getProjectRepoDir, hasManifest } from "@/modules/generator";

/**
 * Resuelve dónde está sirviendo el sitio generado AHORA MISMO, sondeando
 * realidad (capa app: compone deploy + generator, que entre sí no se
 * importan). Prioridad: slot producción → slot preview (status del
 * DeployProvider: pid + probe HTTP) → dev server del repo generado (probe
 * directo con timeout corto). Devuelve null si nada responde — un enlace
 * «Ver» jamás debe llevar a ERR_CONNECTION_REFUSED.
 */

export type LiveSiteSource = "production" | "preview" | "dev";

export interface LiveSite {
  url: string;
  source: LiveSiteSource;
}

export const LIVE_SITE_SOURCE_LABEL: Record<LiveSiteSource, string> = {
  production: "producción",
  preview: "preview",
  dev: "dev server",
};

export async function resolveLiveSiteUrl(projectId: string): Promise<LiveSite | null> {
  if (!hasManifest(getProjectRepoDir(projectId))) return null;

  try {
    const slots = await getDeployProvider().status(projectId);
    for (const source of ["production", "preview"] as const) {
      const slot = slots.find((s) => s.slot === source);
      if (slot && slot.state === "running" && slot.healthy && slot.url) {
        return { url: slot.url, source };
      }
    }
  } catch {
    // El status del provider nunca debe tumbar una pantalla del Studio.
  }

  const devUrl = getGeneratedSiteUrl();
  try {
    const res = await fetch(devUrl, { signal: AbortSignal.timeout(500), cache: "no-store" });
    if (res.ok) return { url: devUrl, source: "dev" };
  } catch {
    // Dev server apagado: no hay sitio vivo.
  }
  return null;
}
