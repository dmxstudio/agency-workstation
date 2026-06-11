import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * Driver-agnostic DB factory.
 *
 * - `DATABASE_URL` set → real Postgres via `pg` Pool.
 * - Otherwise → embedded PGlite persisting to `./.data/pglite`.
 *
 * No other module may import a driver directly — always `getDb()` (CLAUDE.md).
 */

/** Driver-agnostic database handle (covers both `pg` and PGlite drivers). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const PGLITE_DATA_DIR = path.join(process.cwd(), ".data", "pglite");

/**
 * CRITICAL: the instance is cached on `globalThis` so it survives Next.js
 * dev-mode HMR, where this module can be re-evaluated many times. PGlite does
 * not tolerate multiple live instances over the same dataDir, and a fresh pg
 * Pool per reload leaks connections.
 */
const globalForDb = globalThis as typeof globalThis & {
  __agencyWorkstationDb?: Db;
};

function createDb(): Db {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    return drizzleNodePg(pool, { schema });
  }
  mkdirSync(PGLITE_DATA_DIR, { recursive: true });
  const client = new PGlite(PGLITE_DATA_DIR);
  return drizzlePglite(client, { schema });
}

export function getDb(): Db {
  if (!globalForDb.__agencyWorkstationDb) {
    globalForDb.__agencyWorkstationDb = createDb();
  }
  return globalForDb.__agencyWorkstationDb;
}

export { schema };
