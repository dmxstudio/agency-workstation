"use client";

import { useMemo } from "react";

import type { SpecStrategyPayload } from "@/modules/artifacts/types";
import { Field, Input, Textarea } from "@/ui";

import { asArray, asObject, asString, asStringArray, optionalString } from "./coerce";
import { AddButton, FormSection, RowControls, StringListEditor } from "./controls";
import { moveItem, removeAt, replaceAt } from "./list-utils";
import { issueAt, pathKey, type ArtifactFormProps } from "./types";

interface AudienceDraft {
  name: string;
  description: string;
  needs: string[];
}

interface StrategyDraft {
  audiences: AudienceDraft[];
  positioning: string;
  valueProposition: string;
  differentiators: string[];
  toneOfVoice: { attributes: string[]; notes: string };
}

function coerceAudience(value: unknown): AudienceDraft {
  const v = asObject(value);
  return {
    name: asString(v.name),
    description: asString(v.description),
    needs: asStringArray(v.needs),
  };
}

function coerce(value: unknown): StrategyDraft {
  const v = asObject(value);
  const tone = asObject(v.toneOfVoice);
  const audiences = asArray(v.audiences).map(coerceAudience);
  return {
    audiences: audiences.length > 0 ? audiences : [coerceAudience(null)],
    positioning: asString(v.positioning),
    valueProposition: asString(v.valueProposition),
    differentiators: asStringArray(v.differentiators),
    toneOfVoice: { attributes: asStringArray(tone.attributes), notes: asString(tone.notes) },
  };
}

function toPayload(draft: StrategyDraft): SpecStrategyPayload {
  return {
    audiences: draft.audiences.map((audience) => ({
      name: audience.name,
      description: optionalString(audience.description),
      needs: audience.needs,
    })),
    positioning: draft.positioning,
    valueProposition: draft.valueProposition,
    differentiators: draft.differentiators,
    toneOfVoice: {
      attributes: draft.toneOfVoice.attributes,
      notes: optionalString(draft.toneOfVoice.notes),
    },
  };
}

export function createEmptyStrategyPayload(): SpecStrategyPayload {
  return toPayload(coerce(null));
}

/** `spec.strategy` — audiencias, posicionamiento, propuesta de valor y tono (§7.2). */
export function StrategyForm({ value, onChange, readOnly, issues }: ArtifactFormProps) {
  const draft = useMemo(() => coerce(value), [value]);
  const emit = (next: StrategyDraft) => onChange(toPayload(next));

  return (
    <div className="flex flex-col gap-4">
      <FormSection title="Audiencias" description="Define al menos una audiencia.">
        {issueAt(issues, "audiences") ? (
          <p role="alert" className="text-xs text-accent-danger">
            {issueAt(issues, "audiences")}
          </p>
        ) : null}
        {draft.audiences.map((audience, index) => (
          <div key={index} className="rounded-md border border-border bg-background p-3">
            <div className="flex items-start gap-1.5">
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <Field
                  label={`Audiencia ${index + 1}`}
                  required
                  error={issueAt(issues, "audiences", index, "name")}
                >
                  <Input
                    value={audience.name}
                    disabled={readOnly}
                    invalid={!!issueAt(issues, "audiences", index, "name")}
                    placeholder="Nombre de la audiencia"
                    onChange={(event) =>
                      emit({
                        ...draft,
                        audiences: replaceAt(draft.audiences, index, {
                          ...audience,
                          name: event.target.value,
                        }),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Descripción"
                  error={issueAt(issues, "audiences", index, "description")}
                >
                  <Input
                    value={audience.description}
                    disabled={readOnly}
                    onChange={(event) =>
                      emit({
                        ...draft,
                        audiences: replaceAt(draft.audiences, index, {
                          ...audience,
                          description: event.target.value,
                        }),
                      })
                    }
                  />
                </Field>
              </div>
              <RowControls
                index={index}
                count={draft.audiences.length}
                disabled={readOnly}
                onMove={(delta) =>
                  emit({ ...draft, audiences: moveItem(draft.audiences, index, delta) })
                }
                onRemove={() =>
                  emit({ ...draft, audiences: removeAt(draft.audiences, index) })
                }
              />
            </div>
            <div className="mt-3">
              <StringListEditor
                label="Necesidades"
                values={audience.needs}
                readOnly={readOnly}
                basePath={pathKey("audiences", index, "needs")}
                issues={issues}
                addLabel="Añadir necesidad"
                onChange={(needs) =>
                  emit({
                    ...draft,
                    audiences: replaceAt(draft.audiences, index, { ...audience, needs }),
                  })
                }
              />
            </div>
          </div>
        ))}
        <AddButton
          label="Añadir audiencia"
          disabled={readOnly}
          onClick={() =>
            emit({ ...draft, audiences: [...draft.audiences, coerceAudience(null)] })
          }
        />
      </FormSection>

      <FormSection title="Posicionamiento">
        <Field
          label="Posicionamiento"
          htmlFor="strategy-positioning"
          required
          error={issueAt(issues, "positioning")}
        >
          <Textarea
            id="strategy-positioning"
            value={draft.positioning}
            disabled={readOnly}
            invalid={!!issueAt(issues, "positioning")}
            onChange={(event) => emit({ ...draft, positioning: event.target.value })}
          />
        </Field>
        <Field
          label="Propuesta de valor"
          htmlFor="strategy-value"
          required
          error={issueAt(issues, "valueProposition")}
        >
          <Textarea
            id="strategy-value"
            value={draft.valueProposition}
            disabled={readOnly}
            invalid={!!issueAt(issues, "valueProposition")}
            onChange={(event) => emit({ ...draft, valueProposition: event.target.value })}
          />
        </Field>
        <StringListEditor
          label="Diferenciadores"
          values={draft.differentiators}
          readOnly={readOnly}
          basePath="differentiators"
          issues={issues}
          addLabel="Añadir diferenciador"
          onChange={(differentiators) => emit({ ...draft, differentiators })}
        />
      </FormSection>

      <FormSection title="Tono de voz">
        <StringListEditor
          label="Atributos"
          values={draft.toneOfVoice.attributes}
          readOnly={readOnly}
          basePath="toneOfVoice.attributes"
          issues={issues}
          placeholder="p.ej. cercano, técnico, directo"
          addLabel="Añadir atributo"
          onChange={(attributes) =>
            emit({ ...draft, toneOfVoice: { ...draft.toneOfVoice, attributes } })
          }
        />
        <Field label="Notas" htmlFor="strategy-tone-notes" error={issueAt(issues, "toneOfVoice", "notes")}>
          <Textarea
            id="strategy-tone-notes"
            value={draft.toneOfVoice.notes}
            disabled={readOnly}
            className="min-h-12"
            onChange={(event) =>
              emit({
                ...draft,
                toneOfVoice: { ...draft.toneOfVoice, notes: event.target.value },
              })
            }
          />
        </Field>
      </FormSection>
    </div>
  );
}
