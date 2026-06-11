import type { ReactNode } from "react";

/**
 * COPIA SINCRONIZADA del template — fuente de verdad:
 * `templates/project-base/src/puck/primitives.tsx`.
 * No cambiar aquí sin cambiar allí (ver README.md de este directorio).
 *
 * Shared visual primitives for the section registry.
 * Every visual option is an ENUMERATED variant — no free CSS anywhere.
 * Tailwind classes are literal strings so the compiler can see them.
 * Brand utilities (bg-brand-600, …) resolve to CSS variables: in the
 * generated project they come from src/generated/tokens.css; in the Studio
 * canvas the platform maps brand-* in src/app/globals.css and injects the
 * project values (tokens-css.ts) inside the Puck iframe.
 */

export type Tone = "light" | "subtle" | "dark" | "brand";
export type Padding = "none" | "compact" | "normal" | "spacious";
export type Align = "left" | "center";
export type Width = "narrow" | "normal" | "wide";

export const toneClass: Record<Tone, string> = {
  light: "bg-white text-neutral-900",
  subtle: "bg-neutral-100 text-neutral-900",
  dark: "bg-neutral-950 text-neutral-50",
  brand: "bg-brand-700 text-white",
};

export const mutedClass: Record<Tone, string> = {
  light: "text-neutral-600",
  subtle: "text-neutral-600",
  dark: "text-neutral-400",
  brand: "text-brand-200",
};

export const cardClass: Record<Tone, string> = {
  light: "bg-neutral-50 border border-neutral-200",
  subtle: "bg-white border border-neutral-200",
  dark: "bg-neutral-900 border border-neutral-800",
  brand: "bg-brand-600 border border-brand-500",
};

export const paddingClass: Record<Padding, string> = {
  none: "py-0",
  compact: "py-8",
  normal: "py-16",
  spacious: "py-28",
};

export const alignClass: Record<Align, string> = {
  left: "text-left items-start",
  center: "text-center items-center",
};

export const widthClass: Record<Width, string> = {
  narrow: "max-w-2xl",
  normal: "max-w-5xl",
  wide: "max-w-7xl",
};

export function SectionShell({
  tone = "light",
  padding = "normal",
  width = "wide",
  children,
}: {
  tone?: Tone;
  padding?: Padding;
  width?: Width;
  children: ReactNode;
}) {
  return (
    <section className={`${toneClass[tone]} ${paddingClass[padding]}`}>
      <div className={`mx-auto px-6 ${widthClass[width]}`}>{children}</div>
    </section>
  );
}

export function Eyebrow({ tone, children }: { tone: Tone; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      className={`mb-3 text-xs font-semibold uppercase tracking-widest ${
        tone === "brand" ? "text-brand-200" : "text-brand-600"
      }`}
    >
      {children}
    </p>
  );
}

export type ButtonStyle = "primary" | "secondary" | "ghost";

export const buttonClass: Record<ButtonStyle, string> = {
  primary:
    "inline-block rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500",
  secondary:
    "inline-block rounded-md border border-current px-5 py-2.5 text-sm font-semibold",
  ghost: "inline-block px-5 py-2.5 text-sm font-semibold underline underline-offset-4",
};

export function CtaButton({
  label,
  href,
  style = "primary",
}: {
  label?: string;
  href?: string;
  style?: ButtonStyle;
}) {
  if (!label) return null;
  return (
    <a href={href || "#"} className={buttonClass[style]}>
      {label}
    </a>
  );
}

/** Solid-color media placeholder — the template ships no binary assets. */
export function MediaPlaceholder({
  ratio = "video",
  label,
}: {
  ratio?: "video" | "square" | "portrait" | "wide";
  label?: string;
}) {
  const ratioClass = {
    video: "aspect-video",
    square: "aspect-square",
    portrait: "aspect-[3/4]",
    wide: "aspect-[21/9]",
  }[ratio];
  return (
    <div
      className={`${ratioClass} flex w-full items-center justify-center rounded-lg bg-neutral-300 text-xs font-medium uppercase tracking-wider text-neutral-600`}
    >
      {label ?? "media"}
    </div>
  );
}

export const gridColsClass: Record<string, string> = {
  "2": "grid gap-8 sm:grid-cols-2",
  "3": "grid gap-8 sm:grid-cols-2 lg:grid-cols-3",
  "4": "grid gap-8 sm:grid-cols-2 lg:grid-cols-4",
};

/** Common enumerated fields reused across component configs. */
export const toneField = {
  type: "select" as const,
  label: "Tono",
  options: [
    { label: "Claro", value: "light" },
    { label: "Sutil", value: "subtle" },
    { label: "Oscuro", value: "dark" },
    { label: "Marca", value: "brand" },
  ],
};

export const paddingField = {
  type: "select" as const,
  label: "Espaciado vertical",
  options: [
    { label: "Sin espaciado", value: "none" },
    { label: "Compacto", value: "compact" },
    { label: "Normal", value: "normal" },
    { label: "Amplio", value: "spacious" },
  ],
};

export const alignField = {
  type: "radio" as const,
  label: "Alineación",
  options: [
    { label: "Izquierda", value: "left" },
    { label: "Centro", value: "center" },
  ],
};

export const buttonStyleField = {
  type: "select" as const,
  label: "Estilo de botón",
  options: [
    { label: "Primario", value: "primary" },
    { label: "Secundario", value: "secondary" },
    { label: "Ghost", value: "ghost" },
  ],
};
