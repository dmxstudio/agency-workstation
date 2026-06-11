import type { ComponentConfig } from "@puckeditor/core";
import type { CmsCollection } from "@/modules/artifacts";
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
import { createBindingField, type BindingExpect } from "../bindings";

/**
 * Secciones CMS-bound — RENDERS copiados verbatim del template
 * (`templates/project-base/src/puck/sections/cms.tsx`). La ÚNICA divergencia
 * es el campo: el template usa `external` contra el Payload del proyecto (que
 * la plataforma no corre); el Studio usa el custom field de bindings
 * (`../bindings.tsx`), que guarda el MISMO shape `{ collection, docId,
 * ...snapshot }` que resuelve `templates/project-base/src/lib/bindings.ts`.
 *
 * Divergencia de TIPO (no de datos): el template tipa `collection` con el
 * literal de su colección de ejemplo (`"testimonials"`/`"posts"`); aquí se
 * ensancha a `string` porque el proyecto puede llamar a su colección de otra
 * forma. El Data JSON emitido es idéntico.
 */

export type TestimonialRef = {
  docId: string | number;
  collection: string;
  author?: string;
  role?: string;
  company?: string;
  quote?: string;
  rating?: number;
} | null;

export type PostRef = {
  docId: string | number;
  collection: string;
  title?: string;
  excerpt?: string;
  category?: string;
  publishedAt?: string;
} | null;

/** Claves de snapshot que leen los renders de testimonios (mapRow/mapProp del template). */
const TESTIMONIAL_EXPECTS: BindingExpect[] = [
  { key: "quote", label: "Cita", types: ["richText", "text"], required: true },
  { key: "author", label: "Autor", types: ["text"], required: true },
  { key: "role", label: "Cargo", types: ["text"] },
  { key: "company", label: "Empresa", types: ["text"] },
  { key: "rating", label: "Valoración", types: ["number"], omitPlaceholder: true },
];

/** Claves de snapshot que leen los renders de posts. */
const POST_EXPECTS: BindingExpect[] = [
  { key: "title", label: "Título", types: ["text"], required: true },
  { key: "excerpt", label: "Extracto", types: ["richText", "text"] },
  { key: "category", label: "Categoría", types: ["text", "select"] },
  { key: "publishedAt", label: "Fecha de publicación", types: ["date"], omitPlaceholder: true },
];

export type TestimonialQuoteProps = {
  testimonial: TestimonialRef;
  tone: Tone;
  padding: Padding;
};

export type TestimonialWallProps = {
  eyebrow: string;
  title: string;
  columns: "2" | "3";
  tone: Tone;
  padding: Padding;
  items: { source: TestimonialRef }[];
};

export type PostFeatureProps = {
  post: PostRef;
  tone: Tone;
  padding: Padding;
};

export type BlogPostsProps = {
  title: string;
  tone: Tone;
  padding: Padding;
  items: { source: PostRef }[];
};

export interface CmsSections {
  TestimonialQuote: ComponentConfig<TestimonialQuoteProps>;
  TestimonialWall: ComponentConfig<TestimonialWallProps>;
  PostFeature: ComponentConfig<PostFeatureProps>;
  BlogPosts: ComponentConfig<BlogPostsProps>;
}

/**
 * Factory: las 4 secciones CMS-bound con los campos de binding construidos
 * contra el `cms.collections` aprobado del proyecto.
 */
export function createCmsSections(collections: CmsCollection[]): CmsSections {
  const testimonialField = createBindingField<TestimonialRef>({
    label: "Testimonio (CMS)",
    collections,
    expects: TESTIMONIAL_EXPECTS,
  });

  const postField = createBindingField<PostRef>({
    label: "Post (CMS)",
    collections,
    expects: POST_EXPECTS,
  });

  const TestimonialQuote: ComponentConfig<TestimonialQuoteProps> = {
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

  const TestimonialWall: ComponentConfig<TestimonialWallProps> = {
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

  const PostFeature: ComponentConfig<PostFeatureProps> = {
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

  const BlogPosts: ComponentConfig<BlogPostsProps> = {
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

  return { TestimonialQuote, TestimonialWall, PostFeature, BlogPosts };
}
