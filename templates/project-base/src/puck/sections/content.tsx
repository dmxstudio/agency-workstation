import type { ComponentConfig } from "@puckeditor/core";
import {
  SectionShell,
  Eyebrow,
  CtaButton,
  MediaPlaceholder,
  mutedClass,
  cardClass,
  toneField,
  paddingField,
  alignField,
  type Tone,
  type Padding,
  type Align,
} from "../primitives";

/** Basic content blocks — mostly used inside Section/Columns slots. */

export type HeadingProps = {
  text: string;
  level: "h2" | "h3" | "h4";
  align: Align;
};

export const Heading: ComponentConfig<HeadingProps> = {
  label: "Encabezado",
  fields: {
    text: { type: "text", label: "Texto" },
    level: {
      type: "select",
      label: "Nivel",
      options: [
        { label: "H2", value: "h2" },
        { label: "H3", value: "h3" },
        { label: "H4", value: "h4" },
      ],
    },
    align: alignField,
  },
  defaultProps: { text: "Encabezado de sección", level: "h2", align: "left" },
  render: ({ text, level, align }) => {
    const cls = `font-bold tracking-tight ${
      { h2: "text-3xl", h3: "text-2xl", h4: "text-xl" }[level]
    } ${align === "center" ? "text-center" : "text-left"}`;
    if (level === "h3") return <h3 className={cls}>{text}</h3>;
    if (level === "h4") return <h4 className={cls}>{text}</h4>;
    return <h2 className={cls}>{text}</h2>;
  },
};

export type ParagraphProps = { text: string; size: "s" | "m" | "l"; align: Align };

export const Paragraph: ComponentConfig<ParagraphProps> = {
  label: "Párrafo",
  fields: {
    text: { type: "textarea", label: "Texto" },
    size: {
      type: "radio",
      label: "Tamaño",
      options: [
        { label: "S", value: "s" },
        { label: "M", value: "m" },
        { label: "L", value: "l" },
      ],
    },
    align: alignField,
  },
  defaultProps: { text: "Texto de párrafo.", size: "m", align: "left" },
  render: ({ text, size, align }) => (
    <p
      className={`text-neutral-600 ${{ s: "text-sm", m: "text-base", l: "text-lg" }[size]} ${
        align === "center" ? "text-center" : "text-left"
      }`}
    >
      {text}
    </p>
  ),
};

export type ButtonRowProps = {
  buttons: { label: string; href: string; style: "primary" | "secondary" | "ghost" }[];
  align: Align;
};

export const ButtonRow: ComponentConfig<ButtonRowProps> = {
  label: "Fila de botones",
  fields: {
    buttons: {
      type: "array",
      label: "Botones",
      getItemSummary: (item) => item.label || "Botón",
      arrayFields: {
        label: { type: "text", label: "Etiqueta" },
        href: { type: "text", label: "Enlace" },
        style: {
          type: "select",
          label: "Estilo",
          options: [
            { label: "Primario", value: "primary" },
            { label: "Secundario", value: "secondary" },
            { label: "Ghost", value: "ghost" },
          ],
        },
      },
      defaultItemProps: { label: "Botón", href: "#", style: "primary" },
    },
    align: alignField,
  },
  defaultProps: {
    buttons: [{ label: "Acción", href: "#", style: "primary" }],
    align: "left",
  },
  render: ({ buttons, align }) => (
    <div
      className={`flex flex-wrap gap-3 ${align === "center" ? "justify-center" : ""}`}
    >
      {buttons.map((b, i) => (
        <CtaButton key={i} label={b.label} href={b.href} style={b.style} />
      ))}
    </div>
  ),
};

export type ImageTextProps = {
  title: string;
  body: string;
  mediaSide: "left" | "right";
  tone: Tone;
  padding: Padding;
};

export const ImageText: ComponentConfig<ImageTextProps> = {
  label: "Imagen + texto",
  fields: {
    title: { type: "text", label: "Título" },
    body: { type: "textarea", label: "Texto" },
    mediaSide: {
      type: "radio",
      label: "Lado del media",
      options: [
        { label: "Izquierda", value: "left" },
        { label: "Derecha", value: "right" },
      ],
    },
    tone: toneField,
    padding: paddingField,
  },
  defaultProps: {
    title: "Un argumento con su imagen",
    body: "Bloque editorial de apoyo.",
    mediaSide: "left",
    tone: "light",
    padding: "normal",
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      <div className="grid items-center gap-10 lg:grid-cols-2">
        {p.mediaSide === "left" && <MediaPlaceholder ratio="video" />}
        <div>
          <h3 className="text-2xl font-bold tracking-tight">{p.title}</h3>
          <p className={`mt-3 ${mutedClass[p.tone]}`}>{p.body}</p>
        </div>
        {p.mediaSide === "right" && <MediaPlaceholder ratio="video" />}
      </div>
    </SectionShell>
  ),
};

export type StepsProps = {
  eyebrow: string;
  title: string;
  tone: Tone;
  padding: Padding;
  steps: { title: string; body: string }[];
};

export const Steps: ComponentConfig<StepsProps> = {
  label: "Pasos (cómo funciona)",
  fields: {
    eyebrow: { type: "text", label: "Eyebrow" },
    title: { type: "text", label: "Título" },
    tone: toneField,
    padding: paddingField,
    steps: {
      type: "array",
      label: "Pasos",
      getItemSummary: (item, i) => item.title || `Paso ${(i ?? 0) + 1}`,
      arrayFields: {
        title: { type: "text", label: "Título" },
        body: { type: "textarea", label: "Texto" },
      },
      defaultItemProps: { title: "Paso", body: "" },
    },
  },
  defaultProps: {
    eyebrow: "Proceso",
    title: "Cómo funciona",
    tone: "light",
    padding: "normal",
    steps: [
      { title: "Conecta", body: "Describe tu proyecto." },
      { title: "Compón", body: "Arrastra secciones gobernadas." },
      { title: "Publica", body: "Aprueba y despliega." },
    ],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      <Eyebrow tone={p.tone}>{p.eyebrow}</Eyebrow>
      <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
      <ol className="mt-10 grid gap-8 sm:grid-cols-3">
        {p.steps.map((s, i) => (
          <li key={i} className={`rounded-lg p-6 ${cardClass[p.tone]}`}>
            <span className="font-mono text-sm text-brand-600">0{i + 1}</span>
            <h3 className="mt-2 font-semibold">{s.title}</h3>
            <p className={`mt-1 text-sm ${mutedClass[p.tone]}`}>{s.body}</p>
          </li>
        ))}
      </ol>
    </SectionShell>
  ),
};

export type TimelineProps = {
  title: string;
  tone: Tone;
  padding: Padding;
  items: { date: string; title: string; body: string }[];
};

export const Timeline: ComponentConfig<TimelineProps> = {
  label: "Línea de tiempo",
  fields: {
    title: { type: "text", label: "Título" },
    tone: toneField,
    padding: paddingField,
    items: {
      type: "array",
      label: "Hitos",
      getItemSummary: (item) => item.title || "Hito",
      arrayFields: {
        date: { type: "text", label: "Fecha" },
        title: { type: "text", label: "Título" },
        body: { type: "textarea", label: "Texto" },
      },
      defaultItemProps: { date: "2026", title: "Hito", body: "" },
    },
  },
  defaultProps: {
    title: "Historia",
    tone: "light",
    padding: "normal",
    items: [{ date: "2026", title: "Fundación", body: "Empezamos." }],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="narrow">
      <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
      <ul className="mt-8 space-y-6 border-l border-neutral-300 pl-6">
        {p.items.map((it, i) => (
          <li key={i}>
            <span className="font-mono text-xs uppercase text-neutral-500">{it.date}</span>
            <h3 className="font-semibold">{it.title}</h3>
            <p className={`text-sm ${mutedClass[p.tone]}`}>{it.body}</p>
          </li>
        ))}
      </ul>
    </SectionShell>
  ),
};

export type QuoteProps = {
  quote: string;
  attribution: string;
  tone: Tone;
  padding: Padding;
};

export const Quote: ComponentConfig<QuoteProps> = {
  label: "Cita destacada",
  fields: {
    quote: { type: "textarea", label: "Cita" },
    attribution: { type: "text", label: "Atribución" },
    tone: toneField,
    padding: paddingField,
  },
  defaultProps: {
    quote: "Una frase memorable de alguien creíble.",
    attribution: "Nombre, cargo",
    tone: "subtle",
    padding: "normal",
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="narrow">
      <blockquote className="text-balance text-center text-2xl font-medium leading-relaxed">
        “{p.quote}”
      </blockquote>
      <p className={`mt-4 text-center text-sm ${mutedClass[p.tone]}`}>— {p.attribution}</p>
    </SectionShell>
  ),
};

export type VideoEmbedProps = {
  caption: string;
  ratio: "video" | "wide";
  tone: Tone;
  padding: Padding;
};

export const VideoEmbed: ComponentConfig<VideoEmbedProps> = {
  label: "Vídeo (placeholder)",
  fields: {
    caption: { type: "text", label: "Pie de vídeo" },
    ratio: {
      type: "radio",
      label: "Proporción",
      options: [
        { label: "16:9", value: "video" },
        { label: "21:9", value: "wide" },
      ],
    },
    tone: toneField,
    padding: paddingField,
  },
  defaultProps: { caption: "", ratio: "video", tone: "light", padding: "normal" },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="normal">
      <MediaPlaceholder ratio={p.ratio} label="video" />
      {p.caption ? (
        <p className={`mt-3 text-center text-sm ${mutedClass[p.tone]}`}>{p.caption}</p>
      ) : null}
    </SectionShell>
  ),
};

export type BannerProps = {
  text: string;
  linkLabel: string;
  linkHref: string;
  tone: "brand" | "dark";
};

export const Banner: ComponentConfig<BannerProps> = {
  label: "Banner (anuncio)",
  fields: {
    text: { type: "text", label: "Texto" },
    linkLabel: { type: "text", label: "Enlace — etiqueta" },
    linkHref: { type: "text", label: "Enlace — destino" },
    tone: {
      type: "radio",
      label: "Tono",
      options: [
        { label: "Marca", value: "brand" },
        { label: "Oscuro", value: "dark" },
      ],
    },
  },
  defaultProps: {
    text: "Anuncio breve y útil.",
    linkLabel: "Saber más",
    linkHref: "#",
    tone: "brand",
  },
  render: (p) => (
    <div
      className={`px-6 py-2.5 text-center text-sm ${
        p.tone === "brand" ? "bg-brand-700 text-white" : "bg-neutral-950 text-neutral-50"
      }`}
    >
      {p.text}{" "}
      {p.linkLabel ? (
        <a href={p.linkHref || "#"} className="font-semibold underline underline-offset-2">
          {p.linkLabel}
        </a>
      ) : null}
    </div>
  ),
};
