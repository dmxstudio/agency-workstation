"use client";

import { useMemo } from "react";

import type { CmsCollectionsPayload, CmsFieldType } from "@/modules/artifacts/types";
import { Field, Input, Select } from "@/ui";

import { asArray, asBoolean, asObject, asString, asStringArray, optionalString } from "./coerce";
import {
  AddButton,
  CheckboxField,
  FormSection,
  RowControls,
  StringListEditor,
} from "./controls";
import { moveItem, removeAt, replaceAt } from "./list-utils";
import { issueAt, pathKey, type ArtifactFormProps, type IssueMap } from "./types";

const FIELD_TYPES: { value: CmsFieldType; label: string }[] = [
  { value: "text", label: "Texto" },
  { value: "richText", label: "Texto enriquecido" },
  { value: "number", label: "Número" },
  { value: "boolean", label: "Booleano" },
  { value: "date", label: "Fecha" },
  { value: "image", label: "Imagen" },
  { value: "select", label: "Select" },
  { value: "relation", label: "Relación" },
];

const FIELD_TYPE_VALUES = FIELD_TYPES.map((t) => t.value);

interface FieldDraft {
  name: string;
  label: string;
  type: CmsFieldType;
  required: boolean;
  options: string[];
  relationTo: string;
  hasMany: boolean;
}

interface CollectionDraft {
  slug: string;
  label: string;
  description: string;
  fields: FieldDraft[];
  timestamps: boolean;
}

interface CmsDraft {
  collections: CollectionDraft[];
}

function coerceField(value: unknown): FieldDraft {
  const v = asObject(value);
  const rawType = asString(v.type);
  return {
    name: asString(v.name),
    label: asString(v.label),
    type: (FIELD_TYPE_VALUES as string[]).includes(rawType)
      ? (rawType as CmsFieldType)
      : "text",
    required: asBoolean(v.required),
    options: asStringArray(v.options),
    relationTo: asString(v.relationTo),
    hasMany: asBoolean(v.hasMany),
  };
}

function coerceCollection(value: unknown): CollectionDraft {
  const v = asObject(value);
  const fields = asArray(v.fields).map(coerceField);
  return {
    slug: asString(v.slug),
    label: asString(v.label),
    description: asString(v.description),
    fields: fields.length > 0 ? fields : [coerceField(null)],
    timestamps: asBoolean(v.timestamps, true),
  };
}

function coerce(value: unknown): CmsDraft {
  const v = asObject(value);
  return { collections: asArray(v.collections).map(coerceCollection) };
}

function toPayload(draft: CmsDraft): CmsCollectionsPayload {
  return {
    collections: draft.collections.map((collection) => ({
      slug: collection.slug,
      label: collection.label,
      description: optionalString(collection.description),
      fields: collection.fields.map((field) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        required: field.required,
        // `options`/`relationTo` solo aplican a su tipo (validación cruzada Zod).
        options: field.type === "select" ? field.options : undefined,
        relationTo:
          field.type === "relation" ? optionalString(field.relationTo) : undefined,
        hasMany: field.type === "relation" ? field.hasMany : false,
      })),
      timestamps: collection.timestamps,
    })),
  };
}

export function createEmptyCmsCollectionsPayload(): CmsCollectionsPayload {
  return toPayload(coerce(null));
}

function FieldEditor({
  field,
  index,
  count,
  basePath,
  collectionSlugs,
  readOnly,
  issues,
  onChange,
  onMove,
  onRemove,
}: {
  field: FieldDraft;
  index: number;
  count: number;
  basePath: string;
  collectionSlugs: string[];
  readOnly: boolean;
  issues: IssueMap;
  onChange: (field: FieldDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const nameError = issues[pathKey(basePath, "name")];
  const labelError = issues[pathKey(basePath, "label")];
  const relationError = issues[pathKey(basePath, "relationTo")];

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-start gap-1.5">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <Field label="Nombre (machine)" required error={nameError}>
            <Input
              value={field.name}
              disabled={readOnly}
              invalid={!!nameError}
              className="font-mono"
              placeholder="heroTitle"
              onChange={(event) => onChange({ ...field, name: event.target.value })}
            />
          </Field>
          <Field label="Label" required error={labelError}>
            <Input
              value={field.label}
              disabled={readOnly}
              invalid={!!labelError}
              onChange={(event) => onChange({ ...field, label: event.target.value })}
            />
          </Field>
          <Field label="Tipo" error={issues[pathKey(basePath, "type")]}>
            <Select
              value={field.type}
              disabled={readOnly}
              onChange={(event) =>
                onChange({ ...field, type: event.target.value as CmsFieldType })
              }
            >
              {FIELD_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <RowControls
          index={index}
          count={count}
          disabled={readOnly}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <CheckboxField
          label="Obligatorio"
          checked={field.required}
          disabled={readOnly}
          onChange={(required) => onChange({ ...field, required })}
        />
        {field.type === "relation" ? (
          <CheckboxField
            label="A muchos (hasMany)"
            checked={field.hasMany}
            disabled={readOnly}
            onChange={(hasMany) => onChange({ ...field, hasMany })}
          />
        ) : null}
      </div>

      {field.type === "select" ? (
        <div className="mt-3">
          <StringListEditor
            label="Opciones"
            values={field.options}
            readOnly={readOnly}
            basePath={pathKey(basePath, "options")}
            issues={issues}
            addLabel="Añadir opción"
            onChange={(options) => onChange({ ...field, options })}
          />
        </div>
      ) : null}

      {field.type === "relation" ? (
        <div className="mt-3">
          <Field
            label="Colección destino"
            required
            error={relationError}
            hint="Slug de otra colección de este modelo."
          >
            <Select
              value={field.relationTo}
              disabled={readOnly}
              invalid={!!relationError}
              className="font-mono"
              onChange={(event) => onChange({ ...field, relationTo: event.target.value })}
            >
              <option value="" disabled>
                Selecciona una colección…
              </option>
              {collectionSlugs.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/** `cms.collections` — colecciones con campos tipados y relaciones (§7.2). */
export function CmsCollectionsForm({ value, onChange, readOnly, issues }: ArtifactFormProps) {
  const draft = useMemo(() => coerce(value), [value]);
  const emit = (next: CmsDraft) => onChange(toPayload(next));
  const collectionSlugs = useMemo(
    () => draft.collections.map((c) => c.slug).filter((slug) => slug !== ""),
    [draft.collections],
  );

  return (
    <div className="flex flex-col gap-4">
      {issueAt(issues, "collections") ? (
        <p role="alert" className="text-xs text-accent-danger">
          {issueAt(issues, "collections")}
        </p>
      ) : null}

      {draft.collections.length === 0 ? (
        <p className="text-sm text-muted">
          Aún no hay colecciones. El generador (§7.3) derivará de aquí las colecciones del CMS.
        </p>
      ) : null}

      {draft.collections.map((collection, cIndex) => {
        const colPath = pathKey("collections", cIndex);
        const updateCollection = (next: CollectionDraft) =>
          emit({ ...draft, collections: replaceAt(draft.collections, cIndex, next) });
        return (
          <FormSection
            key={cIndex}
            title={`Colección ${cIndex + 1}${collection.slug ? ` · ${collection.slug}` : ""}`}
          >
            <div className="flex items-start gap-1.5">
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <Field label="Slug" required error={issues[pathKey(colPath, "slug")]}>
                  <Input
                    value={collection.slug}
                    disabled={readOnly}
                    invalid={!!issues[pathKey(colPath, "slug")]}
                    className="font-mono"
                    placeholder="posts"
                    onChange={(event) =>
                      updateCollection({ ...collection, slug: event.target.value })
                    }
                  />
                </Field>
                <Field label="Label" required error={issues[pathKey(colPath, "label")]}>
                  <Input
                    value={collection.label}
                    disabled={readOnly}
                    invalid={!!issues[pathKey(colPath, "label")]}
                    placeholder="Entradas del blog"
                    onChange={(event) =>
                      updateCollection({ ...collection, label: event.target.value })
                    }
                  />
                </Field>
              </div>
              <RowControls
                index={cIndex}
                count={draft.collections.length}
                disabled={readOnly}
                onMove={(delta) =>
                  emit({ ...draft, collections: moveItem(draft.collections, cIndex, delta) })
                }
                onRemove={() =>
                  emit({ ...draft, collections: removeAt(draft.collections, cIndex) })
                }
              />
            </div>
            <Field label="Descripción" error={issues[pathKey(colPath, "description")]}>
              <Input
                value={collection.description}
                disabled={readOnly}
                onChange={(event) =>
                  updateCollection({ ...collection, description: event.target.value })
                }
              />
            </Field>
            <CheckboxField
              label="Timestamps automáticos (createdAt/updatedAt)"
              checked={collection.timestamps}
              disabled={readOnly}
              onChange={(timestamps) => updateCollection({ ...collection, timestamps })}
            />

            <p className="font-mono text-[11px] tracking-widest text-faint uppercase">
              Campos
            </p>
            {issues[pathKey(colPath, "fields")] ? (
              <p role="alert" className="text-xs text-accent-danger">
                {issues[pathKey(colPath, "fields")]}
              </p>
            ) : null}
            {collection.fields.map((field, fIndex) => (
              <FieldEditor
                key={fIndex}
                field={field}
                index={fIndex}
                count={collection.fields.length}
                basePath={pathKey(colPath, "fields", fIndex)}
                collectionSlugs={collectionSlugs}
                readOnly={readOnly}
                issues={issues}
                onChange={(next) =>
                  updateCollection({
                    ...collection,
                    fields: replaceAt(collection.fields, fIndex, next),
                  })
                }
                onMove={(delta) =>
                  updateCollection({
                    ...collection,
                    fields: moveItem(collection.fields, fIndex, delta),
                  })
                }
                onRemove={() =>
                  updateCollection({
                    ...collection,
                    fields: removeAt(collection.fields, fIndex),
                  })
                }
              />
            ))}
            <AddButton
              label="Añadir campo"
              disabled={readOnly}
              onClick={() =>
                updateCollection({
                  ...collection,
                  fields: [...collection.fields, coerceField(null)],
                })
              }
            />
          </FormSection>
        );
      })}

      <AddButton
        label="Añadir colección"
        disabled={readOnly}
        onClick={() =>
          emit({ ...draft, collections: [...draft.collections, coerceCollection(null)] })
        }
      />
    </div>
  );
}
