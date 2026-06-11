import type { Artifact } from "@/db/schema";
import {
  getArtifactWithHistory,
  parseAnyComposition,
  type AnyComposition,
  type ProjectArtifact,
} from "@/modules/artifacts";

/**
 * Read-helpers compartidos por las pantallas Studio (índice de páginas) y
 * CMS (mapa de bindings). Solo COMPONEN funciones del módulo artifacts
 * (§19.5): las pantallas no tocan la DB directamente.
 */

/**
 * Payload de la última versión SELLADA (inmutable) de un artefacto, o null
 * si aún no tiene versiones.
 */
export async function loadSealedPayload(artifact: Artifact): Promise<unknown> {
  if (artifact.currentVersion < 1) return null;
  const { versions } = await getArtifactWithHistory(artifact.id);
  return versions.find((entry) => entry.version === artifact.currentVersion)?.payload ?? null;
}

/** De dónde sale el payload mostrado de una composición. */
export type CompositionSource = "draft" | "version";

export interface CompositionData {
  item: ProjectArtifact;
  /** Clave de instancia = path de la página (`artifacts.key`). */
  key: string;
  /** Origen del payload mostrado; null si la instancia está vacía. */
  source: CompositionSource | null;
  /** Payload parseado (Data v2 de Puck o item legado 1.0); null si vacío o ilegible. */
  composition: AnyComposition | null;
  /** Nº de secciones (bloques de nivel raíz); null sin payload legible. */
  sectionCount: number | null;
  /** Peso del Data JSON serializado, en bytes; null si no hay payload. */
  byteSize: number | null;
  /** Hay payload pero no valida con ningún schema conocido (v2 ni legado). */
  unreadable: boolean;
}

function countSections(composition: AnyComposition): number {
  if ("sections" in composition && Array.isArray(composition.sections)) {
    return composition.sections.length; // forma legada 1.0
  }
  if ("content" in composition && Array.isArray(composition.content)) {
    return composition.content.length; // Data v2 de Puck
  }
  return 0;
}

/**
 * Carga el payload de trabajo actual (borrador si existe, si no la última
 * versión sellada) de cada instancia keyed de `page.composition`, con
 * métricas de tabla (secciones, peso) ya calculadas. Orden estable por key.
 */
export async function loadCompositionData(items: ProjectArtifact[]): Promise<CompositionData[]> {
  const keyed = items.filter(
    (item) => item.artifact.type === "page.composition" && item.artifact.key != null,
  );

  const rows = await Promise.all(
    keyed.map(async (item): Promise<CompositionData> => {
      const { artifact } = item;
      let raw: unknown = null;
      let source: CompositionSource | null = null;
      if (artifact.draftPayload != null) {
        raw = artifact.draftPayload;
        source = "draft";
      } else if (artifact.currentVersion > 0) {
        raw = await loadSealedPayload(artifact);
        source = raw != null ? "version" : null;
      }
      const composition = raw != null ? parseAnyComposition(raw) : null;
      return {
        item,
        key: artifact.key as string,
        source,
        composition,
        sectionCount: composition ? countSections(composition) : null,
        byteSize: raw != null ? Buffer.byteLength(JSON.stringify(raw), "utf8") : null,
        unreadable: raw != null && composition == null,
      };
    }),
  );

  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/** Peso humano del Data JSON: bytes hasta 1 kB, después kB con un decimal. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toLocaleString("es", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} kB`;
}
