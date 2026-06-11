/**
 * Deploy module (§7.8) — public surface.
 *
 * Product code obtains the provider ONLY through `getDeployProvider()` (same
 * adapter discipline as auth, §18.6). The local provider is the MVP default;
 * a Vercel provider will plug in behind the same interface, selected via
 * `DEPLOY_PROVIDER_KIND` when it exists.
 *
 * The DB-aware layer lives in sibling files imported by subpath (NOT
 * re-exported here, so `service → index` stays acyclic):
 * - `@/modules/deploy/service` — records `deployments` + audit around the
 *   provider; reads for the Deploy screen.
 * - `@/modules/deploy/actions` — "use server" mutations (session + role).
 */

import { LocalDeployProvider } from "./local-provider";
import type { DeployProvider } from "./provider";

export {
  DEPLOY_SLOTS,
  type BuildResult,
  type DeployProvider,
  type DeployResult,
  type DeploySlot,
  type SlotStatus,
} from "./provider";
export { DeployDomainError, isDeployDomainError, type DeployErrorCode } from "./errors";
export {
  getBuildMarkerPath,
  getDeploysBaseDir,
  getProjectDeployDir,
  getReleaseBuildDir,
  getSlotLogPath,
  getSlotPidfilePath,
  getSlotPort,
  getSlotUrl,
} from "./paths";
export { LocalDeployProvider } from "./local-provider";

let provider: DeployProvider | null = null;

/** Singleton provider for the configured deploy backend (local-only for now). */
export function getDeployProvider(): DeployProvider {
  provider ??= new LocalDeployProvider();
  return provider;
}
