import type { ComponentConfig, ExternalField } from "@puckeditor/core";
import {
  SectionShell,
  Eyebrow,
  mutedClass,
  cardClass,
  gridColsClass,
  toneField,
  paddingField,
  type Tone,
  type Padding,
} from "../primitives";

/**
 * CMS-bound sections. The "external" Puck field opens a modal that lists
 * documents from a Payload collection (via /api/external/*). mapProp stores
 * BOTH a reference (docId + collection) and a content snapshot.
 *
 * The published render re-resolves every reference against Payload at request
 * time (see lib/bindings.ts), so editing the doc in the CMS updates the page
 * without touching the composition — a real binding, not a hardcoded copy.
 */

export type TestimonialRef = {
  docId: string | number;
  collection: "testimonials";
  author?: string;
  role?: string;
  company?: string;
  quote?: string;
  rating?: number;
} | null;

export type PostRef = {
  docId: string | number;
  collection: "posts";
  title?: string;
  excerpt?: string;
  category?: string;
  publishedAt?: string;
} | null;

// ExternalField<T>: T is the MAPPED prop value (what mapProp returns and what
// getItemSummary receives after selection); fetchList rows are untyped (any).
const testimonialField: ExternalField<TestimonialRef> = {
  type: "external",
  label: "Testimonio (CMS)",
  placeholder: "Seleccionar testimonio…",
  showSearch: true,
  fetchList: async ({ query }) => {
    const res = await fetch(
      `/api/external/testimonials?query=${encodeURIComponent(query ?? "")}`
    );
    if (!res.ok) return [];
    return res.json();
  },
  mapRow: (item) => ({
    autor: item.author ?? "",
    empresa: item.company ?? "",
    cita: (item.quote ?? "").slice(0, 60),
  }),
  mapProp: (item) => ({
    docId: item.id,
    collection: "testimonials" as const,
    author: item.author,
    role: item.role,
    company: item.company,
    quote: item.quote,
    rating: item.rating,
  }),
  getItemSummary: (item) => item?.author ?? (item ? `#${item.docId}` : "—"),
};

const postField: ExternalField<PostRef> = {
  type: "external",
  label: "Post (CMS)",
  placeholder: "Seleccionar post…",
  showSearch: true,
  fetchList: async ({ query }) => {
    const res = await fetch(`/api/external/posts?query=${encodeURIComponent(query ?? "")}`);
    if (!res.ok) return [];
    return res.json();
  },
  mapRow: (item) => ({
    título: item.title ?? "",
    categoría: item.category ?? "",
  }),
  mapProp: (item) => ({
    docId: item.id,
    collection: "posts" as const,
    title: item.title,
    excerpt: item.excerpt,
    category: item.category,
    publishedAt: item.publishedAt,
  }),
  getItemSummary: (item) => item?.title ?? (item ? `#${item.docId}` : "—"),
};

export type TestimonialQuoteProps = {
  testimonial: TestimonialRef;
  tone: Tone;
  padding: Padding;
};

export const TestimonialQuote: ComponentConfig<TestimonialQuoteProps> = {
  label: "Testimonio destacado (CMS)",
  fields: {
    testimonial: testimonialField,
    tone: toneField,
    padding: paddingField,
  },
  defaultProps: { testimonial: null, tone: "subtle", padding: "normal" },
  render: ({ testimonial, tone, padding }) => (
    <SectionShell tone={tone} padding={padding} width="narrow">
      {testimonial ? (
        <figure className="text-center">
          <blockquote className="text-balance text-2xl font-medium leading-relaxed">
            “{testimonial.quote}”
          </blockquote>
          <figcaption className={`mt-4 text-sm ${mutedClass[tone]}`}>
            <span className="font-semibold">{testimonial.author}</span>
            {testimonial.role ? ` — ${testimonial.role}` : ""}
            {testimonial.company ? `, ${testimonial.company}` : ""}
          </figcaption>
        </figure>
      ) : (
        <p className={`text-center text-sm ${mutedClass[tone]}`}>
          Selecciona un testimonio del CMS en el panel derecho.
        </p>
      )}
    </SectionShell>
  ),
};

export type TestimonialWallProps = {
  eyebrow: string;
  title: string;
  columns: "2" | "3";
  tone: Tone;
  padding: Padding;
  items: { source: TestimonialRef }[];
};

export const TestimonialWall: ComponentConfig<TestimonialWallProps> = {
  label: "Muro de testimonios (CMS)",
  fields: {
    eyebrow: { type: "text", label: "Eyebrow" },
    title: { type: "text", label: "Título" },
    columns: {
      type: "radio",
      label: "Columnas",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
      ],
    },
    tone: toneField,
    padding: paddingField,
    items: {
      type: "array",
      label: "Testimonios",
      getItemSummary: (item) => item.source?.author ?? "Sin seleccionar",
      arrayFields: { source: testimonialField },
      defaultItemProps: { source: null },
    },
  },
  defaultProps: {
    eyebrow: "Clientes",
    title: "Lo que dicen de nosotros",
    columns: "3",
    tone: "light",
    padding: "normal",
    items: [],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      <Eyebrow tone={p.tone}>{p.eyebrow}</Eyebrow>
      <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
      <div className={`mt-10 ${gridColsClass[p.columns]}`}>
        {p.items.map((it, i) =>
          it.source ? (
            <figure key={i} className={`rounded-lg p-6 ${cardClass[p.tone]}`}>
              {typeof it.source.rating === "number" ? (
                <div className="text-sm text-amber-500">
                  {"★".repeat(Math.round(it.source.rating))}
                </div>
              ) : null}
              <blockquote className="mt-2 text-sm leading-relaxed">
                “{it.source.quote}”
              </blockquote>
              <figcaption className={`mt-4 text-xs ${mutedClass[p.tone]}`}>
                <span className="font-semibold">{it.source.author}</span>
                {it.source.company ? ` · ${it.source.company}` : ""}
              </figcaption>
            </figure>
          ) : (
            <div
              key={i}
              className={`rounded-lg p-6 text-sm ${cardClass[p.tone]} ${mutedClass[p.tone]}`}
            >
              Testimonio sin seleccionar
            </div>
          )
        )}
      </div>
    </SectionShell>
  ),
};

export type PostFeatureProps = {
  post: PostRef;
  tone: Tone;
  padding: Padding;
};

export const PostFeature: ComponentConfig<PostFeatureProps> = {
  label: "Post destacado (CMS)",
  fields: { post: postField, tone: toneField, padding: paddingField },
  defaultProps: { post: null, tone: "light", padding: "normal" },
  render: ({ post, tone, padding }) => (
    <SectionShell tone={tone} padding={padding} width="normal">
      {post ? (
        <article className={`rounded-xl p-8 ${cardClass[tone]}`}>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            {post.category}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">{post.title}</h2>
          <p className={`mt-3 ${mutedClass[tone]}`}>{post.excerpt}</p>
        </article>
      ) : (
        <p className={`text-sm ${mutedClass[tone]}`}>Selecciona un post del CMS.</p>
      )}
    </SectionShell>
  ),
};

export type BlogPostsProps = {
  title: string;
  tone: Tone;
  padding: Padding;
  items: { source: PostRef }[];
};

export const BlogPosts: ComponentConfig<BlogPostsProps> = {
  label: "Listado de posts (CMS)",
  fields: {
    title: { type: "text", label: "Título" },
    tone: toneField,
    padding: paddingField,
    items: {
      type: "array",
      label: "Posts",
      getItemSummary: (item) => item.source?.title ?? "Sin seleccionar",
      arrayFields: { source: postField },
      defaultItemProps: { source: null },
    },
  },
  defaultProps: { title: "Del blog", tone: "light", padding: "normal", items: [] },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
      <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {p.items.map((it, i) =>
          it.source ? (
            <article key={i} className={`rounded-lg p-6 ${cardClass[p.tone]}`}>
              <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
                {it.source.category}
              </p>
              <h3 className="mt-2 font-semibold">{it.source.title}</h3>
              <p className={`mt-2 text-sm ${mutedClass[p.tone]}`}>{it.source.excerpt}</p>
            </article>
          ) : (
            <div key={i} className={`rounded-lg p-6 text-sm ${cardClass[p.tone]}`}>
              Post sin seleccionar
            </div>
          )
        )}
      </div>
    </SectionShell>
  ),
};
