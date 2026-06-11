"use client";

import { useState } from "react";

import { Field, Textarea } from "@/ui";

import type { ArtifactFormProps } from "./types";

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

/**
 * Editor genérico JSON — fallback para tipos sin formulario dedicado en Spec
 * OS (`page.composition` y `release` se editan en sus propios módulos en
 * fases posteriores; aquí solo se ofrece edición estructural cruda).
 */
export function JsonPayloadForm({ value, onChange, readOnly, issues }: ArtifactFormProps) {
  const [text, setText] = useState(() => stringify(value));
  const [parseError, setParseError] = useState<string | null>(null);

  if (readOnly) {
    return (
      <pre className="overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-5 text-foreground">
        {stringify(value)}
      </pre>
    );
  }

  const issueCount = Object.keys(issues).length;

  return (
    <Field
      label="Payload (JSON)"
      htmlFor="json-payload"
      hint="Este tipo se edita en su propio módulo en fases posteriores; aquí puedes ajustar el JSON directamente."
      error={parseError ?? undefined}
    >
      <Textarea
        id="json-payload"
        value={text}
        invalid={!!parseError || issueCount > 0}
        className="min-h-72 font-mono text-xs leading-5"
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          try {
            const parsed: unknown = JSON.parse(next);
            setParseError(null);
            onChange(parsed);
          } catch {
            setParseError("JSON inválido: corrige la sintaxis antes de guardar.");
          }
        }}
      />
    </Field>
  );
}
