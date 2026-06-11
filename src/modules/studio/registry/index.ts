/**
 * Registry del Visual Studio — API pública del módulo.
 * Relación con el template y reglas de sincronización: ver README.md.
 */
export {
  createPuckConfig,
  puckConfig,
  editorViewports,
  type CreatePuckConfigOptions,
} from "./config";
export { tokensCss } from "./tokens-css";
export { canvasBaseCss, studioCanvasCss } from "./canvas-css";
export {
  createBindingField,
  bindingPlaceholder,
  type CmsBindingValue,
  type BindingExpect,
  type BindingFieldSpec,
} from "./bindings";
export { type StudioNavDefaults } from "./sections/navigation";
export { type TestimonialRef, type PostRef } from "./sections/cms";
