/**
 * DeployProvider — provider-agnostic contract of Deploy & Release (§7.8).
 *
 * Same pattern as the auth adapter (§18.6): product code (review/deploy
 * screens and actions) talks ONLY to this interface; the concrete provider is
 * an implementation detail. The MVP ships a LOCAL provider (immutable builds
 * under `.data/deploys/`, slots served by detached `next start` processes);
 * Vercel will arrive later behind this SAME interface (`buildRelease` maps to
 * a Vercel build, `deploy` returns the deployment URL, `status` queries the
 * Vercel API instead of pidfiles).
 *
 * Design constraints baked into the contract:
 * - A release is an IMMUTABLE build of the generated repo at a git tag.
 *   Building the same release twice reuses the sealed build (`reused`).
 * - `deploy` returns the real serving `url` — provider decides the host.
 * - `status` reports REALITY (live process / HTTP probe / remote API), never
 *   just persisted state. Rollback needs no extra state: it is
 *   `deploy(previousReleaseNumber, slot)`.
 * - The provider is pure filesystem/processes (or remote API): it never
 *   touches the platform DB. Recording deployments (table + audit log) is the
 *   caller's job — server actions consume these results as clean hooks.
 * - GOVERNANCE (§13, §19): the provider deploys what it is told. The "no
 *   deploy without a human-confirmed release checklist" rule is enforced
 *   UPSTREAM by the release/review module before ever calling `deploy` —
 *   providers cannot weaken it, callers cannot skip it.
 */

/**
 * Deploy slots of the MVP (§7.8). `staging` is deliberately out: the local
 * MVP ships preview + production; a third slot is additive when Vercel lands.
 */
export type DeploySlot = "production" | "preview";

export const DEPLOY_SLOTS: readonly DeploySlot[] = ["production", "preview"];

/** Result of building (or reusing) the immutable build of a release. */
export interface BuildResult {
  projectId: string;
  releaseNumber: number;
  /** Git tag of the generated repo the build was produced from. */
  gitTag: string;
  /** Commit hash the tag pointed at when the build was sealed. */
  commit: string;
  /** Absolute path of the immutable build (local provider). */
  buildDir: string;
  /** True when a complete sealed build already existed and was reused. */
  reused: boolean;
  /** ISO timestamp at which the build was sealed. */
  builtAt: string;
  durationMs: number;
}

/** Result of activating a release on a slot. */
export interface DeployResult {
  projectId: string;
  releaseNumber: number;
  slot: DeploySlot;
  /** Real URL where the slot serves the release. */
  url: string;
  /** ISO timestamp at which the slot became ready. */
  startedAt: string;
  /** Local provider details (null on remote providers). */
  pid: number | null;
  logFile: string | null;
}

/** Reality-checked state of one slot. */
export interface SlotStatus {
  slot: DeploySlot;
  /**
   * `running` only when the slot's process is alive AND is ours (pidfile +
   * live-process + command check). An orphaned pidfile (process died) reports
   * `stopped` — with the stale `releaseNumber` kept for diagnosis.
   */
  state: "running" | "stopped";
  /** Active release when running; last known release on an orphaned pidfile. */
  releaseNumber: number | null;
  url: string | null;
  pid: number | null;
  /** Real HTTP probe of `url` (only meaningful when `state` is `running`). */
  healthy: boolean;
  startedAt: string | null;
}

export interface DeployProvider {
  /**
   * Produces (or reuses) the immutable build of `releaseNumber` from the
   * generated repo at `gitTag`. Never touches the repo's working tree.
   */
  buildRelease(projectId: string, releaseNumber: number, gitTag: string): Promise<BuildResult>;

  /**
   * Activates the sealed build of `releaseNumber` on `slot` and waits for
   * readiness. Replaces the slot's previous process if it is one of ours;
   * fails loudly if the port is held by a foreign process (never kills it).
   * Rollback = `deploy(previousReleaseNumber, slot)`.
   */
  deploy(projectId: string, releaseNumber: number, slot: DeploySlot): Promise<DeployResult>;

  /** Stops the slot's process if it is ours. Idempotent. */
  stop(projectId: string, slot: DeploySlot): Promise<void>;

  /** Reality-checked status of every slot of the project. */
  status(projectId: string): Promise<SlotStatus[]>;
}
