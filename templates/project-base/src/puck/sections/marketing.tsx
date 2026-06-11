import type { ComponentConfig } from "@puckeditor/core";
import {
  SectionShell,
  Eyebrow,
  CtaButton,
  MediaPlaceholder,
  mutedClass,
  cardClass,
  gridColsClass,
  toneField,
  paddingField,
  alignField,
  type Tone,
  type Padding,
  type Align,
} from "../primitives";

export type FeaturesProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  columns: "2" | "3" | "4";
  tone: Tone;
  padding: Padding;
  items: { icon: string; title: string; body: string }[];
};

export const Features: ComponentConfig<FeaturesProps> = {
  label: "Features (grid)",
  fields: {
    eyebrow: { type: "text", label: "Eyebrow" },
    title: { type: "text", label: "Título" },
    subtitle: { type: "textarea", label: "Subtítulo" },
    columns: {
      type: "select",
      label: "Columnas",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    tone: toneField,
    padding: paddingField,
    items: {
      type: "array",
      label: "Features",
      getItemSummary: (item) => item.title || "Feature",
      arrayFields: {
        icon: { type: "text", label: "Icono (emoji)" },
        title: { type: "text", label: "Título" },
        body: { type: "textarea", label: "Texto" },
      },
      defaultItemProps: { icon: "✦", title: "Feature", body: "" },
    },
  },
  defaultProps: {
    eyebrow: "Producto",
    title: "Todo lo que necesitas",
    subtitle: "",
    columns: "3",
    tone: "light",
    padding: "normal",
    items: [
      { icon: "⚡", title: "Rápido", body: "Sin esperas." },
      { icon: "🔒", title: "Seguro", body: "Datos protegidos." },
      { icon: "🧩", title: "Componible", body: "Piezas gobernadas." },
    ],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      <Eyebrow tone={p.tone}>{p.eyebrow}</Eyebrow>
      <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
      {p.subtitle ? <p className={`mt-3 max-w-2xl ${mutedClass[p.tone]}`}>{p.subtitle}</p> : null}
      <div className={`mt-10 ${gridColsClass[p.columns]}`}>
        {p.items.map((f, i) => (
          <div key={i} className={`rounded-lg p-6 ${cardClass[p.tone]}`}>
            <div className="text-2xl">{f.icon}</div>
            <h3 className="mt-3 font-semibold">{f.title}</h3>
            <p className={`mt-1 text-sm ${mutedClass[p.tone]}`}>{f.body}</p>
          </div>
        ))}
      </div>
    </SectionShell>
  ),
};

export type FeatureListProps = {
  title: string;
  tone: Tone;
  padding: Padding;
  items: { title: string; body: string }[];
};

export const FeatureList: ComponentConfig<FeatureListProps> = {
  label: "Features (lista)",
  fields: {
    title: { type: "text", label: "Título" },
    tone: toneField,
    padding: paddingField,
    items: {
      type: "array",
      label: "Elementos",
      getItemSummary: (item) => item.title || "Elemento",
      arrayFields: {
        title: { type: "text", label: "Título" },
        body: { type: "textarea", label: "Texto" },
      },
      defaultItemProps: { title: "Elemento", body: "" },
    },
  },
  defaultProps: {
    title: "Capacidades",
    tone: "light",
    padding: "normal",
    items: [{ title: "Capacidad", body: "Descripción." }],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="narrow">
      <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
      <ul className="mt-8 divide-y divide-neutral-200">
        {p.items.map((it, i) => (
          <li key={i} className="flex gap-4 py-4">
            <span className="mt-1 text-brand-600">✓</span>
            <div>
              <h3 className="font-semibold">{it.title}</h3>
              <p className={`text-sm ${mutedClass[p.tone]}`}>{it.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </SectionShell>
  ),
};

export type PricingProps = {
  eyebrow: string;
  title: string;
  tone: Tone;
  padding: Padding;
  tiers: {
    name: string;
    price: string;
    period: string;
    description: string;
    features: string;
    cta: string;
    highlighted: boolean;
  }[];
};

export const Pricing: ComponentConfig<PricingProps> = {
  label: "Pricing",
  fields: {
    eyebrow: { type: "text", label: "Eyebrow" },
    title: { type: "text", label: "Título" },
    tone: toneField,
    padding: paddingField,
    tiers: {
      type: "array",
      label: "Planes",
      getItemSummary: (item) => item.name || "Plan",
      arrayFields: {
        name: { type: "text", label: "Nombre" },
        price: { type: "text", label: "Precio" },
        period: { type: "text", label: "Periodo" },
        description: { type: "text", label: "Descripción" },
        features: { type: "textarea", label: "Features (una por línea)" },
        cta: { type: "text", label: "CTA" },
        highlighted: {
          type: "radio",
          label: "Destacado",
          options: [
            { label: "Sí", value: true },
            { label: "No", value: false },
          ],
        },
      },
      defaultItemProps: {
        name: "Plan",
        price: "29€",
        period: "/mes",
        description: "",
        features: "Una feature\nOtra feature",
        cta: "Elegir",
        highlighted: false,
      },
    },
  },
  defaultProps: {
    eyebrow: "Precios",
    title: "Un plan para cada etapa",
    tone: "light",
    padding: "spacious",
    tiers: [
      {
        name: "Starter",
        price: "0€",
        period: "/mes",
        description: "Para probar",
        features: "1 proyecto\nSoporte comunidad",
        cta: "Empezar",
        highlighted: false,
      },
      {
        name: "Pro",
        price: "49€",
        period: "/mes",
        description: "Para equipos",
        features: "Proyectos ilimitados\nSoporte prioritario",
        cta: "Probar Pro",
        highlighted: true,
      },
    ],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      <div className="text-center">
        <Eyebrow tone={p.tone}>{p.eyebrow}</Eyebrow>
        <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
      </div>
      <div className="mt-12 grid items-stretch gap-8 lg:grid-cols-3">
        {p.tiers.map((t, i) => (
          <div
            key={i}
            className={`flex flex-col rounded-xl p-8 ${
              t.highlighted
                ? "border-2 border-brand-600 bg-white shadow-sm"
                : cardClass[p.tone]
            }`}
          >
            <h3 className="font-semibold">{t.name}</h3>
            <p className="mt-3">
              <span className="text-4xl font-bold">{t.price}</span>
              <span className={`text-sm ${mutedClass[p.tone]}`}>{t.period}</span>
            </p>
            <p className={`mt-2 text-sm ${mutedClass[p.tone]}`}>{t.description}</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {(t.features || "")
                .split("\n")
                .filter(Boolean)
                .map((f, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="text-brand-600">✓</span> {f}
                  </li>
                ))}
            </ul>
            <div className="mt-8">
              <CtaButton label={t.cta} style={t.highlighted ? "primary" : "secondary"} />
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  ),
};

export type CtaProps = {
  title: string;
  subtitle: string;
  cta: string;
  ctaHref: string;
  align: Align;
  tone: Tone;
  padding: Padding;
};

export const Cta: ComponentConfig<CtaProps> = {
  label: "CTA",
  fields: {
    title: { type: "text", label: "Título" },
    subtitle: { type: "textarea", label: "Subtítulo" },
    cta: { type: "text", label: "CTA" },
    ctaHref: { type: "text", label: "CTA — enlace" },
    align: alignField,
    tone: toneField,
    padding: paddingField,
  },
  defaultProps: {
    title: "¿Hablamos?",
    subtitle: "",
    cta: "Contactar",
    ctaHref: "#",
    align: "center",
    tone: "subtle",
    padding: "normal",
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="normal">
      <div className={p.align === "center" ? "text-center" : "text-left"}>
        <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
        {p.subtitle ? <p className={`mt-3 ${mutedClass[p.tone]}`}>{p.subtitle}</p> : null}
        <div className="mt-6">
          <CtaButton label={p.cta} href={p.ctaHref} style="primary" />
        </div>
      </div>
    </SectionShell>
  ),
};

export type CtaBannerProps = {
  title: string;
  cta: string;
  ctaHref: string;
  tone: "brand" | "dark";
};

export const CtaBanner: ComponentConfig<CtaBannerProps> = {
  label: "CTA banner",
  fields: {
    title: { type: "text", label: "Título" },
    cta: { type: "text", label: "CTA" },
    ctaHref: { type: "text", label: "CTA — enlace" },
    tone: {
      type: "radio",
      label: "Tono",
      options: [
        { label: "Marca", value: "brand" },
        { label: "Oscuro", value: "dark" },
      ],
    },
  },
  defaultProps: { title: "Empieza hoy", cta: "Crear cuenta", ctaHref: "#", tone: "brand" },
  render: (p) => (
    <SectionShell tone={p.tone === "brand" ? "brand" : "dark"} padding="normal">
      <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
        <h2 className="text-2xl font-bold tracking-tight">{p.title}</h2>
        <a
          href={p.ctaHref || "#"}
          className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-100"
        >
          {p.cta}
        </a>
      </div>
    </SectionShell>
  ),
};

export type StatsProps = {
  title: string;
  tone: Tone;
  padding: Padding;
  stats: { value: string; label: string }[];
};

export const Stats: ComponentConfig<StatsProps> = {
  label: "Stats",
  fields: {
    title: { type: "text", label: "Título (opcional)" },
    tone: toneField,
    padding: paddingField,
    stats: {
      type: "array",
      label: "Métricas",
      getItemSummary: (item) => item.label || "Métrica",
      arrayFields: {
        value: { type: "text", label: "Valor" },
        label: { type: "text", label: "Etiqueta" },
      },
      defaultItemProps: { value: "0", label: "Métrica" },
    },
  },
  defaultProps: {
    title: "",
    tone: "dark",
    padding: "normal",
    stats: [
      { value: "99,9%", label: "uptime" },
      { value: "4.800+", label: "clientes" },
      { value: "12ms", label: "latencia media" },
    ],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      {p.title ? (
        <h2 className="mb-10 text-center text-3xl font-bold tracking-tight">{p.title}</h2>
      ) : null}
      <dl className="grid gap-8 text-center sm:grid-cols-3">
        {p.stats.map((s, i) => (
          <div key={i}>
            <dd className="font-mono text-4xl font-bold">{s.value}</dd>
            <dt className={`mt-1 text-sm uppercase tracking-wider ${mutedClass[p.tone]}`}>
              {s.label}
            </dt>
          </div>
        ))}
      </dl>
    </SectionShell>
  ),
};

export type FaqProps = {
  title: string;
  tone: Tone;
  padding: Padding;
  items: { question: string; answer: string }[];
};

export const Faq: ComponentConfig<FaqProps> = {
  label: "FAQ",
  fields: {
    title: { type: "text", label: "Título" },
    tone: toneField,
    padding: paddingField,
    items: {
      type: "array",
      label: "Preguntas",
      getItemSummary: (item) => item.question || "Pregunta",
      arrayFields: {
        question: { type: "text", label: "Pregunta" },
        answer: { type: "textarea", label: "Respuesta" },
      },
      defaultItemProps: { question: "¿Pregunta?", answer: "Respuesta." },
    },
  },
  defaultProps: {
    title: "Preguntas frecuentes",
    tone: "light",
    padding: "normal",
    items: [{ question: "¿Cómo empiezo?", answer: "Creando una cuenta." }],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="narrow">
      <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
      <div className="mt-8 divide-y divide-neutral-200">
        {p.items.map((it, i) => (
          <details key={i} className="group py-4">
            <summary className="cursor-pointer list-none font-semibold">
              {it.question}
            </summary>
            <p className={`mt-2 text-sm ${mutedClass[p.tone]}`}>{it.answer}</p>
          </details>
        ))}
      </div>
    </SectionShell>
  ),
};

export type LogoCloudProps = {
  title: string;
  tone: Tone;
  logos: { name: string }[];
};

export const LogoCloud: ComponentConfig<LogoCloudProps> = {
  label: "Logos (clientes)",
  fields: {
    title: { type: "text", label: "Título" },
    tone: toneField,
    logos: {
      type: "array",
      label: "Logos",
      getItemSummary: (item) => item.name || "Logo",
      arrayFields: { name: { type: "text", label: "Nombre" } },
      defaultItemProps: { name: "Marca" },
    },
  },
  defaultProps: {
    title: "Confían en nosotros",
    tone: "light",
    logos: [{ name: "Acme" }, { name: "Globex" }, { name: "Umbrella" }, { name: "Initech" }],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding="compact">
      <p className={`text-center text-xs uppercase tracking-widest ${mutedClass[p.tone]}`}>
        {p.title}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
        {p.logos.map((l, i) => (
          <span key={i} className="text-lg font-bold tracking-tight opacity-50">
            {l.name}
          </span>
        ))}
      </div>
    </SectionShell>
  ),
};

export type GalleryProps = {
  title: string;
  columns: "2" | "3" | "4";
  ratio: "square" | "video" | "portrait";
  tone: Tone;
  padding: Padding;
  items: { caption: string }[];
};

export const Gallery: ComponentConfig<GalleryProps> = {
  label: "Galería",
  fields: {
    title: { type: "text", label: "Título" },
    columns: {
      type: "select",
      label: "Columnas",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    ratio: {
      type: "select",
      label: "Proporción",
      options: [
        { label: "Cuadrado", value: "square" },
        { label: "16:9", value: "video" },
        { label: "Retrato", value: "portrait" },
      ],
    },
    tone: toneField,
    padding: paddingField,
    items: {
      type: "array",
      label: "Piezas",
      getItemSummary: (item) => item.caption || "Pieza",
      arrayFields: { caption: { type: "text", label: "Pie" } },
      defaultItemProps: { caption: "" },
    },
  },
  defaultProps: {
    title: "Trabajo reciente",
    columns: "3",
    ratio: "square",
    tone: "light",
    padding: "normal",
    items: [{ caption: "Proyecto A" }, { caption: "Proyecto B" }, { caption: "Proyecto C" }],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      {p.title ? <h2 className="mb-8 text-3xl font-bold tracking-tight">{p.title}</h2> : null}
      <div className={gridColsClass[p.columns]}>
        {p.items.map((it, i) => (
          <figure key={i}>
            <MediaPlaceholder ratio={p.ratio} label={`img ${i + 1}`} />
            {it.caption ? (
              <figcaption className={`mt-2 text-sm ${mutedClass[p.tone]}`}>
                {it.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </SectionShell>
  ),
};

export type TeamProps = {
  title: string;
  tone: Tone;
  padding: Padding;
  members: { name: string; role: string }[];
};

export const Team: ComponentConfig<TeamProps> = {
  label: "Equipo",
  fields: {
    title: { type: "text", label: "Título" },
    tone: toneField,
    padding: paddingField,
    members: {
      type: "array",
      label: "Personas",
      getItemSummary: (item) => item.name || "Persona",
      arrayFields: {
        name: { type: "text", label: "Nombre" },
        role: { type: "text", label: "Cargo" },
      },
      defaultItemProps: { name: "Nombre", role: "Cargo" },
    },
  },
  defaultProps: {
    title: "El equipo",
    tone: "light",
    padding: "normal",
    members: [
      { name: "Alex", role: "Design Engineer" },
      { name: "Sam", role: "Estrategia" },
    ],
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
      <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {p.members.map((m, i) => (
          <div key={i}>
            <MediaPlaceholder ratio="square" label={m.name} />
            <h3 className="mt-3 font-semibold">{m.name}</h3>
            <p className={`text-sm ${mutedClass[p.tone]}`}>{m.role}</p>
          </div>
        ))}
      </div>
    </SectionShell>
  ),
};

export type NewsletterProps = {
  title: string;
  subtitle: string;
  buttonLabel: string;
  tone: Tone;
  padding: Padding;
};

export const Newsletter: ComponentConfig<NewsletterProps> = {
  label: "Newsletter",
  fields: {
    title: { type: "text", label: "Título" },
    subtitle: { type: "textarea", label: "Subtítulo" },
    buttonLabel: { type: "text", label: "Botón" },
    tone: toneField,
    padding: paddingField,
  },
  defaultProps: {
    title: "Recibe lo nuevo",
    subtitle: "Un correo al mes. Sin spam.",
    buttonLabel: "Suscribirme",
    tone: "subtle",
    padding: "normal",
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="narrow">
      <div className="text-center">
        <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
        <p className={`mt-2 ${mutedClass[p.tone]}`}>{p.subtitle}</p>
        <form className="mx-auto mt-6 flex max-w-md gap-2">
          <input
            type="email"
            placeholder="tu@correo.com"
            className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900"
          />
          <button
            type="button"
            className="shrink-0 rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white"
          >
            {p.buttonLabel}
          </button>
        </form>
      </div>
    </SectionShell>
  ),
};

export type ContactFormProps = {
  title: string;
  subtitle: string;
  layout: "stacked" | "split";
  showPhone: boolean;
  tone: Tone;
  padding: Padding;
};

export const ContactForm: ComponentConfig<ContactFormProps> = {
  label: "Contacto (formulario)",
  fields: {
    title: { type: "text", label: "Título" },
    subtitle: { type: "textarea", label: "Subtítulo" },
    layout: {
      type: "radio",
      label: "Distribución",
      options: [
        { label: "Apilado", value: "stacked" },
        { label: "Partido", value: "split" },
      ],
    },
    showPhone: {
      type: "radio",
      label: "Campo teléfono",
      options: [
        { label: "Mostrar", value: true },
        { label: "Ocultar", value: false },
      ],
    },
    tone: toneField,
    padding: paddingField,
  },
  defaultProps: {
    title: "Cuéntanos tu proyecto",
    subtitle: "Respondemos en 24 horas.",
    layout: "split",
    showPhone: false,
    tone: "light",
    padding: "spacious",
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="normal">
      <div className={p.layout === "split" ? "grid gap-12 lg:grid-cols-2" : "mx-auto max-w-xl"}>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{p.title}</h2>
          <p className={`mt-3 ${mutedClass[p.tone]}`}>{p.subtitle}</p>
        </div>
        <form className="mt-6 space-y-4 lg:mt-0">
          <input
            placeholder="Nombre"
            className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900"
          />
          <input
            placeholder="Email"
            className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900"
          />
          {p.showPhone ? (
            <input
              placeholder="Teléfono"
              className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900"
            />
          ) : null}
          <textarea
            placeholder="Mensaje"
            rows={4}
            className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900"
          />
          <button
            type="button"
            className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Enviar
          </button>
        </form>
      </div>
    </SectionShell>
  ),
};
