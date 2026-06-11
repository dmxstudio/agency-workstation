import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generate } from "../src/generator";
import { regenerate } from "../src/regenerate";
import { specV1, specV2, specV3 } from "../src/fixtures";
import { sha256, parseManifest, MANIFEST_FILENAME } from "../src/ownership";
import { specArtifactsSchema } from "../src/schemas";
import type { Conflict } from "../src/conflicts";

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "spike-regen-"));
});
afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function read(rel: string): string {
  return readFileSync(join(outDir, rel), "utf8");
}
function write(rel: string, content: string): void {
  writeFileSync(join(outDir, rel), content, "utf8");
}
function treeHashes(dir: string, base = dir): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      for (const [k, v] of treeHashes(abs, base)) out.set(k, v);
    } else {
      out.set(abs.slice(base.length + 1), sha256(readFileSync(abs, "utf8")));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Write-time validation (platform rule: Zod on every write)
// ---------------------------------------------------------------------------

test("generate rejects spec payloads that fail the platform Zod schemas", () => {
  const broken = structuredClone(specV1) as Record<string, unknown>;
  (broken as typeof specV1).collections.collections[0]!.fields = [];
  assert.throws(() => generate(broken, outDir), /colección necesita al menos un campo|too_small|fields/i);
});

test("fixtures round-trip through the copied platform schemas unchanged", () => {
  const parsed = specArtifactsSchema.parse(specV1);
  assert.deepEqual(parsed, specV1);
});

// ---------------------------------------------------------------------------
// Generation: files, ownership manifest, markers
// ---------------------------------------------------------------------------

test("generate produces codegen files with @generated header and content hash", () => {
  generate(specV1, outDir);
  const posts = read("collections/posts.ts");
  assert.match(posts, /@generated/);
  const hash = posts.match(/content-hash: sha256:([a-f0-9]{64})/)?.[1];
  assert.ok(hash, "header carries a sha256");
  const body = posts.slice(posts.indexOf("*/") + 3); // body after header
  assert.equal(sha256(body), hash, "header hash matches the generated body");
});

test("generate writes an ownership manifest with correct owners", () => {
  generate(specV1, outDir);
  const manifest = parseManifest(read(MANIFEST_FILENAME));
  assert.equal(manifest.files["collections/posts.ts"]?.owner, "codegen");
  assert.equal(manifest.files["payload.config.ts"]?.owner, "codegen");
  assert.equal(manifest.files["app/blog/archivo/page.tsx"]?.owner, "codegen");
  assert.equal(manifest.files["compositions/page-home.json"]?.owner, "human");
  assert.equal(manifest.files["compositions/page-home.json"]?.contentHash, null);
});

test("generate refuses to overwrite an already-generated project", () => {
  generate(specV1, outDir);
  assert.throws(() => generate(specV1, outDir), /regenerate/);
});

test("sitemap pages without composition artifact get an empty human scaffold", () => {
  generate(specV1, outDir);
  const archivo = JSON.parse(read("compositions/page-archivo.json"));
  assert.deepEqual(archivo, { slug: "archivo", sections: [] });
});

// ---------------------------------------------------------------------------
// (a) Regeneration rewrites ONLY codegen zones
// ---------------------------------------------------------------------------

test("regenerate rewrites changed codegen files and leaves the rest unchanged", () => {
  generate(specV1, outDir);
  const result = regenerate(specV2, outDir);
  assert.ok(result.written.includes("collections/posts.ts"));
  assert.match(read("collections/posts.ts"), /heroImage/);
  assert.doesNotMatch(read("collections/posts.ts"), /subtitle/);
  // authors did not change between v1 and v2:
  assert.ok(result.unchanged.includes("collections/authors.ts"));
  // nothing human-owned ever shows up as written:
  assert.ok(result.written.every((f) => !f.startsWith("compositions/")));
});

// ---------------------------------------------------------------------------
// (b) Human edit in a codegen file → conflict, file untouched
// ---------------------------------------------------------------------------

test("human edit inside a codegen zone is a conflict and the file is not touched", () => {
  generate(specV1, outDir);
  const hacked = read("collections/authors.ts") + "\n// my manual hook\n";
  write("collections/authors.ts", hacked);
  const result = regenerate(specV3, outDir); // v3 adds authors.avatar
  const conflict = result.conflicts.find(
    (c) => c.kind === "human-edit-in-codegen-zone" && c.path === "collections/authors.ts",
  );
  assert.ok(conflict, "conflict reported");
  assert.equal(read("collections/authors.ts"), hacked, "file untouched");
  assert.ok(!result.written.includes("collections/authors.ts"));
  // manifest hash still the codegen one → reverting the edit unblocks regen:
  write("collections/authors.ts", hacked.replace("\n// my manual hook\n", ""));
  const retry = regenerate(specV3, outDir);
  assert.ok(retry.written.includes("collections/authors.ts"));
  assert.match(read("collections/authors.ts"), /avatar/);
});

test("a deleted codegen file is a conflict, not silently recreated", () => {
  generate(specV1, outDir);
  rmSync(join(outDir, "navigation.ts"));
  const result = regenerate(specV1, outDir);
  const conflict = result.conflicts.find(
    (c) => c.kind === "codegen-file-missing" && c.path === "navigation.ts",
  );
  assert.ok(conflict);
  assert.equal(existsSync(join(outDir, "navigation.ts")), false);
});

// ---------------------------------------------------------------------------
// (c) Human-owned files are never written
// ---------------------------------------------------------------------------

test("human-edited compositions survive regeneration byte-for-byte", () => {
  generate(specV1, outDir);
  const edited = JSON.parse(read("compositions/page-home.json"));
  edited.sections.push({ id: "extra", component: "cta-banner", props: {}, bindings: {} });
  const editedRaw = JSON.stringify(edited, null, 2) + "\n";
  write("compositions/page-home.json", editedRaw);
  regenerate(specV2, outDir);
  assert.equal(read("compositions/page-home.json"), editedRaw);
});

test("compositions for pages removed from the sitemap are preserved, not deleted", () => {
  generate(specV1, outDir);
  const v2 = structuredClone(specV2);
  v2.sitemap.pages = v2.sitemap.pages.filter((p) => p.slug !== "sobre-nosotros");
  v2.sitemap.navigation.footer = [];
  const result = regenerate(v2, outDir);
  // the codegen route is orphaned and deleted (pristine)…
  assert.ok(result.deletedOrphans.includes("app/sobre-nosotros/page.tsx"));
  // …but the human composition stays:
  assert.ok(existsSync(join(outDir, "compositions/page-sobre-nosotros.json")));
  assert.ok(result.preservedHuman.includes("compositions/page-sobre-nosotros.json"));
});

test("a NEW page in the spec gets route + scaffold without touching existing files", () => {
  generate(specV1, outDir);
  const v2 = structuredClone(specV2);
  v2.sitemap.pages.push({ title: "Contacto", slug: "contacto", children: [] });
  const result = regenerate(v2, outDir);
  assert.ok(result.created.includes("app/contacto/page.tsx"));
  assert.ok(result.created.includes("compositions/page-contacto.json"));
});

test("orphaned codegen file with manual edits is a conflict, not deleted", () => {
  generate(specV1, outDir);
  write("app/sobre-nosotros/page.tsx", read("app/sobre-nosotros/page.tsx") + "// edit\n");
  const v2 = structuredClone(specV2);
  v2.sitemap.pages = v2.sitemap.pages.filter((p) => p.slug !== "sobre-nosotros");
  v2.sitemap.navigation.footer = [];
  const result = regenerate(v2, outDir);
  assert.ok(
    result.conflicts.some(
      (c) => c.kind === "orphan-codegen-modified" && c.path === "app/sobre-nosotros/page.tsx",
    ),
  );
  assert.ok(existsSync(join(outDir, "app/sobre-nosotros/page.tsx")));
});

// ---------------------------------------------------------------------------
// (d) Binding validation against the new collections
// ---------------------------------------------------------------------------

test("removed field still bound by a page → descriptive conflict, page untouched", () => {
  generate(specV1, outDir);
  const before = read("compositions/page-home.json");
  const result = regenerate(specV2, outDir);
  const conflict = result.conflicts.find((c) => c.kind === "binding-missing-field");
  assert.ok(conflict, "conflict reported");
  assert.equal(conflict.page, "home");
  assert.equal(conflict.sectionId, "intro");
  assert.equal(conflict.prop, "subtitle");
  assert.equal(conflict.collection, "posts");
  assert.equal(conflict.field, "subtitle");
  assert.match(conflict.message, /eliminado/);
  assert.equal(read("compositions/page-home.json"), before, "page not modified");
});

test("binding to a removed COLLECTION is also a conflict", () => {
  generate(specV1, outDir);
  const v2 = structuredClone(specV2);
  // drop authors entirely (and the relation field that points to it)
  v2.collections.collections = v2.collections.collections
    .filter((c) => c.slug !== "authors")
    .map((c) => ({ ...c, fields: c.fields.filter((f) => f.relationTo !== "authors") }));
  const result = regenerate(v2, outDir);
  const conflict = result.conflicts.find(
    (c): c is Extract<Conflict, { kind: "binding-missing-collection" }> =>
      c.kind === "binding-missing-collection" && c.page === "blog",
  );
  assert.ok(conflict);
  assert.equal(conflict.collection, "authors");
  assert.equal(conflict.sectionId, "list");
});

test("bindings added BY THE HUMAN after generation are validated too", () => {
  generate(specV1, outDir);
  const edited = JSON.parse(read("compositions/page-blog.json"));
  edited.sections[0].bindings.extra = "posts.subtitle"; // human binds the doomed field
  write("compositions/page-blog.json", JSON.stringify(edited, null, 2) + "\n");
  const result = regenerate(specV2, outDir);
  assert.ok(
    result.conflicts.some(
      (c) => c.kind === "binding-missing-field" && c.page === "blog" && c.prop === "extra",
    ),
  );
});

test("a hand-broken composition file reports composition-unreadable, not a crash", () => {
  generate(specV1, outDir);
  write("compositions/page-home.json", "{ not json");
  const result = regenerate(specV2, outDir);
  assert.ok(
    result.conflicts.some(
      (c) => c.kind === "composition-unreadable" && c.path === "compositions/page-home.json",
    ),
  );
  assert.equal(read("compositions/page-home.json"), "{ not json", "left as-is");
});

// ---------------------------------------------------------------------------
// (e) Idempotency
// ---------------------------------------------------------------------------

test("regenerating twice with the same spec produces zero diffs (hash-verified)", () => {
  generate(specV1, outDir);
  regenerate(specV2, outDir);
  const before = treeHashes(outDir);
  const result = regenerate(specV2, outDir);
  const after = treeHashes(outDir);
  assert.equal(result.written.length, 0);
  assert.equal(result.created.length, 0);
  assert.equal(result.deletedOrphans.length, 0);
  assert.deepEqual([...after.entries()], [...before.entries()]);
});

test("generate itself is deterministic: same spec → identical tree in two dirs", () => {
  const otherDir = mkdtempSync(join(tmpdir(), "spike-regen-b-"));
  try {
    generate(specV1, outDir);
    generate(specV1, otherDir);
    assert.deepEqual([...treeHashes(outDir).entries()], [...treeHashes(otherDir).entries()]);
  } finally {
    rmSync(otherDir, { recursive: true, force: true });
  }
});

test("idempotency holds even with pending conflicts (stable conflict reporting)", () => {
  generate(specV1, outDir);
  write("collections/posts.ts", read("collections/posts.ts") + "// hack\n");
  const r1 = regenerate(specV2, outDir);
  const r2 = regenerate(specV2, outDir);
  assert.deepEqual(r2.conflicts, r1.conflicts);
  assert.equal(r2.written.length, 0);
});
