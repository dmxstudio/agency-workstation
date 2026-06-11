import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Guard de proceso único para PGlite.
 *
 * PGlite es mono-proceso: dos procesos vivos sobre el mismo dataDir abortan la
 * instancia WASM (`RuntimeError: Aborted()`) y pueden corromper el directorio
 * en disco. Este lock convierte ese escenario en un error claro ANTES de abrir.
 *
 * Semántica:
 * - Lockfile hermano del dataDir (`<dataDir>.lock`) con {pid, startedAt, cmd}.
 * - pid ajeno y VIVO  → error en español con instrucciones (no se abre nada).
 * - pid muerto        → lock huérfano (crash, kill -9): se limpia y se sigue.
 * - pid propio        → re-entrante (HMR de Next puede re-evaluar módulos).
 * - El lock se borra en `process.on("exit")` si lo escribió este proceso. Una
 *   terminación por señal sin handlers no emite "exit": el lock queda huérfano
 *   y lo limpia el siguiente arranque (chequeo de pid vivo).
 */

interface PgliteLockInfo {
  pid: number;
  startedAt: string;
  cmd: string;
}

export function pgliteLockPath(dataDir: string): string {
  return `${dataDir.replace(/[\\/]+$/, "")}.lock`;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = existe pero no es nuestro; cualquier otro código = no existe.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLockInfo(lockPath: string): PgliteLockInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<PgliteLockInfo>;
    if (typeof parsed.pid !== "number") return null;
    return {
      pid: parsed.pid,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "?",
      cmd: typeof parsed.cmd === "string" ? parsed.cmd : "?",
    };
  } catch {
    // Ilegible o inexistente: se trata como huérfano.
    return null;
  }
}

/**
 * Adquiere el lock del dataDir o lanza un error claro si otro proceso vivo lo
 * tiene. Llamar SIEMPRE antes de `new PGlite(dataDir)`.
 */
export function acquirePgliteLock(dataDir: string): void {
  const lockPath = pgliteLockPath(dataDir);

  if (existsSync(lockPath)) {
    const info = readLockInfo(lockPath);
    if (info && info.pid === process.pid) return; // re-entrante en este proceso
    if (info && isPidAlive(info.pid)) {
      throw new Error(
        `PGlite ya está abierto por el proceso ${info.pid} (${info.cmd}, desde ${info.startedAt}). ` +
          `PGlite es de un solo proceso: para el dev server (o el otro script) antes de tocar la DB. ` +
          `Si ese proceso ya no existe, borra ${lockPath} y reintenta.`,
      );
    }
    // pid muerto o lockfile ilegible: huérfano de un crash; se limpia.
    rmSync(lockPath, { force: true });
  }

  mkdirSync(path.dirname(lockPath), { recursive: true });
  const info: PgliteLockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cmd:
      process.title !== "node"
        ? process.title
        : process.argv
            .slice(0, 2)
            .map((part) => path.basename(part))
            .join(" "),
  };
  try {
    // "wx" = falla si aparece entre el existsSync y aquí (carrera improbable).
    writeFileSync(lockPath, JSON.stringify(info), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const winner = readLockInfo(lockPath);
      throw new Error(
        `PGlite ya está abierto por el proceso ${winner?.pid ?? "?"} (${winner?.cmd ?? "?"}). ` +
          `PGlite es de un solo proceso: para el otro proceso antes de tocar la DB.`,
      );
    }
    throw error;
  }

  process.once("exit", () => {
    const current = readLockInfo(lockPath);
    if (current?.pid === process.pid) {
      rmSync(lockPath, { force: true });
    }
  });
}
