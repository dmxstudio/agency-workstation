"use client";

import type { ComponentType } from "react";

import type { ArtifactTypeKey } from "@/modules/artifacts/types";
import { emptyPageCompositionPayload } from "@/modules/artifacts/types";

import { CmsCollectionsForm, createEmptyCmsCollectionsPayload } from "./CmsCollectionsForm";
import { ContentForm, createEmptyContentPayload } from "./ContentForm";
import { createEmptyDesignTokensPayload, DesignTokensForm } from "./DesignTokensForm";
import { createEmptyIntakePayload, IntakeForm } from "./IntakeForm";
import { JsonPayloadForm } from "./JsonPayloadForm";
import { createEmptySitemapPayload, SitemapForm } from "./SitemapForm";
import { createEmptyStrategyPayload, StrategyForm } from "./StrategyForm";
import type { ArtifactFormProps } from "./types";

/**
 * Registro de formularios de Spec OS por tipo de artefacto (§7.2): las 6
 * secciones de la spec tienen formulario tipado; `page.composition` y
 * `release` (que pertenecen a Studio/Deploy) usan el editor JSON genérico.
 */

export interface SpecOsFormEntry {
  Form: ComponentType<ArtifactFormProps>;
  /** Scaffold inicial para artefactos en estado `empty`. */
  createEmptyPayload: () => unknown;
}

export const specOsFormRegistry: Record<ArtifactTypeKey, SpecOsFormEntry> = {
  "spec.intake": { Form: IntakeForm, createEmptyPayload: createEmptyIntakePayload },
  "spec.strategy": { Form: StrategyForm, createEmptyPayload: createEmptyStrategyPayload },
  "spec.sitemap": { Form: SitemapForm, createEmptyPayload: createEmptySitemapPayload },
  "content.page": { Form: ContentForm, createEmptyPayload: createEmptyContentPayload },
  "cms.collections": {
    Form: CmsCollectionsForm,
    createEmptyPayload: createEmptyCmsCollectionsPayload,
  },
  "design.tokens": {
    Form: DesignTokensForm,
    createEmptyPayload: createEmptyDesignTokensPayload,
  },
  "page.composition": {
    Form: JsonPayloadForm,
    // Puck Data vacío (schema v2): el editor real es el Studio (§7.4).
    createEmptyPayload: emptyPageCompositionPayload,
  },
  release: {
    Form: JsonPayloadForm,
    createEmptyPayload: () => ({
      name: "",
      target: "preview",
      pages: [],
      checklist: [],
    }),
  },
};

export function getSpecOsFormEntry(type: string): SpecOsFormEntry | null {
  return type in specOsFormRegistry
    ? specOsFormRegistry[type as ArtifactTypeKey]
    : null;
}
