import type { ComponentConfig } from "@puckeditor/core";
import {
  SectionShell,
  Eyebrow,
  CtaButton,
  MediaPlaceholder,
  toneClass,
  mutedClass,
  alignClass,
  toneField,
  paddingField,
  alignField,
  buttonStyleField,
  type Tone,
  type Padding,
  type Align,
  type ButtonStyle,
} from "../primitives";

export type HeroProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  align: Align;
  tone: Tone;
  padding: Padding;
  size: "normal" | "large";
  primaryCta: string;
  primaryCtaHref: string;
  secondaryCta: string;
  secondaryCtaStyle: ButtonStyle;
};

export const Hero: ComponentConfig<HeroProps> = {
  label: "Hero",
  fields: {
    eyebrow: { type: "text", label: "Eyebrow" },
    title: { type: "text", label: "Título" },
    subtitle: { type: "textarea", label: "Subtítulo" },
    align: alignField,
    tone: toneField,
    padding: paddingField,
    size: {
      type: "radio",
      label: "Tamaño",
      options: [
        { label: "Normal", value: "normal" },
        { label: "Grande", value: "large" },
      ],
    },
    primaryCta: { type: "text", label: "CTA principal" },
    primaryCtaHref: { type: "text", label: "CTA principal — enlace" },
    secondaryCta: { type: "text", label: "CTA secundario" },
    secondaryCtaStyle: buttonStyleField,
  },
  defaultProps: {
    eyebrow: "Nuevo",
    title: "Un titular que vende el resultado",
    subtitle: "Una frase de apoyo que explica el cómo sin jerga.",
    align: "center",
    tone: "light",
    padding: "spacious",
    size: "large",
    primaryCta: "Empezar ahora",
    primaryCtaHref: "#",
    secondaryCta: "Ver demo",
    secondaryCtaStyle: "ghost",
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="normal">
      <div className={`flex flex-col gap-5 ${alignClass[p.align]}`}>
        <Eyebrow tone={p.tone}>{p.eyebrow}</Eyebrow>
        <h1
          className={`font-bold tracking-tight ${
            p.size === "large" ? "text-5xl md:text-6xl" : "text-4xl"
          }`}
        >
          {p.title}
        </h1>
        <p className={`max-w-xl text-lg ${mutedClass[p.tone]}`}>{p.subtitle}</p>
        <div className="mt-2 flex flex-wrap gap-3">
          <CtaButton label={p.primaryCta} href={p.primaryCtaHref} style="primary" />
          <CtaButton label={p.secondaryCta} style={p.secondaryCtaStyle} />
        </div>
      </div>
    </SectionShell>
  ),
};

export type HeroSplitProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  tone: Tone;
  padding: Padding;
  mediaSide: "left" | "right";
  mediaRatio: "video" | "square" | "portrait";
  cta: string;
  ctaHref: string;
};

export const HeroSplit: ComponentConfig<HeroSplitProps> = {
  label: "Hero partido (media)",
  fields: {
    eyebrow: { type: "text", label: "Eyebrow" },
    title: { type: "text", label: "Título" },
    subtitle: { type: "textarea", label: "Subtítulo" },
    tone: toneField,
    padding: paddingField,
    mediaSide: {
      type: "radio",
      label: "Lado del media",
      options: [
        { label: "Izquierda", value: "left" },
        { label: "Derecha", value: "right" },
      ],
    },
    mediaRatio: {
      type: "select",
      label: "Proporción del media",
      options: [
        { label: "16:9", value: "video" },
        { label: "Cuadrado", value: "square" },
        { label: "Retrato", value: "portrait" },
      ],
    },
    cta: { type: "text", label: "CTA" },
    ctaHref: { type: "text", label: "CTA — enlace" },
  },
  defaultProps: {
    eyebrow: "",
    title: "Titular con imagen al lado",
    subtitle: "El media se gobierna por variantes, no por CSS libre.",
    tone: "light",
    padding: "normal",
    mediaSide: "right",
    mediaRatio: "video",
    cta: "Saber más",
    ctaHref: "#",
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding}>
      <div
        className={`grid items-center gap-12 lg:grid-cols-2 ${
          p.mediaSide === "left" ? "lg:[direction:rtl]" : ""
        }`}
      >
        <div className="lg:[direction:ltr]">
          <Eyebrow tone={p.tone}>{p.eyebrow}</Eyebrow>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{p.title}</h1>
          <p className={`mt-4 text-lg ${mutedClass[p.tone]}`}>{p.subtitle}</p>
          <div className="mt-6">
            <CtaButton label={p.cta} href={p.ctaHref} style="primary" />
          </div>
        </div>
        <div className="lg:[direction:ltr]">
          <MediaPlaceholder ratio={p.mediaRatio} />
        </div>
      </div>
    </SectionShell>
  ),
};

export type HeroMinimalProps = {
  title: string;
  tone: Tone;
  padding: Padding;
};

export const HeroMinimal: ComponentConfig<HeroMinimalProps> = {
  label: "Hero mínimo",
  fields: {
    title: { type: "textarea", label: "Título" },
    tone: toneField,
    padding: paddingField,
  },
  defaultProps: {
    title: "Una sola frase, enorme.",
    tone: "dark",
    padding: "spacious",
  },
  render: (p) => (
    <SectionShell tone={p.tone} padding={p.padding} width="normal">
      <h1 className="text-balance text-5xl font-bold leading-tight tracking-tight md:text-7xl">
        {p.title}
      </h1>
    </SectionShell>
  ),
};

// keep imports referenced for variant class extraction
void toneClass;
