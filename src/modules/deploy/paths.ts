import path from "node:path";

import type { DeploySlot } from "./provider";

/**
 * Filesystem layout of the LOCAL deploy provider:
 *
 * ```
 * .data/deploys/<projectId>/
 *   builds/release-<N>/      immutable build (git archive of tag + node_modules
 *                            + .next + .data/site.db). Sealed by the marker
 *                            file `.deploy-build.json` — once present the
 *                            build is NEVER rebuilt.
 *   <slot>.pid               pidfile (JSON) of the running slot process
 *   <slot>.log               stdout/stderr of the slot's `next start`
 * ```
 *
 * Env overrides (documented contract):
 * - `LOCAL_DEPLOYS_DIR`     base dir (default `./.data/deploys`).
 * - `DEPLOY_PROD_PORT`      production slot port (default 4100).
 * - `DEPLOY_PREVIEW_PORT`   preview slot port (default 4200).
 *
 * NOTE — duplicated path resolution: the module boundary rule (CLAUDE.md
 * §19.5) forbids `deploy → generator` imports, so `getProjectRepoDir` is a
 * synchronized duplicate of `src/modules/generator/paths.ts` (same env var
 * `GENERATED_PROJECTS_DIR`, same default). If that resolution changes there,
 * change it here — same precedent as the Studio registry's `tokens-css.ts`.
 *
 * Env vars are read at call time (not module load) so test harnesses can set
 * them before invoking the provider.
 */

/** Git repository of a generated project (duplicate of generator/paths.ts). */
export function getProjectRepoDir(projectId: string): string {
  const base = process.env.GENERATED_PROJECTS_DIR ?? path.join(process.cwd(), ".data", "projects");
  return path.join(base, projectId);
}

/** Project template — node_modules donor (duplicate of generator/paths.ts). */
export function getTemplateDir(): string {
  return (
    process.env.PROJECT_TEMPLATE_DIR ?? path.join(process.cwd(), "templates", "project-base")
  );
}

/** Base directory of all local deploys. */
export function getDeploysBaseDir(): string {
  return process.env.LOCAL_DEPLOYS_DIR ?? path.join(process.cwd(), ".data", "deploys");
}

/** Per-project deploy directory (builds + slot pidfiles + slot logs). */
export function getProjectDeployDir(projectId: string): string {
  return path.join(getDeploysBaseDir(), projectId);
}

/** Immutable build directory of a release. */
export function getReleaseBuildDir(projectId: string, releaseNumber: number): string {
  return path.join(getProjectDeployDir(projectId), "builds", `release-${releaseNumber}`);
}

/** Marker file sealing a build as complete — its presence means "immutable". */
export const BUILD_MARKER_FILENAME = ".deploy-build.json";

export function getBuildMarkerPath(projectId: string, releaseNumber: number): string {
  return path.join(getReleaseBuildDir(projectId, releaseNumber), BUILD_MARKER_FILENAME);
}

/** Pidfile (JSON) of a slot's running process. */
export function getSlotPidfilePath(projectId: string, slot: DeploySlot): string {
  return path.join(getProjectDeployDir(projectId), `${slot}.pid`);
}

/** Log file of a slot's `next start` process (appended across deploys). */
export function getSlotLogPath(projectId: string, slot: DeploySlot): string {
  return path.join(getProjectDeployDir(projectId), `${slot}.log`);
}

const SLOT_DEFAULT_PORTS: Record<DeploySlot, number> = {
  production: 4100,
  preview: 4200,
};

const SLOT_PORT_ENV: Record<DeploySlot, string> = {
  production: "DEPLOY_PROD_PORT",
  preview: "DEPLOY_PREVIEW_PORT",
};

/** Local port of a slot (`DEPLOY_PROD_PORT` / `DEPLOY_PREVIEW_PORT`). */
export function getSlotPort(slot: DeploySlot): number {
  const raw = process.env[SLOT_PORT_ENV[slot]];
  if (raw == null || raw === "") return SLOT_DEFAULT_PORTS[slot];
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Valor inválido de ${SLOT_PORT_ENV[slot]}: «${raw}» (puerto 1-65535).`);
  }
  return port;
}

/** Public URL where the slot serves locally. */
export function getSlotUrl(slot: DeploySlot): string {
  return `http://localhost:${getSlotPort(slot)}`;
}
