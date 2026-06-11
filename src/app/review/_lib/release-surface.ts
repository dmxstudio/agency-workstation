import {
  getArtifactWithHistory,
  getProjectArtifacts,
  pageCompositionDefinition,
  pageCompositionPayloadSchema,
} from "@/modules/artifacts";
import { getDeployProvider, type DeploySlot } from "@/modules/deploy";
import type { ReviewPage } from "@/modules/review";

import { humanSectionLabel } from "./section-labels";

/**
 * Lecturas compartidas por las DOS superficies de Review (§7.7, §13, §16):
 * la interna (/w/.../review) y la pública del cliente (/review/[token]).
 *
 * - Las secciones salen de la versión SELLADA de cada `page.composition` que
 *   el release congeló — el cliente comenta sobre el snapshot exacto que ve
 *   en el iframe, no sobre el borrador actual.
 * - El deployment se resuelve contra el DeployProvider (`status()` reporta
 *   realidad, no estado persistido): el review embebe el deployment REAL por
 *   iframe (§16, una sola pipeline de render). Aquí NO se despliega nada:
 *   si el slot no corre, la superficie lo dice honestamente.
 *
 * Solo lecturas vía módulos (app → modules); cero acceso directo a la DB.
 */

// ---------------------------------------------------------------------------
// Secciones selladas del release (anclas de comentarios, `#<blockId>`)
// ---------------------------------------------------------------------------

export interface ReleaseSection {
  /** Id estable del bloque Puck — el HTML desplegado lo emite como id DOM. */
  id: string;
  /** Etiqueta humana («Hero — “Bienvenido”»); nunca el tipo interno crudo. */
  label: string;
}

/**
 * Secciones por página de un release: bloques raíz de la versión sellada de
 * cada composición. Páginas sin composición legible (artefacto borrado o
 * payload legado) degradan a lista vacía — los comentarios sin sección
 * siguen funcionando.
 */
export async function getReleaseSections(
  projectId: string,
  pages: ReviewPage[],
): Promise<Map<string, ReleaseSection[]>> {
  const items = await getProjectArtifacts(projectId);
  const compositionsByKey = new Map(
    items
      .filter(
        (item) =>
          item.artifact.type === pageCompositionDefinition.type &&
          item.artifact.key != null,
      )
      .map((item) => [item.artifact.key as string, item.artifact]),
  );

  const entries = await Promise.all(
    pages.map(async (page): Promise<[string, ReleaseSection[]]> => {
      const artifact = compositionsByKey.get(page.pageKey);
      if (!artifact) return [page.pageKey, []];
      try {
        const history = await getArtifactWithHistory(artifact.id);
        const sealed = history.versions.find(
          (version) => version.version === page.compositionVersion,
        );
        if (!sealed) return [page.pageKey, []];
        const parsed = pageCompositionPayloadSchema.safeParse(sealed.payload);
        if (!parsed.success) return [page.pageKey, []];
        return [
          page.pageKey,
          parsed.data.content.map((block) => ({
            id: block.props.id,
            label: humanSectionLabel(block.type, block.props),
          })),
        ];
      } catch {
        return [page.pageKey, []]; // artefacto ilegible: degradar sin romper
      }
    }),
  );

  return new Map(entries);
}

// ---------------------------------------------------------------------------
// Deployment real del release (iframe del review, §16)
// ---------------------------------------------------------------------------

export interface RunningDeployment {
  slot: DeploySlot;
  url: string;
  healthy: boolean;
}

/**
 * Slot que está sirviendo AHORA el release indicado, con preferencia por
 * `preview` (el slot pensado para revisión de cliente). `null` cuando ningún
 * slot corre ese release — la superficie muestra el aviso honesto y los
 * comentarios siguen disponibles.
 */
export async function findRunningDeployment(
  projectId: string,
  releaseNumber: number,
): Promise<RunningDeployment | null> {
  const statuses = await getDeployProvider().status(projectId);
  const running = statuses.filter(
    (status) =>
      status.state === "running" &&
      status.releaseNumber === releaseNumber &&
      status.url != null,
  );
  const preferred =
    running.find((status) => status.slot === "preview") ??
    running.find((status) => status.slot === "production") ??
    null;
  if (!preferred) return null;
  return {
    slot: preferred.slot,
    url: preferred.url as string,
    healthy: preferred.healthy,
  };
}

/** Slots corriendo por número de release (selector de la pantalla interna). */
export async function getRunningSlotsByRelease(
  projectId: string,
): Promise<Map<number, DeploySlot[]>> {
  const statuses = await getDeployProvider().status(projectId);
  const byRelease = new Map<number, DeploySlot[]>();
  for (const status of statuses) {
    if (status.state !== "running" || status.releaseNumber == null) continue;
    const slots = byRelease.get(status.releaseNumber) ?? [];
    slots.push(status.slot);
    byRelease.set(status.releaseNumber, slots);
  }
  return byRelease;
}

// ---------------------------------------------------------------------------

/** Ruta pública de una ronda (el link que recibe el cliente, R8). */
export function publicReviewPath(token: string): string {
  return `/review/${token}`;
}
