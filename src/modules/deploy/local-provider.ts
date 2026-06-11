import { execFile, spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { DeployDomainError } from "./errors";
import {
  BUILD_MARKER_FILENAME,
  getBuildMarkerPath,
  getProjectDeployDir,
  getProjectRepoDir,
  getReleaseBuildDir,
  getSlotLogPath,
  getSlotPidfilePath,
  getSlotPort,
  getSlotUrl,
  getTemplateDir,
} from "./paths";
import {
  DEPLOY_SLOTS,
  type BuildResult,
  type DeployProvider,
  type DeployResult,
  type DeploySlot,
  type SlotStatus,
} from "./provider";

const execFileAsync = promisify(execFile);

/**
 * LOCAL DeployProvider (§7.8 resolved locally, same adapter pattern as auth
 * §18.6 — Vercel will implement the SAME interface later).
 *
 * - `buildRelease` exports the generated repo at the release tag with
 *   `git archive` (the repo's working tree is NEVER touched) into
 *   `.data/deploys/<projectId>/builds/release-<N>/`, reuses `node_modules`
 *   via APFS clonefile (repo first, template as fallback — same trick as
 *   scripts/e2e-studio.ts) or `npm ci` as a last resort, then runs the
 *   template's proven pipeline: `generate:types` → `seed` → `next build`.
 *   The build is sealed with a marker file and never rebuilt.
 * - CONTENT SEMANTICS (MVP local): each build carries its own SQLite DB
 *   (`.data/site.db`) seeded from the fixtures sealed in the release tag —
 *   the content lives in the project, not in the platform. Edits made through
 *   the slot's Payload admin persist only within that build dir; shared
 *   per-project Postgres is the post-local story (§16).
 * - `deploy` runs the sealed build with a detached `next start -p <port>`
 *   (production 4100 / preview 4200, env-overridable), waits for HTTP
 *   readiness and registers a pidfile. It only ever replaces processes IT
 *   registered: an orphaned pidfile is cleaned up, a foreign process on the
 *   port is a loud error — never killed.
 * - `stop`/`status` check reality (live pid + `ps` command + HTTP probe),
 *   not just persisted files. Rollback is `deploy(previousRelease, slot)`.
 * - No platform-DB access anywhere in this file (recording deployments is
 *   the caller's job).
 */

const READINESS_TIMEOUT_MS = 60_000;
const STOP_SIGTERM_WAIT_MS = 8_000;

/** Pidfile payload — JSON persisted at `.data/deploys/<projectId>/<slot>.pid`. */
interface SlotPidfile {
  pid: number;
  projectId: string;
  slot: DeploySlot;
  releaseNumber: number;
  port: number;
  url: string;
  buildDir: string;
  startedAt: string;
}

/** Build marker payload — JSON at `<buildDir>/.deploy-build.json`. */
interface BuildMarker {
  projectId: string;
  releaseNumber: number;
  gitTag: string;
  commit: string;
  builtAt: string;
  durationMs: number;
  nodeModulesSource: "repo" | "template" | "npm-ci";
}

// ---------------------------------------------------------------------------
// Small process/fs helpers
// ---------------------------------------------------------------------------

/** Env for child processes: NODE_ENV must not leak into the generated site. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete (env as Record<string, string | undefined>).NODE_ENV;
  return env;
}

async function run(
  cwd: string,
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    cwd,
    env: childEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function runGit(repoDir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DeployDomainError(
      "GIT_FAILED",
      `Fallo de git en el repo del proyecto (git ${args.join(" ")}).`,
      detail,
    );
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means "alive but not ours to signal" — treat as alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Command line of a live process, or null if it does not exist. */
async function pidCommand(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    const command = stdout.trim();
    return command === "" ? null : command;
  } catch {
    return null;
  }
}

/** Working directory of a live process (lsof), or null when unknown. */
async function pidCwd(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    const line = stdout.split("\n").find((entry) => entry.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

function safeRealpath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * Guard against pid reuse: the pid must still be OUR slot server. `next start`
 * replaces its argv with `next-server (vX.Y.Z)` — the port is not visible in
 * `ps` — so identity is pinned by the process's cwd being our build dir. The
 * explicit `next … start -p <port>` command (pre-exec window) also counts.
 */
async function isOurServerProcess(
  pid: number,
  port: number,
  buildDir: string,
): Promise<boolean> {
  if (!isPidAlive(pid)) return false;
  const command = await pidCommand(pid);
  if (!command || !command.includes("next")) return false;
  if (command.includes(`-p ${port}`)) return true;
  const cwd = await pidCwd(pid);
  return cwd != null && safeRealpath(cwd) === safeRealpath(buildDir);
}

/** TCP probe: true when something is listening on 127.0.0.1:<port>. */
function isPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 1_000 });
    const done = (occupied: boolean) => {
      socket.destroy();
      resolve(occupied);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function fetchStatus(url: string, timeoutMs: number): Promise<number | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    // Drain so the socket is released.
    await response.arrayBuffer().catch(() => undefined);
    return response.status;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * SIGTERM to the whole process group (detached children are group leaders),
 * SIGKILL after a grace period. Only ever called on pids WE registered.
 */
async function killProcessGroup(pid: number): Promise<void> {
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        /* already gone */
      }
    }
  };
  signalGroup("SIGTERM");
  const deadline = Date.now() + STOP_SIGTERM_WAIT_MS;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return;
    await sleep(200);
  }
  signalGroup("SIGKILL");
  const killDeadline = Date.now() + 2_000;
  while (Date.now() < killDeadline) {
    if (!isPidAlive(pid)) return;
    await sleep(100);
  }
  throw new DeployDomainError(
    "STOP_FAILED",
    `El proceso ${pid} del slot no terminó tras SIGTERM/SIGKILL.`,
  );
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function tail(text: string, lines: number): string {
  return text.split("\n").slice(-lines).join("\n");
}

// ---------------------------------------------------------------------------
// Local provider
// ---------------------------------------------------------------------------

export class LocalDeployProvider implements DeployProvider {
  async buildRelease(
    projectId: string,
    releaseNumber: number,
    gitTag: string,
  ): Promise<BuildResult> {
    const start = performance.now();
    const repoDir = getProjectRepoDir(projectId);
    if (!existsSync(path.join(repoDir, ".git"))) {
      throw new DeployDomainError(
        "PROJECT_REPO_NOT_FOUND",
        `El proyecto ${projectId} no tiene repo generado en ${repoDir}. Genera el proyecto primero.`,
      );
    }

    let commit: string;
    try {
      commit = await runGit(repoDir, ["rev-parse", "--verify", `refs/tags/${gitTag}^{commit}`]);
    } catch (error) {
      throw new DeployDomainError(
        "TAG_NOT_FOUND",
        `El tag «${gitTag}» no existe en el repo del proyecto ${projectId}.`,
        error instanceof DeployDomainError ? error.details : error,
      );
    }

    const buildDir = getReleaseBuildDir(projectId, releaseNumber);
    const markerPath = getBuildMarkerPath(projectId, releaseNumber);

    // Immutable build: a sealed build is never rebuilt.
    const sealed = readJsonFile<BuildMarker>(markerPath);
    if (sealed) {
      if (sealed.commit !== commit) {
        throw new DeployDomainError(
          "BUILD_FAILED",
          `El build sellado de release-${releaseNumber} apunta al commit ${sealed.commit.slice(0, 12)}…, ` +
            `pero el tag «${gitTag}» apunta ahora a ${commit.slice(0, 12)}…. ` +
            `Los releases son inmutables: no muevas tags de release.`,
        );
      }
      return {
        projectId,
        releaseNumber,
        gitTag,
        commit,
        buildDir,
        reused: true,
        builtAt: sealed.builtAt,
        durationMs: Math.round(performance.now() - start),
      };
    }

    // Build dir without marker = interrupted build → rebuild from scratch.
    rmSync(buildDir, { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });

    try {
      // Export the tag WITHOUT touching the repo's working tree.
      const tarPath = path.join(
        getProjectDeployDir(projectId),
        `.release-${releaseNumber}.tar`,
      );
      await runGit(repoDir, ["archive", "--format=tar", "-o", tarPath, gitTag]);
      try {
        await run(buildDir, "tar", ["-xf", tarPath]);
      } finally {
        rmSync(tarPath, { force: true });
      }

      const nodeModulesSource = await this.ensureNodeModules(buildDir, repoDir);

      // Same proven pipeline (and order) as scripts/e2e-studio.ts.
      await this.runBuildStep(buildDir, "npm run generate:types", ["run", "generate:types"]);
      // The build's own SQLite DB, seeded from the fixtures sealed in the tag.
      await this.runBuildStep(buildDir, "npm run seed", ["run", "seed"]);
      await this.runBuildStep(buildDir, "npm run build", ["run", "build"]);

      const builtAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - start);
      const marker: BuildMarker = {
        projectId,
        releaseNumber,
        gitTag,
        commit,
        builtAt,
        durationMs,
        nodeModulesSource,
      };
      writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");

      return {
        projectId,
        releaseNumber,
        gitTag,
        commit,
        buildDir,
        reused: false,
        builtAt,
        durationMs,
      };
    } catch (error) {
      // Leave no half-built directory pretending to be a release.
      rmSync(buildDir, { recursive: true, force: true });
      throw error;
    }
  }

  async deploy(
    projectId: string,
    releaseNumber: number,
    slot: DeploySlot,
  ): Promise<DeployResult> {
    const buildDir = getReleaseBuildDir(projectId, releaseNumber);
    const marker = readJsonFile<BuildMarker>(getBuildMarkerPath(projectId, releaseNumber));
    if (!marker) {
      throw new DeployDomainError(
        "BUILD_NOT_FOUND",
        `No existe build sellado de release-${releaseNumber} para ${projectId}. Ejecuta buildRelease primero.`,
      );
    }

    const port = getSlotPort(slot);
    const url = getSlotUrl(slot);

    // Replace OUR previous slot process (redeploy/rollback); never foreign ones.
    await this.stop(projectId, slot);
    if (await isPortOccupied(port)) {
      throw new DeployDomainError(
        "PORT_IN_USE",
        `El puerto ${port} del slot ${slot} está ocupado por un proceso ajeno ` +
          `(no registrado por el deploy provider). Libéralo manualmente o cambia ` +
          `${slot === "production" ? "DEPLOY_PROD_PORT" : "DEPLOY_PREVIEW_PORT"}; ` +
          `la plataforma nunca mata procesos que no arrancó.`,
      );
    }

    // The slot's content DB: seed once from the release fixtures if missing
    // (it normally exists — buildRelease seeds it before `next build`).
    if (!existsSync(path.join(buildDir, ".data", "site.db"))) {
      await this.runBuildStep(buildDir, "npm run seed", ["run", "seed"]);
    }

    const nextBin = path.join(buildDir, "node_modules", ".bin", "next");
    if (!existsSync(nextBin)) {
      throw new DeployDomainError(
        "DEPLOY_FAILED",
        `El build de release-${releaseNumber} no tiene node_modules/.bin/next; el build está corrupto.`,
      );
    }

    const logFile = getSlotLogPath(projectId, slot);
    mkdirSync(path.dirname(logFile), { recursive: true });
    appendFileSync(
      logFile,
      `\n--- deploy ${new Date().toISOString()} release-${releaseNumber} slot=${slot} port=${port} ---\n`,
      "utf8",
    );

    const logFd = openSync(logFile, "a");
    let child;
    try {
      child = spawn(nextBin, ["start", "-p", String(port)], {
        cwd: buildDir,
        env: childEnv(),
        detached: true,
        stdio: ["ignore", logFd, logFd],
      });
    } finally {
      closeSync(logFd);
    }
    child.on("error", () => {
      /* surfaced below via readiness timeout */
    });
    child.unref();
    const pid = child.pid;
    if (pid == null) {
      throw new DeployDomainError(
        "DEPLOY_FAILED",
        `No se pudo arrancar next start para el slot ${slot}.`,
      );
    }

    const startedAt = new Date().toISOString();
    const pidfile: SlotPidfile = {
      pid,
      projectId,
      slot,
      releaseNumber,
      port,
      url,
      buildDir,
      startedAt,
    };
    // Written BEFORE readiness so an interrupted deploy can still be stopped.
    writeFileSync(
      getSlotPidfilePath(projectId, slot),
      `${JSON.stringify(pidfile, null, 2)}\n`,
      "utf8",
    );

    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      if (!isPidAlive(pid)) break;
      const status = await fetchStatus(url, 1_500);
      if (status != null) {
        ready = true;
        break;
      }
      await sleep(400);
    }
    if (!ready) {
      await killProcessGroup(pid).catch(() => undefined);
      rmSync(getSlotPidfilePath(projectId, slot), { force: true });
      const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
      throw new DeployDomainError(
        "READINESS_TIMEOUT",
        `El slot ${slot} (release-${releaseNumber}) no respondió en ${url} ` +
          `tras ${Math.round(READINESS_TIMEOUT_MS / 1000)} s.`,
        tail(log, 40),
      );
    }

    return {
      projectId,
      releaseNumber,
      slot,
      url,
      startedAt,
      pid,
      logFile,
    };
  }

  async stop(projectId: string, slot: DeploySlot): Promise<void> {
    const pidfilePath = getSlotPidfilePath(projectId, slot);
    const pidfile = readJsonFile<SlotPidfile>(pidfilePath);
    if (!pidfile) {
      // Missing or corrupt pidfile → nothing of ours is (knowably) running.
      rmSync(pidfilePath, { force: true });
      return;
    }
    if (!(await isOurServerProcess(pidfile.pid, pidfile.port, pidfile.buildDir))) {
      // Orphaned pidfile (process died) or pid reused by a FOREIGN process:
      // clean our record, never signal a process we did not register.
      unlinkSync(pidfilePath);
      return;
    }
    await killProcessGroup(pidfile.pid);
    rmSync(pidfilePath, { force: true });
  }

  async status(projectId: string): Promise<SlotStatus[]> {
    return Promise.all(
      DEPLOY_SLOTS.map(async (slot): Promise<SlotStatus> => {
        const pidfile = readJsonFile<SlotPidfile>(getSlotPidfilePath(projectId, slot));
        if (!pidfile) {
          return {
            slot,
            state: "stopped",
            releaseNumber: null,
            url: null,
            pid: null,
            healthy: false,
            startedAt: null,
          };
        }
        if (!(await isOurServerProcess(pidfile.pid, pidfile.port, pidfile.buildDir))) {
          // Orphaned pidfile: the process died (or the pid was reused). Keep
          // the last known release for diagnosis; reality says "stopped".
          return {
            slot,
            state: "stopped",
            releaseNumber: pidfile.releaseNumber,
            url: null,
            pid: null,
            healthy: false,
            startedAt: null,
          };
        }
        const status = await fetchStatus(pidfile.url, 2_000);
        return {
          slot,
          state: "running",
          releaseNumber: pidfile.releaseNumber,
          url: pidfile.url,
          pid: pidfile.pid,
          healthy: status != null && status >= 200 && status < 500,
          startedAt: pidfile.startedAt,
        };
      }),
    );
  }

  // -------------------------------------------------------------------------

  /**
   * node_modules for the build: APFS clonefile from the generated repo (its
   * own install), else from the template, else `npm ci` (slow path).
   */
  private async ensureNodeModules(
    buildDir: string,
    repoDir: string,
  ): Promise<BuildMarker["nodeModulesSource"]> {
    const target = path.join(buildDir, "node_modules");
    const candidates: { source: string; label: BuildMarker["nodeModulesSource"] }[] = [
      { source: path.join(repoDir, "node_modules"), label: "repo" },
      { source: path.join(getTemplateDir(), "node_modules"), label: "template" },
    ];
    for (const candidate of candidates) {
      if (!existsSync(path.join(candidate.source, ".bin", "next"))) continue;
      try {
        // APFS clonefile: copy-on-write, ~1 s for 700+ MB.
        await run(buildDir, "cp", ["-cR", candidate.source, target]);
      } catch {
        rmSync(target, { recursive: true, force: true });
        await run(buildDir, "cp", ["-R", candidate.source, target]);
      }
      if (existsSync(path.join(target, ".bin", "next"))) return candidate.label;
      rmSync(target, { recursive: true, force: true });
    }
    await this.runBuildStep(buildDir, "npm ci", ["ci", "--no-audit", "--no-fund"]);
    if (!existsSync(path.join(target, ".bin", "next"))) {
      throw new DeployDomainError(
        "DEPENDENCIES_UNAVAILABLE",
        "No se pudieron preparar las dependencias del build (ni clonefile ni npm ci dejaron node_modules/.bin/next).",
      );
    }
    return "npm-ci";
  }

  private async runBuildStep(buildDir: string, label: string, npmArgs: string[]): Promise<void> {
    try {
      await run(buildDir, "npm", npmArgs);
    } catch (error) {
      const raw =
        error instanceof Error
          ? `${error.message}\n${(error as Error & { stderr?: string }).stderr ?? ""}`
          : String(error);
      throw new DeployDomainError(
        "BUILD_FAILED",
        `Falló «${label}» dentro del build (${buildDir}).`,
        tail(raw, 40),
      );
    }
  }
}

/** Constant marker filename re-export so callers can introspect builds. */
export { BUILD_MARKER_FILENAME };
