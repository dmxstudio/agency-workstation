import type { SpecArtifacts } from "./schemas";

/**
 * Fixtures shaped EXACTLY like the platform artifact payloads
 * (spec.sitemap, cms.collections, page.composition). They are parsed through
 * the copied Zod schemas on every generate/regenerate call, so any drift from
 * the real shapes fails loudly.
 *
 * Note: zod `.default()` fields (required, hasMany, timestamps, props,
 * bindings, navigation defaults) are written explicitly here because the
 * fixtures are typed as the OUTPUT type; the schemas would fill them anyway.
 */

/** Spec v1: initial state — posts has `subtitle`, home binds posts.title/subtitle. */
export const specV1: SpecArtifacts = {
  sitemap: {
    pages: [
      { title: "Home", slug: "home", children: [] },
      {
        title: "Blog",
        slug: "blog",
        children: [{ title: "Archivo", slug: "archivo", children: [] }],
      },
      { title: "Sobre nosotros", slug: "sobre-nosotros", children: [] },
    ],
    navigation: { header: ["home", "blog"], footer: ["sobre-nosotros"] },
  },
  collections: {
    collections: [
      {
        slug: "posts",
        label: "Posts",
        fields: [
          { name: "title", label: "Título", type: "text", required: true, hasMany: false },
          { name: "subtitle", label: "Subtítulo", type: "text", required: false, hasMany: false },
          { name: "body", label: "Cuerpo", type: "richText", required: true, hasMany: false },
          {
            name: "author",
            label: "Autor",
            type: "relation",
            required: false,
            relationTo: "authors",
            hasMany: false,
          },
        ],
        timestamps: true,
      },
      {
        slug: "authors",
        label: "Autores",
        fields: [
          { name: "name", label: "Nombre", type: "text", required: true, hasMany: false },
          { name: "bio", label: "Bio", type: "richText", required: false, hasMany: false },
        ],
        timestamps: true,
      },
    ],
  },
  compositions: {
    pages: [
      {
        slug: "home",
        sections: [
          {
            id: "hero",
            component: "hero",
            variant: "centered",
            props: { headlineSize: "xl" },
            bindings: { title: "posts.title" },
          },
          {
            id: "intro",
            component: "feature",
            props: {},
            // This binding is the §18.2 conflict candidate: posts.subtitle
            // will be REMOVED in spec v2 while still bound here.
            bindings: { subtitle: "posts.subtitle" },
          },
        ],
      },
      {
        slug: "blog",
        sections: [
          {
            id: "list",
            component: "post-list",
            props: { pageSize: 10 },
            bindings: { items: "posts.title", author: "authors.name" },
          },
        ],
      },
    ],
  },
};

/**
 * Spec v2 (the §18.2 exit-criteria change):
 *  - cms.collections: `posts.heroImage` ADDED, `posts.subtitle` REMOVED
 *    (while still bound by home/intro), authors untouched.
 *  - sitemap/compositions: unchanged.
 */
export const specV2: SpecArtifacts = structuredClone(specV1);
{
  const posts = specV2.collections.collections.find((c) => c.slug === "posts");
  if (!posts) throw new Error("fixture error: posts missing");
  posts.fields = posts.fields.filter((f) => f.name !== "subtitle");
  posts.fields.push({
    name: "heroImage",
    label: "Imagen principal",
    type: "image",
    required: false,
    hasMany: false,
  });
}

/**
 * Spec v3 (for the human-edit-in-codegen-zone step):
 *  - like v2, plus `authors.avatar` ADDED → collections/authors.ts must be
 *    regenerated, but the demo edits that file by hand first.
 */
export const specV3: SpecArtifacts = structuredClone(specV2);
{
  const authors = specV3.collections.collections.find((c) => c.slug === "authors");
  if (!authors) throw new Error("fixture error: authors missing");
  authors.fields.push({
    name: "avatar",
    label: "Avatar",
    type: "image",
    required: false,
    hasMany: false,
  });
}
