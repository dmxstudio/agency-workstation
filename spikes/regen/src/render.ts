import type {
  CmsCollection,
  CmsField,
  PageCompositionItem,
  SitemapNode,
  SpecArtifacts,
} from "./schemas";
import { withCodegenHeader } from "./ownership";

/**
 * Pure, deterministic renderers: spec artifacts → file contents.
 * Determinism is a hard requirement — idempotency is verified by hash, so the
 * same spec must always render byte-identical output (no timestamps, no
 * random ids, stable ordering).
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function camelCase(slug: string): string {
  return slug.replace(/-([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

function pascalCase(slug: string): string {
  const camel = camelCase(slug);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export interface FlatPage {
  slug: string;
  title: string;
  /** Route path segments from the root, e.g. ["blog", "post"]. */
  routeSegments: string[];
}

/** Flattens the sitemap tree into route paths (parent slugs become folders). */
export function flattenSitemap(nodes: SitemapNode[], parents: string[] = []): FlatPage[] {
  const out: FlatPage[] = [];
  for (const node of nodes) {
    const segments = node.slug === "home" && parents.length === 0 ? [] : [...parents, node.slug];
    out.push({ slug: node.slug, title: node.title, routeSegments: segments });
    out.push(...flattenSitemap(node.children, segments.length === 0 ? [node.slug] : segments));
  }
  return out;
}

export function routeFilePath(page: FlatPage): string {
  return page.routeSegments.length === 0
    ? "app/page.tsx"
    : `app/${page.routeSegments.join("/")}/page.tsx`;
}

export function compositionFilePath(slug: string): string {
  return `compositions/page-${slug}.json`;
}

export function collectionFilePath(slug: string): string {
  return `collections/${slug}.ts`;
}

// ---------------------------------------------------------------------------
// cms.collections → collections/*.ts + payload.config.ts + types/generated.ts
// ---------------------------------------------------------------------------

function renderField(field: CmsField): string {
  const lines = [
    `    {`,
    `      name: "${field.name}",`,
    `      label: "${field.label}",`,
    `      type: "${field.type}",`,
    `      required: ${field.required},`,
  ];
  if (field.type === "select" && field.options) {
    lines.push(`      options: ${JSON.stringify(field.options)},`);
  }
  if (field.type === "relation" && field.relationTo) {
    lines.push(`      relationTo: "${field.relationTo}",`);
    lines.push(`      hasMany: ${field.hasMany},`);
  }
  lines.push(`    },`);
  return lines.join("\n");
}

/** Simulated Payload CollectionConfig module (owned-by-codegen). */
export function renderCollectionModule(collection: CmsCollection): string {
  const body = [
    `// Simulated Payload CollectionConfig for \`${collection.slug}\`.`,
    `export const ${camelCase(collection.slug)}Collection = {`,
    `  slug: "${collection.slug}",`,
    `  labels: { singular: "${collection.label}" },`,
    `  timestamps: ${collection.timestamps},`,
    `  fields: [`,
    collection.fields.map(renderField).join("\n"),
    `  ],`,
    `} as const;`,
    ``,
  ].join("\n");
  return withCodegenHeader(body);
}

/** Simulated payload.config.ts registering every collection (owned-by-codegen). */
export function renderPayloadConfig(collections: CmsCollection[]): string {
  const sorted = [...collections].sort((a, b) => a.slug.localeCompare(b.slug));
  const body = [
    ...sorted.map(
      (c) => `import { ${camelCase(c.slug)}Collection } from "./collections/${c.slug}";`,
    ),
    ``,
    `// Simulated Payload config: the real generator emits buildConfig({...}).`,
    `export const payloadConfig = {`,
    `  collections: [${sorted.map((c) => `${camelCase(c.slug)}Collection`).join(", ")}],`,
    `};`,
    ``,
  ].join("\n");
  return withCodegenHeader(body);
}

function tsTypeForField(field: CmsField): string {
  switch (field.type) {
    case "text":
    case "richText":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "string";
    case "image":
      return "{ url: string; alt?: string }";
    case "select":
      return (field.options ?? []).map((o) => JSON.stringify(o)).join(" | ") || "string";
    case "relation":
      return field.hasMany ? "string[]" : "string";
  }
}

/** Generated TS types per collection (owned-by-codegen). */
export function renderGeneratedTypes(collections: CmsCollection[]): string {
  const sorted = [...collections].sort((a, b) => a.slug.localeCompare(b.slug));
  const blocks = sorted.map((collection) => {
    const fields = collection.fields.map(
      (f) => `  ${f.name}${f.required ? "" : "?"}: ${tsTypeForField(f)};`,
    );
    const timestamps = collection.timestamps
      ? ["  createdAt: string;", "  updatedAt: string;"]
      : [];
    return [
      `export interface ${pascalCase(collection.slug)} {`,
      `  id: string;`,
      ...fields,
      ...timestamps,
      `}`,
    ].join("\n");
  });
  const body = blocks.join("\n\n") + "\n";
  return withCodegenHeader(body);
}

// ---------------------------------------------------------------------------
// spec.sitemap → app/**/page.tsx + navigation.ts
// ---------------------------------------------------------------------------

/** Route shell (owned-by-codegen): loads the human-owned composition JSON. */
export function renderRouteModule(page: FlatPage): string {
  const depth = routeFilePath(page).split("/").length - 1;
  const rel = "../".repeat(depth) + compositionFilePath(page.slug);
  const body = [
    `// Route shell for \`${page.slug}\` (${page.title}).`,
    `// The composition JSON is owned-by-human: regeneration never rewrites it.`,
    `import composition from "${rel}";`,
    ``,
    `export default function ${pascalCase(page.slug)}Page() {`,
    `  return renderSections(composition.sections);`,
    `}`,
    ``,
    `declare function renderSections(sections: unknown): unknown;`,
    ``,
  ].join("\n");
  return withCodegenHeader(body);
}

export function renderNavigation(spec: SpecArtifacts): string {
  const body = [
    `export const navigation = ${JSON.stringify(spec.sitemap.navigation, null, 2)} as const;`,
    ``,
  ].join("\n");
  return withCodegenHeader(body);
}

// ---------------------------------------------------------------------------
// page.composition → compositions/page-*.json (owned-by-human after scaffold)
// ---------------------------------------------------------------------------

export function renderCompositionFile(item: PageCompositionItem): string {
  return JSON.stringify(item, null, 2) + "\n";
}

/** Empty scaffold for sitemap pages without a composition in the artifact. */
export function renderEmptyComposition(slug: string): string {
  return renderCompositionFile({ slug, sections: [] });
}

// ---------------------------------------------------------------------------
// Desired codegen file set for a spec (path → content, header included)
// ---------------------------------------------------------------------------

export function renderCodegenFiles(spec: SpecArtifacts): Map<string, string> {
  const files = new Map<string, string>();
  for (const collection of spec.collections.collections) {
    files.set(collectionFilePath(collection.slug), renderCollectionModule(collection));
  }
  files.set("payload.config.ts", renderPayloadConfig(spec.collections.collections));
  files.set("types/generated.ts", renderGeneratedTypes(spec.collections.collections));
  for (const page of flattenSitemap(spec.sitemap.pages)) {
    files.set(routeFilePath(page), renderRouteModule(page));
  }
  files.set("navigation.ts", renderNavigation(spec));
  return files;
}

/** Desired human-owned scaffold set (path → initial content). */
export function renderHumanScaffolds(spec: SpecArtifacts): Map<string, string> {
  const files = new Map<string, string>();
  const composed = new Map(spec.compositions.pages.map((p) => [p.slug, p]));
  for (const page of flattenSitemap(spec.sitemap.pages)) {
    const item = composed.get(page.slug);
    files.set(
      compositionFilePath(page.slug),
      item ? renderCompositionFile(item) : renderEmptyComposition(page.slug),
    );
  }
  return files;
}
