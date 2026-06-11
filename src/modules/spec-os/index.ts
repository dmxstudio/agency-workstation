/**
 * Spec OS — formularios tipados de las 6 secciones de la spec (§7.2).
 *
 * Este barrel es seguro para componentes client. Las lecturas server-only
 * viven en `@/modules/spec-os/queries` y NO se re-exportan aquí.
 */

export {
  specOsFormRegistry,
  getSpecOsFormEntry,
  type SpecOsFormEntry,
} from "./forms/registry";
export {
  pathKey,
  issueAt,
  toIssueMap,
  type ArtifactFormProps,
  type IssueMap,
} from "./forms/types";
export { IntakeForm, createEmptyIntakePayload } from "./forms/IntakeForm";
export { StrategyForm, createEmptyStrategyPayload } from "./forms/StrategyForm";
export { SitemapForm, createEmptySitemapPayload } from "./forms/SitemapForm";
export { ContentForm, createEmptyContentPayload } from "./forms/ContentForm";
export {
  CmsCollectionsForm,
  createEmptyCmsCollectionsPayload,
} from "./forms/CmsCollectionsForm";
export {
  DesignTokensForm,
  createEmptyDesignTokensPayload,
} from "./forms/DesignTokensForm";
export { JsonPayloadForm } from "./forms/JsonPayloadForm";
export {
  StringListEditor,
  SlugListEditor,
  TokenMapEditor,
  FormSection,
  CheckboxField,
  type StringListEditorProps,
  type SlugListEditorProps,
  type TokenMapEditorProps,
} from "./forms/controls";
