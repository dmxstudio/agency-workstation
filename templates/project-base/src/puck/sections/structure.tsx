import type { ComponentConfig, Slot } from "@puckeditor/core";
import {
  SectionShell,
  toneField,
  paddingField,
  type Tone,
  type Padding,
  type Width,
} from "../primitives";

/**
 * Structural components — these exercise the SLOT API (the replacement for
 * the deprecated zones/DropZone API).
 */

export type SectionProps = {
  tone: Tone;
  padding: Padding;
  width: Width;
  content: Slot;
};

export const Section: ComponentConfig<SectionProps> = {
  label: "Sección (contenedor)",
  fields: {
    tone: toneField,
    padding: paddingField,
    width: {
      type: "select",
      label: "Anchura",
      options: [
        { label: "Estrecha", value: "narrow" },
        { label: "Normal", value: "normal" },
        { label: "Ancha", value: "wide" },
      ],
    },
    content: { type: "slot" },
  },
  defaultProps: {
    tone: "subtle",
    padding: "normal",
    width: "wide",
    content: [],
  },
  render: ({ tone, padding, width, content: Content }) => (
    <SectionShell tone={tone} padding={padding} width={width}>
      <Content />
    </SectionShell>
  ),
};

export type ColumnsProps = {
  layout: "50-50" | "60-40" | "40-60" | "33-33-33";
  gap: "compact" | "normal" | "wide";
  col1: Slot;
  col2: Slot;
  col3: Slot;
};

const layoutClass: Record<ColumnsProps["layout"], string> = {
  "50-50": "lg:grid-cols-2",
  "60-40": "lg:grid-cols-[3fr_2fr]",
  "40-60": "lg:grid-cols-[2fr_3fr]",
  "33-33-33": "lg:grid-cols-3",
};

const gapClass: Record<ColumnsProps["gap"], string> = {
  compact: "gap-4",
  normal: "gap-8",
  wide: "gap-16",
};

export const Columns: ComponentConfig<ColumnsProps> = {
  label: "Columnas",
  fields: {
    layout: {
      type: "select",
      label: "Distribución",
      options: [
        { label: "50 / 50", value: "50-50" },
        { label: "60 / 40", value: "60-40" },
        { label: "40 / 60", value: "40-60" },
        { label: "33 / 33 / 33", value: "33-33-33" },
      ],
    },
    gap: {
      type: "select",
      label: "Separación",
      options: [
        { label: "Compacta", value: "compact" },
        { label: "Normal", value: "normal" },
        { label: "Amplia", value: "wide" },
      ],
    },
    col1: { type: "slot" },
    col2: { type: "slot" },
    col3: { type: "slot" },
  },
  defaultProps: {
    layout: "50-50",
    gap: "normal",
    col1: [],
    col2: [],
    col3: [],
  },
  render: ({ layout, gap, col1: Col1, col2: Col2, col3: Col3 }) => (
    <div className={`grid ${gapClass[gap]} ${layoutClass[layout]}`}>
      <Col1 />
      <Col2 />
      {layout === "33-33-33" ? <Col3 /> : null}
    </div>
  ),
};

export type SpacerProps = { size: "s" | "m" | "l" | "xl" };

export const Spacer: ComponentConfig<SpacerProps> = {
  label: "Espaciador",
  fields: {
    size: {
      type: "radio",
      label: "Tamaño",
      options: [
        { label: "S", value: "s" },
        { label: "M", value: "m" },
        { label: "L", value: "l" },
        { label: "XL", value: "xl" },
      ],
    },
  },
  defaultProps: { size: "m" },
  render: ({ size }) => (
    <div className={{ s: "h-4", m: "h-8", l: "h-16", xl: "h-28" }[size]} />
  ),
};

export type DividerProps = { style: "line" | "dots" | "blank" };

export const Divider: ComponentConfig<DividerProps> = {
  label: "Separador",
  fields: {
    style: {
      type: "radio",
      label: "Estilo",
      options: [
        { label: "Línea", value: "line" },
        { label: "Puntos", value: "dots" },
        { label: "Invisible", value: "blank" },
      ],
    },
  },
  defaultProps: { style: "line" },
  render: ({ style }) => {
    if (style === "blank") return <div className="h-px" />;
    if (style === "dots")
      return (
        <div className="flex justify-center gap-2 py-6 text-neutral-400">
          <span>•</span>
          <span>•</span>
          <span>•</span>
        </div>
      );
    return <hr className="mx-auto my-6 max-w-7xl border-neutral-200" />;
  },
};
