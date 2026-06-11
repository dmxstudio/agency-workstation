import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is used only to GENERATE SQL migrations from `src/db/schema.ts`
 * (`npx drizzle-kit generate`). Applying them is done programmatically by
 * `scripts/migrate.ts` (`npm run db:migrate`), which works with both drivers
 * (PGlite by default, `pg` when DATABASE_URL is set).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  strict: true,
  verbose: true,
});
