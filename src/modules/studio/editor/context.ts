"use client";

import { createContext, useContext } from "react";

import type { CmsCollectionsPayload } from "@/modules/artifacts";

import type { DraftSaveState, StudioArtifactView } from "./types";

/**
 * Contexto del editor del Studio. El panel "Aprobación" y los overrides del
 * header viven DENTRO del árbol de `<Puck>` como plugin/override: Puck captura
 * sus closures al montar, así que NO reciben props frescas del island — leen
 * este contexto (que React propaga aunque haya memos por medio) y así el
 * plugin puede ser un objeto estable creado una sola vez.
 */
export interface StudioEditorContextValue {
  artifact: StudioArtifactView;
  /** Rol admin|member del workspace (humano interno, §13/§14). */
  canEdit: boolean;
  /** El canvas admite ediciones AHORA (estado + rol + "editar nueva versión"). */
  editable: boolean;
  /** Por qué el canvas está en solo lectura (null si es editable). */
  readOnlyReason: string | null;
  /** Hay una server action del ciclo §13 en curso. */
  pendingAction: boolean;
  /** Error de la última acción del ciclo (no de autosave). */
  actionError: string | null;
  /** Aviso efímero tras una acción correcta. */
  notice: string | null;
  saveState: DraftSaveState;
  /** `cms.collections` aprobado (o null) para validar bindings en vivo. */
  cmsCollections: CmsCollectionsPayload | null;
  /** Link al artefacto cms.collections (o null si no existe). */
  cmsArtifactHref: string | null;
  /** Link a la vista de artefacto (historial completo + aprobaciones). */
  artifactHref: string;

  onStartNewVersion: () => void;
  onSubmitForReview: () => void;
  onOpenApprove: () => void;
  onOpenReject: () => void;
  onRevalidate: () => void;
  onOpenDiff: () => void;
}

export const StudioEditorContext = createContext<StudioEditorContextValue | null>(null);

export function useStudioEditor(): StudioEditorContextValue {
  const value = useContext(StudioEditorContext);
  if (!value) {
    throw new Error("useStudioEditor debe usarse dentro de <StudioEditorContext.Provider>.");
  }
  return value;
}
