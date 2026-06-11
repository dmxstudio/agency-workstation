import { flattenSitemap, type FlatPage } from "@/modules/artifacts";
import type {
  CmsCollection,
  CmsCollectionsPayload,
  CmsField,
  ContentPagePayload,
  DesignTokensPayload,
  PageCompositionPayload,
  PageContent,
  SpecSitemapPayload,
} from "@/modules/artifacts";

import { withCodegenHeader } from "./ownership";

// Canonical sitemap flattening lives in the artifacts module (page keys must
// match `page.composition` artifact keys); re-exported here for compatibility.
export { flattenSitemap, type FlatPage };

/**
 * Pure, deterministic renderers: approved artifact payloads → file contents
 * for the generated project (template `templates/project-base`).
 *
 * Determinism is a HARD requirement (validated in the §18.2 spike): idempotency
 * is verified by hash, so the same input must always render byte-identical
 * output — no timestamps, no random ids, stable ordering everywhere.
 *
 * Codegen contract with the template (matches its `@generated-example` files):
 *   site.config.ts                 ← project + spec.sitemap (owned-by-codegen)
 *     exports `siteConfig` { name, slug, description, homePath, locale }
 *   src/generated/tokens.css       ← design.tokens         (owned-by-codegen)
 *     `:root` CSS variables; color token names map 1:1 to var names
 *   src/generated/navigation.ts    ← spec.sitemap          (owned-by-codegen)
 *     exports `mainNav`, `footerColumns`, `legalText`
 *   src/collections/<slug>.ts      ← cms.collections       (owned-by-codegen)
 *     exports `<PascalSlug>: CollectionConfig`
 *   src/collections/index.ts       ← cms.collections       (owned-by-codegen)
 *     exports `generatedCollections: CollectionConfig[]`
 *   src/seed/content.json          ← sitemap + cms.collections + content.page
 *                                    + page.composition (per page, keyed)
 *     (owned-by-codegen) — fixtures in the EXACT shape the template's
 *     `scripts/seed.mts` consumes (`npm run seed`): `collections` (sample
 *     documents per generated collection, §7.3 "fixtures de contenido") and
 *     `pages` (Puck Data per page: the APPROVED `page.composition` artifact
 *     of that page when it exists, scaffold from the approved copy otherwise)
 *   src/compositions/page-<slug>.json ← page.composition   (owned-by-HUMAN:
 *     scaffolded once as Puck Data, then the Studio/human owns it forever —
 *     §18.2; pre-existing files in legacy 1.0 shape are still validated)
 *
 * Outside the manifest, the engine also sets the `name` field of the
 * template's `package.json` ONCE at initial generation (see `engine.ts`).
 */

// ---------------------------------------------------------------------------
// Input bundle
// ---------------------------------------------------------------------------

export interface GeneratorInput {
  projectName: string;
  /** Required approved artifacts (§7.3). */
  sitemap: SpecSitemapPayload;
  collections: CmsCollectionsPayload;
  tokens: DesignTokensPayload;
  /** Optional: enriches seed content and composition scaffolds when approved. */
  content: ContentPagePayload | null;
  /**
   * APPROVED per-page `page.composition` artifacts (Puck Data), keyed by page
   * path (the artifact `key`: `home`, `servicios`, `legal/terms`, …). Pages
   * without an approved composition fall back to the content.page scaffold.
   * Legacy artifacts (schemaVersion 1.0) are skipped by the service loader.
   */
  compositions: Record<string, PageCompositionPayload>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function camelCase(slug: string): string {
  return slug.replace(/-([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

function pascalCase(slug: string): string {
  const camel = camelCase(slug);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics (á → a)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "proyecto"
  );
}

export function compositionFilePath(slug: string): string {
  return `src/compositions/page-${slug}.json`;
}

export function collectionFilePath(slug: string): string {
  return `src/collections/${slug}.ts`;
}

function tsString(value: string): string {
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// project + spec.sitemap → site.config.ts
// ---------------------------------------------------------------------------

export function renderSiteConfig(projectName: string, sitemap: SpecSitemapPayload): string {
  const pages = flattenSitemap(sitemap.pages);
  const home = pages.find((page) => page.path === "/") ?? pages[0];
  const body = [
    `export const siteConfig = {`,
    `  /** Display name of the site (brand). */`,
    `  name: ${tsString(projectName)},`,
    `  /** URL-safe identifier of the project. */`,
    `  slug: ${tsString(slugify(projectName))},`,
    `  /** Default meta description. */`,
    `  description: ${tsString(`${projectName} — sitio generado con Agency Workstation.`)},`,
    `  /** Path (in the \`pages\` collection) rendered at the root URL \`/\`. */`,
    `  homePath: ${tsString(home?.pagePath ?? "home")},`,
    `  /** BCP-47 language tag for the <html lang> attribute. */`,
    `  locale: "es",`,
    `} as const;`,
    ``,
    `export type SiteConfig = typeof siteConfig;`,
    ``,
  ].join("\n");
  return withCodegenHeader(body);
}

// ---------------------------------------------------------------------------
// design.tokens → src/generated/tokens.css
// ---------------------------------------------------------------------------

function cssVarLines(map: Record<string, string>, prefix = ""): string[] {
  return Object.keys(map)
    .sort()
    .map((name) => `  --${prefix}${name}: ${map[name]};`);
}

/**
 * Color token names map 1:1 to CSS variable names (`brand-600` → `--brand-600`)
 * so the template's `globals.css` Tailwind mapping picks them up unchanged.
 * Typography/spacing/radii get conventional prefixes.
 */
export function renderTokensCss(tokens: DesignTokensPayload): string {
  const lines: string[] = [":root {"];
  lines.push(...cssVarLines(tokens.colors));
  lines.push(`  --font-sans: ${tokens.typography.fontFamilies.sans};`);
  if (tokens.typography.fontFamilies.serif) {
    lines.push(`  --font-serif: ${tokens.typography.fontFamilies.serif};`);
  }
  if (tokens.typography.fontFamilies.mono) {
    lines.push(`  --font-mono: ${tokens.typography.fontFamilies.mono};`);
  }
  lines.push(`  --font-size-base: ${tokens.typography.baseSizePx}px;`);
  if (tokens.typography.scaleRatio != null) {
    lines.push(`  --type-scale-ratio: ${tokens.typography.scaleRatio};`);
  }
  lines.push(...cssVarLines(tokens.spacing, "space-"));
  lines.push(...cssVarLines(tokens.radii, "radius-"));
  lines.push("}");
  lines.push("");
  return withCodegenHeader(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// spec.sitemap → src/generated/navigation.ts
// ---------------------------------------------------------------------------

export function renderNavigation(projectName: string, sitemap: SpecSitemapPayload): string {
  const pages = flattenSitemap(sitemap.pages);
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  const links = (slugs: string[], indent: string): string[] =>
    slugs
      .map((slug) => bySlug.get(slug))
      .filter((page): page is FlatPage => page != null)
      .map((page) => `${indent}{ label: ${tsString(page.title)}, href: ${tsString(page.path)} },`);

  const footerLinks = links(sitemap.navigation.footer, "      ");
  const body = [
    `export type NavLink = { label: string; href: string };`,
    `export type FooterColumn = { title: string; links: NavLink[] };`,
    ``,
    `export const mainNav: NavLink[] = [`,
    ...links(sitemap.navigation.header, "  "),
    `];`,
    ``,
    `export const footerColumns: FooterColumn[] = [`,
    ...(footerLinks.length > 0
      ? [`  {`, `    title: ${tsString(projectName)},`, `    links: [`, ...footerLinks, `    ],`, `  },`]
      : []),
    `];`,
    ``,
    `export const legalText = ${tsString(`© ${projectName}. Todos los derechos reservados.`)};`,
    ``,
  ].join("\n");
  return withCodegenHeader(body);
}

// ---------------------------------------------------------------------------
// cms.collections → src/collections/<slug>.ts + src/collections/index.ts
// ---------------------------------------------------------------------------

/**
 * Maps an artifact field to a Payload 3.x field config.
 *
 * Deliberately conservative mappings (template contract):
 * - `richText` → `textarea` (a real richText field would force an editor
 *   dependency/config in the generated project; revisit with the template).
 * - `image` → `text` holding a URL (no media/upload collection in MVP).
 */
function renderField(field: CmsField): string[] {
  const lines: string[] = [`    {`, `      name: ${tsString(field.name)},`];
  lines.push(`      label: ${tsString(field.label)},`);
  switch (field.type) {
    case "text":
      lines.push(`      type: "text",`);
      break;
    case "richText":
      lines.push(`      type: "textarea",`);
      break;
    case "number":
      lines.push(`      type: "number",`);
      break;
    case "boolean":
      lines.push(`      type: "checkbox",`);
      break;
    case "date":
      lines.push(`      type: "date",`);
      break;
    case "image":
      lines.push(`      type: "text",`);
      lines.push(`      admin: { description: "URL de la imagen" },`);
      break;
    case "select":
      lines.push(`      type: "select",`);
      lines.push(`      options: ${JSON.stringify(field.options ?? [])},`);
      break;
    case "relation":
      lines.push(`      type: "relationship",`);
      lines.push(`      relationTo: ${tsString(field.relationTo ?? "")},`);
      if (field.hasMany) lines.push(`      hasMany: true,`);
      break;
  }
  if (field.required) lines.push(`      required: true,`);
  lines.push(`    },`);
  return lines;
}

export function renderCollectionModule(collection: CmsCollection): string {
  const titleField = collection.fields.find((field) => field.type === "text");
  const body = [
    `import type { CollectionConfig } from "payload";`,
    ``,
    `export const ${pascalCase(collection.slug)}: CollectionConfig = {`,
    `  slug: ${tsString(collection.slug)},`,
    `  labels: { singular: ${tsString(collection.label)}, plural: ${tsString(collection.label)} },`,
    ...(titleField ? [`  admin: { useAsTitle: ${tsString(titleField.name)} },`] : []),
    ...(collection.timestamps ? [] : [`  timestamps: false,`]),
    `  fields: [`,
    ...collection.fields.flatMap(renderField),
    `  ],`,
    `};`,
    ``,
  ].join("\n");
  return withCodegenHeader(body);
}

export function renderCollectionsIndex(payload: CmsCollectionsPayload): string {
  const sorted = [...payload.collections].sort((a, b) => a.slug.localeCompare(b.slug));
  const body = [
    `import type { CollectionConfig } from "payload";`,
    ``,
    `// Explicit .ts extensions: required by \`payload run\` (tsx CJS loader).`,
    ...sorted.map(
      (collection) =>
        `import { ${pascalCase(collection.slug)} } from "./${collection.slug}.ts";`,
    ),
    ``,
    `export const generatedCollections: CollectionConfig[] = [`,
    ...sorted.map((collection) => `  ${pascalCase(collection.slug)},`),
    `];`,
    ``,
  ].join("\n");
  return withCodegenHeader(body);
}

// ---------------------------------------------------------------------------
// sitemap + cms.collections + content.page → src/seed/content.json
// ---------------------------------------------------------------------------

/**
 * Shape consumed by the template's `scripts/seed.mts` (its `SeedContent`
 * type): `collections` are wiped+reloaded as CMS documents; each page becomes
 * a `pages` document whose `content` blocks are Puck instances of the
 * template's governed section registry.
 */
interface SeedBlock {
  type: string;
  props: Record<string, unknown>;
}

interface SeedPage {
  title: string;
  path: string;
  description?: string;
  publish: boolean;
  content: SeedBlock[];
}

const SAMPLE_DOCS_PER_COLLECTION = 3;

/**
 * Deterministic sample value for a CMS field (§7.3 "fixtures de contenido").
 * `relation` fields are skipped: real document ids only exist at seed time and
 * the template's seed script resolves `$seedRef` placeholders inside PAGE
 * compositions only — linking sample documents to each other stays a human
 * task in the generated CMS (keep demo `relation` fields optional).
 */
function sampleFieldValue(
  collectionSlug: string,
  field: CmsField,
  docIndex: number,
): unknown {
  const n = docIndex + 1;
  switch (field.type) {
    case "text":
      return `${field.label} ${n}`;
    case "richText":
      return `Contenido de ejemplo (${n}) para «${field.label}». Edítelo desde el panel /admin del proyecto.`;
    case "number":
      return n * 10;
    case "boolean":
      return docIndex % 2 === 0;
    case "date":
      return `2026-${String(n).padStart(2, "0")}-15`;
    case "image":
      return `https://placehold.co/1200x800?text=${collectionSlug}-${n}`;
    case "select": {
      const options = field.options ?? [];
      return options.length > 0 ? options[docIndex % options.length] : undefined;
    }
    case "relation":
      return undefined;
  }
}

function renderSampleCollections(
  payload: CmsCollectionsPayload,
): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const collection of [...payload.collections].sort((a, b) => a.slug.localeCompare(b.slug))) {
    out[collection.slug] = Array.from({ length: SAMPLE_DOCS_PER_COLLECTION }, (_, docIndex) => {
      const doc: Record<string, unknown> = {};
      for (const field of collection.fields) {
        const value = sampleFieldValue(collection.slug, field, docIndex);
        if (value !== undefined) doc[field.name] = value;
      }
      return doc;
    });
  }
  return out;
}

interface SeedNavContext {
  brand: string;
  headerLinks: { label: string; href: string }[];
  footerColumns: { title: string; links: { label: string; href: string }[] }[];
  /** Navbar CTA: the contact page when the sitemap has one. */
  cta: { label: string; href: string } | null;
  tagline: string;
  legal: string;
}

/**
 * Puck blocks for one page, from its approved copy (`content.page`):
 * - first section with heading → `Hero` (CTA included when present);
 * - heading+body+cta → `Cta`; heading+body → `ImageText` (sides alternate);
 * - loose heading/body/cta → `Heading`/`Paragraph`/`ButtonRow`;
 * - pages without copy → `HeroMinimal` with the sitemap title.
 * Every page gets the shared `Navbar`/`Footer`. All ids are deterministic.
 */
function pageBlocks(
  page: FlatPage,
  contentPage: PageContent | undefined,
  nav: SeedNavContext,
): SeedBlock[] {
  const blocks: SeedBlock[] = [];
  let counter = 0;
  const blockId = (type: string) => `${type}-${page.slug}-${++counter}`;

  blocks.push({
    type: "Navbar",
    props: {
      id: blockId("Navbar"),
      brand: nav.brand,
      tone: "light",
      sticky: true,
      links: nav.headerLinks,
      ctaLabel: nav.cta?.label ?? "",
      ctaHref: nav.cta?.href ?? "",
    },
  });

  const sections = contentPage?.sections ?? [];
  let rest = sections;
  const first = sections[0];
  if (first?.heading) {
    rest = sections.slice(1);
    blocks.push({
      type: "Hero",
      props: {
        id: blockId("Hero"),
        eyebrow: "",
        title: first.heading,
        subtitle: first.body ?? "",
        align: "center",
        tone: "light",
        padding: "spacious",
        size: page.path === "/" ? "large" : "normal",
        primaryCta: first.cta?.label ?? "",
        primaryCtaHref: first.cta?.href ?? "",
        secondaryCta: "",
        secondaryCtaStyle: "ghost",
      },
    });
  } else {
    blocks.push({
      type: "HeroMinimal",
      props: {
        id: blockId("HeroMinimal"),
        title: contentPage?.title ?? page.title,
        tone: "light",
        padding: "spacious",
      },
    });
  }

  rest.forEach((section, index) => {
    if (section.heading && section.body && section.cta) {
      blocks.push({
        type: "Cta",
        props: {
          id: blockId("Cta"),
          title: section.heading,
          subtitle: section.body,
          cta: section.cta.label,
          ctaHref: section.cta.href,
          align: "center",
          tone: "subtle",
          padding: "normal",
        },
      });
      return;
    }
    if (section.heading && section.body) {
      blocks.push({
        type: "ImageText",
        props: {
          id: blockId("ImageText"),
          title: section.heading,
          body: section.body,
          mediaSide: index % 2 === 0 ? "right" : "left",
          tone: "light",
          padding: "normal",
        },
      });
      return;
    }
    if (section.heading) {
      blocks.push({
        type: "Heading",
        props: { id: blockId("Heading"), text: section.heading, level: "h2", align: "left" },
      });
    }
    if (section.body) {
      blocks.push({
        type: "Paragraph",
        props: { id: blockId("Paragraph"), text: section.body, size: "m", align: "left" },
      });
    }
    if (section.cta) {
      blocks.push({
        type: "ButtonRow",
        props: {
          id: blockId("ButtonRow"),
          buttons: [{ label: section.cta.label, href: section.cta.href, style: "primary" }],
          align: "left",
        },
      });
    }
  });

  blocks.push({
    type: "Footer",
    props: {
      id: blockId("Footer"),
      brand: nav.brand,
      tagline: nav.tagline,
      tone: "dark",
      columns: nav.footerColumns,
      legal: nav.legal,
    },
  });

  return blocks;
}

/** Navigation context shared by the seed pages and the composition scaffolds. */
function buildSeedNav(input: GeneratorInput, pages: FlatPage[]): SeedNavContext {
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  const links = (slugs: string[]): { label: string; href: string }[] =>
    slugs
      .map((slug) => bySlug.get(slug))
      .filter((page): page is FlatPage => page != null)
      .map((page) => ({ label: page.title, href: page.path }));

  const contactPage = pages.find((page) => page.slug === "contacto" || page.slug === "contact");
  const footerLinks = links(input.sitemap.navigation.footer);
  return {
    brand: input.projectName,
    headerLinks: links(input.sitemap.navigation.header),
    footerColumns:
      footerLinks.length > 0 ? [{ title: input.projectName, links: footerLinks }] : [],
    cta: contactPage ? { label: contactPage.title, href: contactPage.path } : null,
    tagline: input.content?.keyMessages[0] ?? "",
    legal: `© ${input.projectName}. Todos los derechos reservados.`,
  };
}

interface ResolvedPageData {
  title: string;
  description: string;
  content: SeedBlock[];
  /** Whether the data came from an approved `page.composition` artifact. */
  fromComposition: boolean;
}

/**
 * Page data, by priority:
 * 1. The APPROVED `page.composition` artifact of that page (Puck Data, keyed
 *    by page path) — the Studio's truth, emitted verbatim.
 * 2. Fallback: the scaffold composed from the approved `content.page` copy
 *    (`pageBlocks`); pages without copy still render (HeroMinimal + nav).
 */
function resolvePageData(
  page: FlatPage,
  input: GeneratorInput,
  nav: SeedNavContext,
  contentBySlug: Map<string, PageContent>,
): ResolvedPageData {
  const contentPage = contentBySlug.get(page.slug);
  const composition = input.compositions[page.pagePath];
  if (composition) {
    const rootProps = composition.root.props;
    return {
      title: rootProps.title || contentPage?.title || page.title,
      description: rootProps.description || contentPage?.seo.description || "",
      content: composition.content,
      fromComposition: true,
    };
  }
  return {
    title: contentPage?.title ?? page.title,
    description: contentPage?.seo.description ?? "",
    content: pageBlocks(page, contentPage, nav),
    fromComposition: false,
  };
}

/**
 * Seed fixtures consumed by the template's seed script (`npm run seed`):
 * sample CMS documents from `cms.collections` plus one published page per
 * sitemap entry. Each page's blocks come from its APPROVED `page.composition`
 * artifact (per-page, keyed by path) when there is one — including its CMS
 * binding placeholders (`$seedRef`), which `scripts/seed.mts` resolves to
 * live `{ collection, docId, …snapshot }` refs — with fallback to the
 * content.page scaffold otherwise. No codegen header: comments are not valid
 * JSON; the manifest hash covers edit detection (`$comment` carries the
 * signaling instead).
 */
export function renderSeedContent(input: GeneratorInput): string {
  const pages = flattenSitemap(input.sitemap.pages);
  const nav = buildSeedNav(input, pages);
  const contentBySlug = new Map(
    (input.content?.pages ?? []).map((page) => [page.slug, page]),
  );

  const seed = {
    $comment:
      "@generated agency-workstation — OWNED-BY-CODEGEN. Fixtures emitted from the approved artifacts (cms.collections + spec.sitemap + content.page + page.composition per page); loaded by `npm run seed`. Do not edit by hand: manual edits are reported as conflicts on regeneration.",
    keyMessages: input.content?.keyMessages ?? [],
    collections: renderSampleCollections(input.collections),
    pages: pages.map((page): SeedPage => {
      const data = resolvePageData(page, input, nav, contentBySlug);
      return {
        title: data.title,
        path: page.pagePath,
        description: data.description,
        publish: true,
        content: data.content,
      };
    }),
  };
  return JSON.stringify(seed, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// page.composition → src/compositions/page-<slug>.json (owned-by-human)
// ---------------------------------------------------------------------------

export function renderCompositionFile(data: PageCompositionPayload): string {
  return JSON.stringify(data, null, 2) + "\n";
}

/**
 * Initial composition FILE for a sitemap page — full Puck Data, same shape
 * the artifact payload and the template renderer use:
 * 1. The approved `page.composition` artifact of that page, verbatim.
 * 2. A scaffold from the approved `content.page` copy (registry sections).
 *
 * Whatever the source, the file is scaffolded ONCE and becomes human-owned
 * forever: the living composition is the artifact's/Studio's, not the
 * file's (§18.2). Files scaffolded before this model (legacy 1.0 shape,
 * `{ slug, sections }`) are still parsed by the shared bindings helper.
 */
function initialComposition(
  page: FlatPage,
  input: GeneratorInput,
  nav: SeedNavContext,
  contentBySlug: Map<string, PageContent>,
): PageCompositionPayload {
  const fromArtifact = input.compositions[page.pagePath];
  if (fromArtifact) return fromArtifact;

  const data = resolvePageData(page, input, nav, contentBySlug);
  return {
    root: { props: { title: data.title, description: data.description } },
    content: data.content as PageCompositionPayload["content"],
    zones: {},
  };
}

// ---------------------------------------------------------------------------
// Desired file sets (path → content)
// ---------------------------------------------------------------------------

/**
 * Directories whose contents are 100% codegen-owned. On initial generation the
 * template's `@generated-example` placeholders inside them are purged before
 * rendering, so generated repos never keep stale example files.
 */
export const CODEGEN_ZONE_DIRS = ["src/generated", "src/collections", "src/seed"] as const;

/** Codegen-owned files: regeneration rewrites these (when pristine). */
export function renderCodegenFiles(input: GeneratorInput): Map<string, string> {
  const files = new Map<string, string>();
  files.set("site.config.ts", renderSiteConfig(input.projectName, input.sitemap));
  files.set("src/generated/tokens.css", renderTokensCss(input.tokens));
  files.set(
    "src/generated/navigation.ts",
    renderNavigation(input.projectName, input.sitemap),
  );
  for (const collection of input.collections.collections) {
    files.set(collectionFilePath(collection.slug), renderCollectionModule(collection));
  }
  files.set("src/collections/index.ts", renderCollectionsIndex(input.collections));
  files.set("src/seed/content.json", renderSeedContent(input));
  return files;
}

/** Human-owned scaffolds: written once on creation, never rewritten (§18.2). */
export function renderHumanScaffolds(input: GeneratorInput): Map<string, string> {
  const files = new Map<string, string>();
  const pages = flattenSitemap(input.sitemap.pages);
  const nav = buildSeedNav(input, pages);
  const contentBySlug = new Map(
    (input.content?.pages ?? []).map((page) => [page.slug, page]),
  );
  for (const page of pages) {
    files.set(
      compositionFilePath(page.slug),
      renderCompositionFile(initialComposition(page, input, nav, contentBySlug)),
    );
  }
  return files;
}
