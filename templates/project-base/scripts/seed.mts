/**
 * Seed: loads src/seed/content.json (codegen-owned fixtures) into the
 * embedded SQLite DB. Run with: npm run seed  (uses `payload run`).
 *
 * - Wipes and reloads `pages` and every collection present in the fixtures.
 * - Ensures one admin user exists (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).
 * - Resolves { "$seedRef": { collection, index } } placeholders inside page
 *   compositions to { collection, docId, ...snapshot } CMS bindings.
 *
 * NOTE (payload run + tsx traps, validated in spike §18.1):
 * - the script must be .mts with top-level await, or it dies silently;
 * - importing payload.config.ts double-wraps the default export — unwrap it.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getPayload, type CollectionSlug } from "payload";
import configModule from "../payload.config.ts";

const config = await (
  (configModule as unknown as { default?: unknown }).default ?? configModule
);

const dirname = path.dirname(fileURLToPath(import.meta.url));

type SeedRef = { $seedRef: { collection: string; index: number } };

type SeedBlock = { type: string; props: Record<string, unknown> };

type SeedPage = {
  title: string;
  path: string;
  description?: string;
  publish?: boolean;
  content: SeedBlock[];
};

type SeedContent = {
  collections: Record<string, Record<string, unknown>[]>;
  pages: SeedPage[];
};

const contentPath = path.resolve(dirname, "../src/seed/content.json");
const seed = JSON.parse(fs.readFileSync(contentPath, "utf8")) as SeedContent;

const payload = await getPayload({ config: config as never });

// --- admin user (kept across re-seeds) -------------------------------------
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-1234";
const existingAdmin = await payload.find({
  collection: "users",
  where: { email: { equals: adminEmail } },
  limit: 1,
});
if (existingAdmin.totalDocs === 0) {
  await payload.create({
    collection: "users",
    data: { email: adminEmail, password: adminPassword, name: "Admin" },
  });
  console.log(`  usuario admin creado: ${adminEmail}`);
} else {
  console.log(`  usuario admin ya existe: ${adminEmail}`);
}

// --- wipe + reload CMS collections and pages --------------------------------
const collectionSlugs = Object.keys(seed.collections) as CollectionSlug[];
for (const slug of ["pages" as CollectionSlug, ...collectionSlugs]) {
  await payload.delete({ collection: slug, where: { id: { exists: true } } });
}

const createdDocs: Record<string, Array<Record<string, unknown> & { id: string | number }>> =
  {};
for (const slug of collectionSlugs) {
  createdDocs[slug] = [];
  for (const data of seed.collections[slug]) {
    const doc = (await payload.create({ collection: slug, data: data as never })) as unknown as Record<
      string,
      unknown
    > & { id: string | number };
    createdDocs[slug].push(doc);
  }
  console.log(`  ${slug}: ${createdDocs[slug].length} documentos`);
}

// --- $seedRef resolution -----------------------------------------------------
const isSeedRef = (v: unknown): v is SeedRef =>
  typeof v === "object" && v !== null && "$seedRef" in (v as Record<string, unknown>);

function resolveRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolveRefs);
  if (typeof value !== "object" || value === null) return value;

  if (isSeedRef(value)) {
    const { collection, index } = value.$seedRef;
    const doc = createdDocs[collection]?.[index];
    if (!doc) {
      throw new Error(`$seedRef sin resolver: ${collection}[${index}]`);
    }
    const { id, createdAt: _c, updatedAt: _u, ...snapshot } = doc;
    return { collection, docId: id, ...snapshot };
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = resolveRefs(v);
  return out;
}

// --- pages -------------------------------------------------------------------
let totalBlocks = 0;
for (const page of seed.pages) {
  const data = {
    root: { props: { title: page.title, description: page.description ?? "" } },
    content: resolveRefs(page.content),
    zones: {},
  };
  await payload.create({
    collection: "pages",
    data: {
      title: page.title,
      path: page.path,
      puckData: data,
      publishedData: page.publish === false ? null : data,
    },
  });
  const count = JSON.stringify(data).match(/"type":/g)?.length ?? 0;
  totalBlocks += count;
  console.log(
    `  /${page.path.padEnd(12)} ${String(count).padStart(3)} bloques  [${
      page.publish === false ? "borrador" : "publicada"
    }]`
  );
}

console.log(
  `\nSeed OK: ${seed.pages.length} páginas (${totalBlocks} bloques) + ${collectionSlugs
    .map((s) => `${createdDocs[s].length} ${s}`)
    .join(" + ")}.`
);
process.exit(0);
