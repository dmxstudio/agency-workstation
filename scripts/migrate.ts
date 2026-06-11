/**
 * Applies committed SQL migrations from `src/db/migrations/` to the database.
 *
 * Driver selection mirrors `src/db/client.ts`:
 * - `DATABASE_URL` set → real Postgres via `pg`.
 * - Otherwise → embedded PGlite persisting to `./.data/pglite`.
 *
 * To create a new migration after changing `src/db/schema.ts`:
 *   npx drizzle-kit generate
 * then commit the generated files and run `npm run db:migrate`.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

// tsx does not auto-load env files; mimic Next.js (.env.local wins over .env).
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const migrationsFolder = path.join(root, "src", "db", "migrations");

async function main(): Promise<void> {
  if (!existsSync(migrationsFolder)) {
    throw new Error(
      `Migrations folder not found: ${migrationsFolder}. Run \`npx drizzle-kit generate\` first.`,
    );
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await migrate(drizzle(pool), { migrationsFolder });
    } finally {
      await pool.end();
    }
    console.log("Migrations applied (driver: pg, DATABASE_URL).");
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // PGlite es mono-proceso: el lock evita corromper la DB si el dev server
    // (u otro script) la tiene abierta (ver src/db/pglite-lock.ts).
    const { acquirePgliteLock } = await import("../src/db/pglite-lock");

    const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(root, ".data", "pglite");
    acquirePgliteLock(dataDir);
    mkdirSync(dataDir, { recursive: true });
    const client = new PGlite(dataDir);
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client.close();
    }
    console.log(`Migrations applied (driver: PGlite, dataDir: ${dataDir}).`);
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
