/**
 * Asistente contextual único (§9.2) — superficie pública para las pantallas.
 *
 * - `AssistantLauncher` es un SERVER component: impórtalo solo desde páginas
 *   y layouts del App Router (resuelve sesión vía el adapter de auth).
 * - Las server actions NO se re-exportan aquí: los client components del
 *   propio asistente las importan de `./actions` para mantener intacta la
 *   frontera `"use server"`.
 */

export { AssistantLauncher, type AssistantLauncherProps } from "./assistant-launcher";
export type {
  AssistantSurface,
  AssistantSkillInfo,
  AssistantTypeOption,
  RunStatusView,
} from "./types";
