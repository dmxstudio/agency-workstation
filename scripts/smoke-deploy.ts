/**
 * Smoke test of the LOCAL DeployProvider (§7.8 resolved locally): immutable
 * release builds + preview/production slots + reality-checked status.
 *
 * PREREQUISITE: a generated demo project in `.data/projects/<projectId>/`
 * (a git repo with node_modules installed). If you don't have one:
 *
 *   npm run db:migrate && npm run db:seed
 *   npx tsx scripts/e2e-studio.ts     # generates + installs the demo repo
 *
 * What it does, in order (no platform-DB access anywhere — the provider is
 * pure filesystem/processes; recording deployments is the review module's
 * job in the next phase):
 *  1. Picks the demo repo, tags `release-1` at HEAD if the tag is missing.
 *  2. `buildRelease` → immutable build under `.data/deploys/<id>/builds/`,
 *     sealed by a marker file; a second call REUSES it (never rebuilds).
 *  3. Orphan robustness: a pidfile whose process died reports `stopped`.
 *  4. `deploy(preview)` → detached `next start` on the preview port
 *     (DEPLOY_PREVIEW_PORT, default 4200), HTTP 200, section anchors
 *     (`<section id="<blockId>"`) present in the served HTML.
 *  5. Redeploy replaces OUR previous slot process (same mechanism as
 *     rollback: rollback = deploy of the previous release).
 *  6. `stop` → status `stopped`, port released.
 *  7. A FOREIGN process on the slot port → clear `PORT_IN_USE` error and the
 *     foreign process is never killed.
 *
 * Every process started here is killed before exit (finally block).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

import {
  isDeployDomainError,
  LocalDeployProvider,
  getBuildMarkerPath,
  getReleaseBuildDir,
  getSlotPidfilePath,
  getSlotPort,
} from "../src/modules/deploy";
import { getProjectsBaseDir } from "../src/modules/generator/paths";

const RELEASE_TAG = "release-1";
const RELEASE_NUMBER = 1;

let passed = 0;
function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`ASSERT FAIL: ${label}`);
  passed += 1;
  console.log(`  ok - ${label}`);
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  console.log(`  (${label}: ${Math.round(performance.now() - start)} ms)`);
  return result;
}

async function fetchOk(url: string, timeoutMs = 5_000): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function git(repoDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
}

/** Demo repo = newest `prj_*` git repo under `.data/projects/`. */
function findDemoProject(): string {
  const baseDir = getProjectsBaseDir();
  const candidates = existsSync(baseDir)
    ? readdirSync(baseDir)
        .filter((name) => name.startsWith("prj_"))
        .map((name) => path.join(baseDir, name))
        .filter((dir) => existsSync(path.join(dir, ".git")))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (candidates.length === 0) {
    throw new Error(
      `No hay proyecto demo generado en ${baseDir}. Prerequisito:\n` +
        "  npm run db:migrate && npm run db:seed\n" +
        "  npx tsx scripts/e2e-studio.ts",
    );
  }
  return path.basename(candidates[0]);
}

async function main(): Promise<void> {
  const provider = new LocalDeployProvider();
  const projectId = findDemoProject();
  const repoDir = path.join(getProjectsBaseDir(), projectId);
  console.log(`Proyecto demo: ${projectId}\nRepo: ${repoDir}\n`);

  // Clean slate: stop anything OURS left over from a previous interrupted run.
  await provider.stop(projectId, "preview");
  await provider.stop(projectId, "production");

  try {
    // --- 1. Release tag ------------------------------------------------------
    console.log(`# 1. Tag del release (${RELEASE_TAG})`);
    const existingTag = git(repoDir, ["tag", "-l", RELEASE_TAG]);
    if (existingTag === "") {
      git(repoDir, ["tag", RELEASE_TAG]);
      console.log(`  (tag ${RELEASE_TAG} creado en HEAD)`);
    } else {
      console.log(`  (tag ${RELEASE_TAG} ya existía)`);
    }
    const tagCommit = git(repoDir, ["rev-parse", `${RELEASE_TAG}^{commit}`]);
    assert(tagCommit.length === 40, "el tag del release resuelve a un commit");

    // --- 2. Build inmutable ---------------------------------------------------
    console.log("\n# 2. buildRelease: build inmutable del tag");
    const dirty = git(repoDir, ["status", "--porcelain"]);
    const build = await timed("buildRelease", () =>
      provider.buildRelease(projectId, RELEASE_NUMBER, RELEASE_TAG),
    );
    assert(build.commit === tagCommit, "el build sella el commit exacto del tag");
    assert(
      build.buildDir === getReleaseBuildDir(projectId, RELEASE_NUMBER) &&
        existsSync(path.join(build.buildDir, ".next")) &&
        existsSync(path.join(build.buildDir, ".data", "site.db")),
      "build con .next y .data/site.db (seed sellado del release) en .data/deploys/",
    );
    assert(
      existsSync(getBuildMarkerPath(projectId, RELEASE_NUMBER)),
      "marker file presente: el build queda sellado",
    );
    assert(
      git(repoDir, ["status", "--porcelain"]) === dirty,
      "el working tree del repo generado quedó intacto (git archive, no checkout)",
    );

    const rebuild = await timed("buildRelease (2ª vez)", () =>
      provider.buildRelease(projectId, RELEASE_NUMBER, RELEASE_TAG),
    );
    assert(
      rebuild.reused && rebuild.commit === tagCommit,
      "un release ya sellado se REUSA, nunca se reconstruye (inmutabilidad)",
    );

    // --- 3. Pidfile huérfano --------------------------------------------------
    console.log("\n# 3. Robustez: pidfile huérfano → stopped");
    const deadPid = Number(
      execFileSync("sh", ["-c", "true & echo $!"], { encoding: "utf8" }).trim(),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeFileSync(
      getSlotPidfilePath(projectId, "preview"),
      JSON.stringify({
        pid: deadPid,
        projectId,
        slot: "preview",
        releaseNumber: RELEASE_NUMBER,
        port: getSlotPort("preview"),
        url: `http://localhost:${getSlotPort("preview")}`,
        buildDir: build.buildDir,
        startedAt: new Date().toISOString(),
      }),
      "utf8",
    );
    const orphanStatus = await provider.status(projectId);
    const orphanPreview = orphanStatus.find((slot) => slot.slot === "preview");
    assert(
      orphanPreview?.state === "stopped" &&
        orphanPreview.pid === null &&
        orphanPreview.releaseNumber === RELEASE_NUMBER,
      "proceso muerto con pidfile → estado stopped (release conocido, pid null)",
    );

    // --- 4. Deploy al slot preview ---------------------------------------------
    console.log("\n# 4. deploy(preview): next start detached + readiness");
    const deploy1 = await timed("deploy(preview)", () =>
      provider.deploy(projectId, RELEASE_NUMBER, "preview"),
    );
    assert(
      deploy1.url === `http://localhost:${getSlotPort("preview")}`,
      `deploy devuelve la url del slot preview (${deploy1.url})`,
    );
    const html = await fetchOk(deploy1.url);
    assert(html != null, `GET ${deploy1.url} responde 200`);
    assert(
      /<section id="/.test(html ?? ""),
      "el HTML servido lleva anclas de sección (id de bloque Puck en la raíz, §7.7)",
    );

    const runningStatus = await provider.status(projectId);
    const runningPreview = runningStatus.find((slot) => slot.slot === "preview");
    const idleProduction = runningStatus.find((slot) => slot.slot === "production");
    assert(
      runningPreview?.state === "running" &&
        runningPreview.healthy &&
        runningPreview.releaseNumber === RELEASE_NUMBER &&
        runningPreview.pid === deploy1.pid,
      "status(preview) = running + healthy + release activo (probe real, no solo pidfile)",
    );
    assert(idleProduction?.state === "stopped", "status(production) = stopped (slot sin uso)");

    // --- 5. Redeploy = mismo mecanismo que rollback -----------------------------
    console.log("\n# 5. Redeploy del slot (mecanismo de rollback)");
    const deploy2 = await timed("deploy(preview) de nuevo", () =>
      provider.deploy(projectId, RELEASE_NUMBER, "preview"),
    );
    assert(
      deploy2.pid !== deploy1.pid,
      "el redeploy para el proceso previo del slot y arranca uno nuevo",
    );
    let oldAlive = true;
    try {
      process.kill(deploy1.pid as number, 0);
    } catch {
      oldAlive = false;
    }
    assert(!oldAlive, "el proceso anterior del slot quedó terminado");
    assert((await fetchOk(deploy2.url)) != null, "el slot sigue sirviendo 200 tras el redeploy");

    // --- 6. Stop ----------------------------------------------------------------
    console.log("\n# 6. stop(preview)");
    await provider.stop(projectId, "preview");
    const stoppedStatus = await provider.status(projectId);
    const stoppedPreview = stoppedStatus.find((slot) => slot.slot === "preview");
    assert(stoppedPreview?.state === "stopped", "status(preview) = stopped tras stop");
    assert(
      (await fetchOk(deploy2.url, 1_500)) == null,
      "el puerto del slot dejó de responder (proceso terminado de verdad)",
    );

    // --- 7. Puerto ocupado por proceso ajeno -------------------------------------
    console.log("\n# 7. Robustez: puerto ocupado por proceso ajeno");
    const previewPort = getSlotPort("preview");
    const foreign = net.createServer();
    await new Promise<void>((resolve, reject) => {
      foreign.once("error", reject);
      foreign.listen(previewPort, "127.0.0.1", resolve);
    });
    try {
      let portError: unknown = null;
      try {
        await provider.deploy(projectId, RELEASE_NUMBER, "preview");
      } catch (error) {
        portError = error;
      }
      assert(
        isDeployDomainError(portError) && portError.code === "PORT_IN_USE",
        "deploy sobre un puerto ajeno falla con PORT_IN_USE (error claro)",
      );
      assert(foreign.listening, "el proceso ajeno sigue vivo: la plataforma NUNCA lo mata");
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }

    // --- Marker introspección -----------------------------------------------------
    const marker = JSON.parse(
      readFileSync(getBuildMarkerPath(projectId, RELEASE_NUMBER), "utf8"),
    ) as { gitTag: string; commit: string };
    assert(
      marker.gitTag === RELEASE_TAG && marker.commit === tagCommit,
      "el marker del build documenta tag y commit sellados",
    );

    console.log(`\nSMOKE DEPLOY OK — ${passed} asserts superados.`);
    console.log(
      `Build inmutable en ${getReleaseBuildDir(projectId, RELEASE_NUMBER)} (se reusa en próximas ejecuciones).`,
    );
  } finally {
    // Kill EVERYTHING this run started — no servers survive the smoke test.
    await provider.stop(projectId, "preview").catch(() => undefined);
    await provider.stop(projectId, "production").catch(() => undefined);
    rmSync(getSlotPidfilePath(projectId, "preview"), { force: true });
    rmSync(getSlotPidfilePath(projectId, "production"), { force: true });
    const final = await provider.status(projectId);
    if (final.every((slot) => slot.state === "stopped")) {
      console.log("(slots parados; ningún servidor queda corriendo)");
    } else {
      console.error("AVISO: algún slot sigue corriendo tras la limpieza", final);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSMOKE DEPLOY FAILED:", error);
    process.exit(1);
  });
