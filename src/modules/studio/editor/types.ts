import type { ValidationIssue } from "@/modules/artifacts/errors";
import type { ArtifactStatus } from "@/ui";

/**
 * Vistas SERIALIZABLES que el server shell (`studio/[...pageKey]/page.tsx`)
 * pasa al island client del editor. Sin Dates, sin schemas Zod, sin handles
 * de DB: solo JSON plano (frontera RSC → client).
 */

/** El artefacto `page.composition` que se está editando. */
export interface StudioArtifactView {
  id: string;
  /** Instance key = path de la página en el sitemap (`artifacts.key`). */
  pageKey: string;
  /** Label humano, p.ej. "Composición: Servicios". */
  label: string;
  status: ArtifactStatus;
  outdated: boolean;
  rejected: boolean;
  currentVersion: number;
  lockedBy: string | null;
  /** Hay draftPayload persistido (requisito para enviar a revisión). */
  hasDraft: boolean;
}

/** Estado del autosave del borrador, para el indicador "guardado hace Xs". */
export interface DraftSaveState {
  phase: "idle" | "dirty" | "saving" | "saved" | "error";
  /** Epoch ms del último guardado correcto en esta sesión. */
  savedAt: number | null;
  error: string | null;
  issues: ValidationIssue[];
}
