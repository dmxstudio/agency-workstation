import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Shared visual primitives for the section registry.
 * Every visual option is an ENUMERATED variant — no free CSS anywhere.
 * Tailwind classes are literal strings so the compiler can see them.
 * Brand utilities (bg-brand-600, …) resolve to the CSS variables emitted in
 * src/generated/tokens.css (codegen-owned, from the design.tokens artifact).
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
  id,
  tone = "light",
  padding = "normal",
  width = "wide",
  children,
}: {
  /** Puck block id — DOM id of the section (review anchors `#<sectionId>`). */
  id?: string;
  tone?: Tone;
  padding?: Padding;
  width?: Width;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`${toneClass[tone]} ${paddingClass[padding]}`}>
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

/** Solid-color media placeholder — the spike ships no binary assets. */
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

/** Minimal shape of a Puck component config this wrapper cares about. */
type AnchorableComponent = {
  render: (props: never) => ReactNode;
};

/**
 * Review anchors: every section renders its Puck block id as the `id`
 * attribute of its ROOT element, so review comments can deep-link to a
 * section via URL hash (`#<blockId>`). Single change point for the whole
 * registry: wraps each component's render and injects the block id into the
 * root element — DOM roots (header/footer/div/p…) receive it directly;
 * SectionShell forwards its `id` prop to the underlying <section>.
 */
export function withBlockAnchors<T extends Record<string, AnchorableComponent>>(
  components: T,
): T {
  const anchored: Record<string, AnchorableComponent> = {};
  for (const [name, component] of Object.entries(components)) {
    const render = component.render;
    anchored[name] = {
      ...component,
      render: (props) => {
        const node = render(props);
        const id = (props as { id?: string }).id;
        if (id && isValidElement(node)) {
          return cloneElement(node as ReactElement<{ id?: string }>, { id });
        }
        return node;
      },
    };
  }
  return anchored as T;
}
