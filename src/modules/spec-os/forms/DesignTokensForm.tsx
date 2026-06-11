"use client";

import { useMemo } from "react";

import type { DesignTokensPayload } from "@/modules/artifacts/types";
import { Field, Input } from "@/ui";

import { asNumber, asObject, asString, asStringArray, asStringRecord, optionalString } from "./coerce";
import { FormSection, StringListEditor, TokenMapEditor } from "./controls";
import { issueAt, type ArtifactFormProps } from "./types";

interface DesignTokensDraft {
  colors: Record<string, string>;
  typography: {
    fontFamilies: { sans: string; serif: string; mono: string };
    baseSizePx: number;
    scaleRatio: string; // texto editable; "" = sin escala
  };
  spacing: Record<string, string>;
  radii: Record<string, string>;
  components: string[];
}

function coerce(value: unknown): DesignTokensDraft {
  const v = asObject(value);
  const typography = asObject(v.typography);
  const fontFamilies = asObject(typography.fontFamilies);
  const scaleRatio = typography.scaleRatio;
  return {
    colors: asStringRecord(v.colors),
    typography: {
      fontFamilies: {
        sans: asString(fontFamilies.sans),
        serif: asString(fontFamilies.serif),
        mono: asString(fontFamilies.mono),
      },
      baseSizePx: asNumber(typography.baseSizePx, 16),
      scaleRatio:
        typeof scaleRatio === "number" && Number.isFinite(scaleRatio)
          ? String(scaleRatio)
          : "",
    },
    spacing: asStringRecord(v.spacing),
    radii: asStringRecord(v.radii),
    components: asStringArray(v.components),
  };
}

function toPayload(draft: DesignTokensDraft): DesignTokensPayload {
  const parsedScale = Number(draft.typography.scaleRatio);
  return {
    colors: draft.colors,
    typography: {
      fontFamilies: {
        sans: draft.typography.fontFamilies.sans,
        serif: optionalString(draft.typography.fontFamilies.serif),
        mono: optionalString(draft.typography.fontFamilies.mono),
      },
      baseSizePx: draft.typography.baseSizePx,
      scaleRatio:
        draft.typography.scaleRatio.trim() !== "" && Number.isFinite(parsedScale)
          ? parsedScale
          : undefined,
    },
    spacing: draft.spacing,
    radii: draft.radii,
    components: draft.components,
  };
}

export function createEmptyDesignTokensPayload(): DesignTokensPayload {
  return toPayload(coerce(null));
}

/** `design.tokens` — tokens de color, tipografía, spacing, radios y registry (§7.2). */
export function DesignTokensForm({ value, onChange, readOnly, issues }: ArtifactFormProps) {
  const draft = useMemo(() => coerce(value), [value]);
  const emit = (next: DesignTokensDraft) => onChange(toPayload(next));

  return (
    <div className="flex flex-col gap-4">
      <FormSection title="Colores" description="Nombre de token → valor CSS.">
        <TokenMapEditor
          label="Tokens de color"
          value={draft.colors}
          readOnly={readOnly}
          basePath="colors"
          issues={issues}
          keyPlaceholder="primary"
          valuePlaceholder="#111827"
          onChange={(colors) => emit({ ...draft, colors })}
        />
      </FormSection>

      <FormSection title="Tipografía">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Sans"
            required
            error={issueAt(issues, "typography", "fontFamilies", "sans")}
          >
            <Input
              value={draft.typography.fontFamilies.sans}
              disabled={readOnly}
              invalid={!!issueAt(issues, "typography", "fontFamilies", "sans")}
              placeholder="Inter"
              onChange={(event) =>
                emit({
                  ...draft,
                  typography: {
                    ...draft.typography,
                    fontFamilies: {
                      ...draft.typography.fontFamilies,
                      sans: event.target.value,
                    },
                  },
                })
              }
            />
          </Field>
          <Field label="Serif" error={issueAt(issues, "typography", "fontFamilies", "serif")}>
            <Input
              value={draft.typography.fontFamilies.serif}
              disabled={readOnly}
              onChange={(event) =>
                emit({
                  ...draft,
                  typography: {
                    ...draft.typography,
                    fontFamilies: {
                      ...draft.typography.fontFamilies,
                      serif: event.target.value,
                    },
                  },
                })
              }
            />
          </Field>
          <Field label="Mono" error={issueAt(issues, "typography", "fontFamilies", "mono")}>
            <Input
              value={draft.typography.fontFamilies.mono}
              disabled={readOnly}
              onChange={(event) =>
                emit({
                  ...draft,
                  typography: {
                    ...draft.typography,
                    fontFamilies: {
                      ...draft.typography.fontFamilies,
                      mono: event.target.value,
                    },
                  },
                })
              }
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Tamaño base (px)"
            error={issueAt(issues, "typography", "baseSizePx")}
          >
            <Input
              type="number"
              min={1}
              value={String(draft.typography.baseSizePx)}
              disabled={readOnly}
              invalid={!!issueAt(issues, "typography", "baseSizePx")}
              onChange={(event) =>
                emit({
                  ...draft,
                  typography: {
                    ...draft.typography,
                    baseSizePx: asNumber(Number(event.target.value), 16),
                  },
                })
              }
            />
          </Field>
          <Field
            label="Razón de escala"
            hint="p.ej. 1.25 (opcional)."
            error={issueAt(issues, "typography", "scaleRatio")}
          >
            <Input
              value={draft.typography.scaleRatio}
              disabled={readOnly}
              invalid={!!issueAt(issues, "typography", "scaleRatio")}
              inputMode="decimal"
              onChange={(event) =>
                emit({
                  ...draft,
                  typography: { ...draft.typography, scaleRatio: event.target.value },
                })
              }
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Spacing">
        <TokenMapEditor
          label="Tokens de spacing"
          value={draft.spacing}
          readOnly={readOnly}
          basePath="spacing"
          issues={issues}
          keyPlaceholder="sm"
          valuePlaceholder="0.5rem"
          onChange={(spacing) => emit({ ...draft, spacing })}
        />
      </FormSection>

      <FormSection title="Radios">
        <TokenMapEditor
          label="Tokens de radio"
          value={draft.radii}
          readOnly={readOnly}
          basePath="radii"
          issues={issues}
          keyPlaceholder="md"
          valuePlaceholder="0.375rem"
          onChange={(radii) => emit({ ...draft, radii })}
        />
      </FormSection>

      <FormSection
        title="Componentes del registry"
        description="Componentes seleccionados para el proyecto (§7.5)."
      >
        <StringListEditor
          label="Componentes"
          values={draft.components}
          readOnly={readOnly}
          basePath="components"
          issues={issues}
          placeholder="p.ej. hero, pricing, testimonials"
          addLabel="Añadir componente"
          onChange={(components) => emit({ ...draft, components })}
        />
      </FormSection>
    </div>
  );
}
