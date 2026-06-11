/**
 * Smoke del lock de proceso único de PGlite (src/db/pglite-lock.ts).
 *
 * Aislado: usa un dataDir temporal vía PGLITE_DATA_DIR y se limpia solo.
 * NO toca ./.data/pglite — es seguro correrlo con el dev server vivo.
 *
 * Casos:
 *  1. holder abre PGlite → lockfile escrito con pid vivo.
 *  2. contender en proceso aparte → falla con el error claro en español.
 *  3. SIGKILL al holder (sin cleanup) → lock huérfano queda en disco.
 *  4. contender de nuevo → limpia el huérfano, abre, consulta y al salir
 *     borra su propio lock. (Incluye re-entrancia: getDb() dos veces.)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");

let failures = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Dentro del repo (node_modules/.cache) para que los scripts hijos resuelvan
// drizzle-orm y compañía; gitignored y se limpia al final igualmente.
const cacheBase = path.join(root, "node_modules", ".cache");
mkdirSync(cacheBase, { recursive: true });
const tmp = mkdtempSync(path.join(cacheBase, "aw-pglite-lock-"));
const dataDir = path.join(tmp, "pglite");
const lockPath = `${dataDir}.lock`;

const env: NodeJS.ProcessEnv = { ...process.env, PGLITE_DATA_DIR: dataDir };
delete env.DATABASE_URL;

const importClient = `import { getDb } from ${JSON.stringify(path.join(root, "src", "db", "client"))};`;

const holderScript = path.join(tmp, "holder.ts");
writeFileSync(
  holderScript,
  `import { sql } from "drizzle-orm";
${importClient}
async function main() {
  await getDb().execute(sql\`select 1\`);
  console.log("HOLDER_READY");
  setInterval(() => {}, 1000); // vivo hasta que lo maten
}
main().catch((error) => { console.error(error); process.exit(1); });
`,
);

const contenderScript = path.join(tmp, "contender.ts");
writeFileSync(
  contenderScript,
  `import { sql } from "drizzle-orm";
${importClient}
async function main() {
  const db = getDb();
  getDb(); // re-entrancia en el mismo proceso: no debe chocar con su propio lock
  await db.execute(sql\`select 1\`);
  console.log("CONTENDER_OK");
}
main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
);

function readLockPid(): number | null {
  try {
    return (JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number }).pid;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  console.log(`smoke-pglite-lock (dataDir aislado: ${dataDir})`);

  // --- 1. holder abre PGlite y escribe el lock ------------------------------
  const holder = spawn(tsxBin, [holderScript], { env, detached: true, stdio: "pipe" });
  let holderOut = "";
  holder.stdout.on("data", (chunk: Buffer) => (holderOut += chunk.toString()));
  holder.stderr.on("data", (chunk: Buffer) => (holderOut += chunk.toString()));

  const deadline = Date.now() + 90_000;
  while (!holderOut.includes("HOLDER_READY") && Date.now() < deadline && holder.exitCode === null) {
    await sleep(200);
  }
  check(holderOut.includes("HOLDER_READY"), "holder abre PGlite en el dataDir aislado", holderOut.slice(0, 300));
  const lockPid = readLockPid();
  check(lockPid != null && lockPid !== process.pid && pidAlive(lockPid), "lockfile escrito con pid vivo de otro proceso");

  // --- 2. contender concurrente → error claro, sin abrir --------------------
  const blocked = spawnSync(tsxBin, [contenderScript], { env, encoding: "utf8", timeout: 90_000 });
  check(blocked.status !== 0, "contender concurrente sale con código de error");
  const blockedOutput = `${blocked.stdout}${blocked.stderr}`;
  check(
    blockedOutput.includes("PGlite ya está abierto por el proceso") &&
      blockedOutput.includes(String(lockPid)),
    "el error nombra el pid del proceso que tiene la DB",
    blockedOutput.slice(0, 300),
  );
  check(!blockedOutput.includes("CONTENDER_OK"), "el contender bloqueado nunca llegó a consultar");

  // --- 3. SIGKILL al holder → lock huérfano ---------------------------------
  try {
    process.kill(-holder.pid!, "SIGKILL"); // grupo entero (tsx puede re-spawnear node)
  } catch {
    holder.kill("SIGKILL");
  }
  const killDeadline = Date.now() + 15_000;
  while (lockPid != null && pidAlive(lockPid) && Date.now() < killDeadline) {
    await sleep(200);
  }
  check(lockPid != null && !pidAlive(lockPid), "holder muerto tras SIGKILL");
  check(existsSync(lockPath), "el lock huérfano queda en disco (SIGKILL no emite exit)");

  // --- 4. contender tras el crash → limpia huérfano, abre y se limpia -------
  const recovered = spawnSync(tsxBin, [contenderScript], { env, encoding: "utf8", timeout: 90_000 });
  check(recovered.status === 0, "contender tras el crash abre la DB", `${recovered.stdout}${recovered.stderr}`.slice(0, 300));
  check(`${recovered.stdout}`.includes("CONTENDER_OK"), "consulta ejecutada tras limpiar el huérfano");
  check(!existsSync(lockPath), "el lock se borra al salir el proceso que lo escribió");

  if (failures > 0) {
    throw new Error(`${failures} asserts fallidos`);
  }
  console.log("smoke-pglite-lock: todo verde (9 asserts)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
