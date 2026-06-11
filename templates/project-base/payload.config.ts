import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildConfig } from "payload";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
// NOTE: explicit .ts extensions so `payload run` (tsx CJS loader) can resolve
// these imports; Next/Turbopack handles them via allowImportingTsExtensions.
import { siteConfig } from "./site.config.ts";
import { baseCollections } from "./src/lib/payload/base-collections.ts";
import { generatedCollections } from "./src/collections/index.ts";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(dirname, ".data");
fs.mkdirSync(dataDir, { recursive: true });

/**
 * Payload 3.x embedded config — SQLite file driver, zero external servers.
 * Collections = base template collections (users, pages) + the codegen-owned
 * set exported from src/collections (regenerated from the `cms.collections`
 * spec artifact).
 */
export default buildConfig({
  secret: process.env.PAYLOAD_SECRET ?? `${siteConfig.slug}-local-dev-secret`,
  db: sqliteAdapter({
    client: {
      url: `file:${path.join(dataDir, "site.db")}`,
    },
  }),
  admin: {
    user: "users",
    meta: { titleSuffix: ` — ${siteConfig.name}` },
  },
  collections: [...baseCollections, ...generatedCollections],
  typescript: {
    outputFile: path.resolve(dirname, "src/payload-types.ts"),
  },
});
