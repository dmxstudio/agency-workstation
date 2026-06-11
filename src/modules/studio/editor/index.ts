/**
 * Editor del Visual Studio — API pública del sub-módulo.
 *
 * Solo exporta piezas CLIENT-SAFE (el island y sus tipos serializables) más
 * el helper puro de navegación. Las lecturas server-only viven en
 * `./queries.ts` y se importan por ruta directa desde Server Components —
 * NUNCA desde aquí, para no arrastrar el driver de DB al bundle del cliente.
 */
export { StudioEditor, type StudioEditorProps } from "./studio-editor";
export { buildStudioNavDefaults } from "./nav-defaults";
export type { StudioArtifactView, DraftSaveState } from "./types";
