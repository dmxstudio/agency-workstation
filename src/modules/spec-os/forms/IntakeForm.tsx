"use client";

import { useMemo } from "react";

import type { SpecIntakePayload } from "@/modules/artifacts/types";
import { Field, Input, Textarea } from "@/ui";

import { asBoolean, asObject, asString, asStringArray, optionalString } from "./coerce";
import { CheckboxField, FormSection, StringListEditor } from "./controls";
import { issueAt, type ArtifactFormProps } from "./types";

/** Forma editable: todos los campos presentes, opcionales como `""`. */
interface IntakeDraft {
  objective: string;
  client: {
    name: string;
    industry: string;
    website: string;
    contactName: string;
    contactEmail: string;
  };
  scope: { inScope: string[]; outOfScope: string[] };
  constraints: { budget: string; deadline: string; technical: string[]; legal: string[] };
  brandInputs: { hasLogo: boolean; hasStyleGuide: boolean; assetsUrl: string; notes: string };
  successCriteria: string[];
}

function coerce(value: unknown): IntakeDraft {
  const v = asObject(value);
  const client = asObject(v.client);
  const scope = asObject(v.scope);
  const constraints = asObject(v.constraints);
  const brand = asObject(v.brandInputs);
  return {
    objective: asString(v.objective),
    client: {
      name: asString(client.name),
      industry: asString(client.industry),
      website: asString(client.website),
      contactName: asString(client.contactName),
      contactEmail: asString(client.contactEmail),
    },
    scope: {
      inScope: asStringArray(scope.inScope),
      outOfScope: asStringArray(scope.outOfScope),
    },
    constraints: {
      budget: asString(constraints.budget),
      deadline: asString(constraints.deadline),
      technical: asStringArray(constraints.technical),
      legal: asStringArray(constraints.legal),
    },
    brandInputs: {
      hasLogo: asBoolean(brand.hasLogo),
      hasStyleGuide: asBoolean(brand.hasStyleGuide),
      assetsUrl: asString(brand.assetsUrl),
      notes: asString(brand.notes),
    },
    successCriteria: asStringArray(v.successCriteria),
  };
}

/** Draft → payload Zod-friendly (opcionales vacíos fuera). */
function toPayload(draft: IntakeDraft): SpecIntakePayload {
  return {
    objective: draft.objective,
    client: {
      name: draft.client.name,
      industry: optionalString(draft.client.industry),
      website: optionalString(draft.client.website),
      contactName: optionalString(draft.client.contactName),
      contactEmail: optionalString(draft.client.contactEmail),
    },
    scope: { inScope: draft.scope.inScope, outOfScope: draft.scope.outOfScope },
    constraints: {
      budget: optionalString(draft.constraints.budget),
      deadline: optionalString(draft.constraints.deadline),
      technical: draft.constraints.technical,
      legal: draft.constraints.legal,
    },
    brandInputs: {
      hasLogo: draft.brandInputs.hasLogo,
      hasStyleGuide: draft.brandInputs.hasStyleGuide,
      assetsUrl: optionalString(draft.brandInputs.assetsUrl),
      notes: optionalString(draft.brandInputs.notes),
    },
    successCriteria: draft.successCriteria,
  };
}

export function createEmptyIntakePayload(): SpecIntakePayload {
  return toPayload(coerce(null));
}

/** `spec.intake` — objetivo, cliente, alcance, restricciones y brand inputs (§7.2). */
export function IntakeForm({ value, onChange, readOnly, issues }: ArtifactFormProps) {
  const draft = useMemo(() => coerce(value), [value]);
  const emit = (next: IntakeDraft) => onChange(toPayload(next));

  return (
    <div className="flex flex-col gap-4">
      <FormSection title="Objetivo" description="Objetivo de negocio del proyecto.">
        <Field label="Objetivo" htmlFor="intake-objective" required error={issueAt(issues, "objective")}>
          <Textarea
            id="intake-objective"
            value={draft.objective}
            disabled={readOnly}
            invalid={!!issueAt(issues, "objective")}
            placeholder="Qué debe lograr este proyecto, en una o pocas frases."
            onChange={(event) => emit({ ...draft, objective: event.target.value })}
          />
        </Field>
      </FormSection>

      <FormSection title="Cliente">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="intake-client-name" required error={issueAt(issues, "client", "name")}>
            <Input
              id="intake-client-name"
              value={draft.client.name}
              disabled={readOnly}
              invalid={!!issueAt(issues, "client", "name")}
              onChange={(event) =>
                emit({ ...draft, client: { ...draft.client, name: event.target.value } })
              }
            />
          </Field>
          <Field label="Industria" htmlFor="intake-client-industry" error={issueAt(issues, "client", "industry")}>
            <Input
              id="intake-client-industry"
              value={draft.client.industry}
              disabled={readOnly}
              onChange={(event) =>
                emit({ ...draft, client: { ...draft.client, industry: event.target.value } })
              }
            />
          </Field>
          <Field label="Sitio web actual" htmlFor="intake-client-website" error={issueAt(issues, "client", "website")}>
            <Input
              id="intake-client-website"
              value={draft.client.website}
              disabled={readOnly}
              placeholder="https://…"
              onChange={(event) =>
                emit({ ...draft, client: { ...draft.client, website: event.target.value } })
              }
            />
          </Field>
          <Field label="Contacto" htmlFor="intake-client-contact" error={issueAt(issues, "client", "contactName")}>
            <Input
              id="intake-client-contact"
              value={draft.client.contactName}
              disabled={readOnly}
              onChange={(event) =>
                emit({ ...draft, client: { ...draft.client, contactName: event.target.value } })
              }
            />
          </Field>
          <Field
            label="Email de contacto"
            htmlFor="intake-client-email"
            error={issueAt(issues, "client", "contactEmail")}
          >
            <Input
              id="intake-client-email"
              type="email"
              value={draft.client.contactEmail}
              disabled={readOnly}
              onChange={(event) =>
                emit({ ...draft, client: { ...draft.client, contactEmail: event.target.value } })
              }
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Alcance"
        description="Exclusiones explícitas evitan scope creep (§17-R1)."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <StringListEditor
            label="Dentro del alcance"
            values={draft.scope.inScope}
            readOnly={readOnly}
            basePath="scope.inScope"
            issues={issues}
            addLabel="Añadir entregable"
            onChange={(inScope) => emit({ ...draft, scope: { ...draft.scope, inScope } })}
          />
          <StringListEditor
            label="Fuera del alcance"
            values={draft.scope.outOfScope}
            readOnly={readOnly}
            basePath="scope.outOfScope"
            issues={issues}
            addLabel="Añadir exclusión"
            onChange={(outOfScope) => emit({ ...draft, scope: { ...draft.scope, outOfScope } })}
          />
        </div>
      </FormSection>

      <FormSection title="Restricciones">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Presupuesto" htmlFor="intake-budget" error={issueAt(issues, "constraints", "budget")}>
            <Input
              id="intake-budget"
              value={draft.constraints.budget}
              disabled={readOnly}
              onChange={(event) =>
                emit({
                  ...draft,
                  constraints: { ...draft.constraints, budget: event.target.value },
                })
              }
            />
          </Field>
          <Field
            label="Fecha objetivo"
            htmlFor="intake-deadline"
            hint="Formato AAAA-MM-DD."
            error={issueAt(issues, "constraints", "deadline")}
          >
            <Input
              id="intake-deadline"
              type="date"
              value={draft.constraints.deadline}
              disabled={readOnly}
              invalid={!!issueAt(issues, "constraints", "deadline")}
              onChange={(event) =>
                emit({
                  ...draft,
                  constraints: { ...draft.constraints, deadline: event.target.value },
                })
              }
            />
          </Field>
          <StringListEditor
            label="Restricciones técnicas"
            values={draft.constraints.technical}
            readOnly={readOnly}
            basePath="constraints.technical"
            issues={issues}
            addLabel="Añadir restricción"
            onChange={(technical) =>
              emit({ ...draft, constraints: { ...draft.constraints, technical } })
            }
          />
          <StringListEditor
            label="Restricciones legales"
            values={draft.constraints.legal}
            readOnly={readOnly}
            basePath="constraints.legal"
            issues={issues}
            addLabel="Añadir restricción"
            onChange={(legal) => emit({ ...draft, constraints: { ...draft.constraints, legal } })}
          />
        </div>
      </FormSection>

      <FormSection
        title="Brand inputs"
        description="El cliente trae su marca; la plataforma no la genera en MVP (§7.2)."
      >
        <div className="flex flex-wrap gap-4">
          <CheckboxField
            label="Tiene logo"
            checked={draft.brandInputs.hasLogo}
            disabled={readOnly}
            onChange={(hasLogo) =>
              emit({ ...draft, brandInputs: { ...draft.brandInputs, hasLogo } })
            }
          />
          <CheckboxField
            label="Tiene guía de estilo"
            checked={draft.brandInputs.hasStyleGuide}
            disabled={readOnly}
            onChange={(hasStyleGuide) =>
              emit({ ...draft, brandInputs: { ...draft.brandInputs, hasStyleGuide } })
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="URL de assets" htmlFor="intake-assets" error={issueAt(issues, "brandInputs", "assetsUrl")}>
            <Input
              id="intake-assets"
              value={draft.brandInputs.assetsUrl}
              disabled={readOnly}
              placeholder="https://…"
              onChange={(event) =>
                emit({
                  ...draft,
                  brandInputs: { ...draft.brandInputs, assetsUrl: event.target.value },
                })
              }
            />
          </Field>
          <Field label="Notas de marca" htmlFor="intake-brand-notes" error={issueAt(issues, "brandInputs", "notes")}>
            <Textarea
              id="intake-brand-notes"
              value={draft.brandInputs.notes}
              disabled={readOnly}
              className="min-h-12"
              onChange={(event) =>
                emit({
                  ...draft,
                  brandInputs: { ...draft.brandInputs, notes: event.target.value },
                })
              }
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Criterios de éxito">
        <StringListEditor
          label="Criterios de éxito"
          values={draft.successCriteria}
          readOnly={readOnly}
          basePath="successCriteria"
          issues={issues}
          addLabel="Añadir criterio"
          onChange={(successCriteria) => emit({ ...draft, successCriteria })}
        />
      </FormSection>
    </div>
  );
}
