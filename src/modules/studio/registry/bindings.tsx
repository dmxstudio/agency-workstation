import type { CustomField } from "@puckeditor/core";
import type { CmsCollection, CmsFieldType } from "@/modules/artifacts";

/**
 * Campo de binding CMS schema-driven para el Studio.
 *
 * El template usa campos `external` de Puck que listan documentos reales del
 * Payload del proyecto (`/api/external/*`). La plataforma NO corre ese
 * Payload, así que el Studio sustituye el campo external por este custom
 * field: selector de colección + asignación de campos validada contra el
 * artefacto `cms.collections` aprobado.
 *
 * CONTRATO DE FORMATO (sagrado): el valor guardado tiene EXACTAMENTE el shape
 * que el runtime del template re-resuelve por request en
 * `templates/project-base/src/lib/bindings.ts`:
 *
 *   { collection: string, docId: string | number, ...snapshot }
 *
 * - `collection` debe ser un slug presente en el Payload del proyecto.
 * - `docId` apunta a un documento; si no resuelve, el template conserva el
 *   snapshot y lo marca `_broken: true` (sigue renderizando el snapshot).
 * - El resto de claves son el snapshot que el componente lee; al resolver, el
 *   template hace `{ ...snapshot, ...docFresco }` SIN remapear nombres: solo
 *   las claves cuyo nombre coincide con un campo del documento se refrescan.
 *
 * En el Studio el snapshot se rellena con placeholders representativos
 * (`[contenido de case-studies.summary]`) que el canvas renderiza tal cual.
 * En el sitio publicado, esas claves se sobreescriben con el contenido real
 * del documento — siempre que el nombre del campo coincida con la clave que
 * el componente lee (de ahí la advertencia de la UI cuando difieren).
 */

/** Shape exacto que resuelve el template (más `null` = sin binding). */
export type CmsBindingValue = {
  docId: string | number;
  collection: string;
  [snapshotKey: string]: unknown;
} | null;

/** Clave de snapshot que un componente CMS-bound lee. */
export interface BindingExpect {
  /** Nombre de la clave en el snapshot (la que lee el render del componente). */
  key: string;
  label: string;
  /** Tipos de campo CMS compatibles (validación schema-driven). */
  types: CmsFieldType[];
  /** Sin esta clave el componente no muestra nada útil. */
  required?: boolean;
  /**
   * Si es `true`, la clave se asigna pero NO entra al snapshot como
   * placeholder: un string `[contenido de …]` rompería renders no textuales
   * (`typeof rating === "number"`, fechas). El valor real llega en el sitio
   * publicado vía la re-resolución del template.
   */
  omitPlaceholder?: boolean;
}

export interface BindingFieldSpec {
  label: string;
  /** Colecciones del `cms.collections` aprobado del proyecto. */
  collections: CmsCollection[];
  expects: BindingExpect[];
}

export function bindingPlaceholder(collection: string, field: string): string {
  return `[contenido de ${collection}.${field}]`;
}

const PLACEHOLDER_RE = /^\[contenido de ([a-z0-9][a-z0-9-]*)\.([A-Za-z0-9_]+)\]$/;

/**
 * Documentos de ejemplo seleccionables. El seed del template
 * (`scripts/seed.mts` + `src/seed/content.json` del generator) crea 3
 * documentos por colección en una DB recién sembrada (ids autoincrementales
 * 1..3). Si los ids reales divergen, el runtime degrada a snapshot+`_broken`,
 * y re-vincular el documento real es tarea del editor del proyecto (/edit).
 */
const SAMPLE_DOC_COUNT = 3;

function fieldOptionsFor(collection: CmsCollection, expect: BindingExpect) {
  return collection.fields.filter((field) => expect.types.includes(field.type));
}

function defaultMapping(
  collection: CmsCollection,
  expects: BindingExpect[],
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const expect of expects) {
    const sameName = collection.fields.find(
      (field) => field.name === expect.key && expect.types.includes(field.type),
    );
    if (sameName) mapping[expect.key] = sameName.name;
  }
  return mapping;
}

/** Una colección es elegible si puede alimentar todas las claves requeridas. */
function isCompatible(collection: CmsCollection, expects: BindingExpect[]): boolean {
  return expects
    .filter((expect) => expect.required)
    .every((expect) => fieldOptionsFor(collection, expect).length > 0);
}

function buildValue(
  collection: CmsCollection,
  docIndex: number,
  mapping: Record<string, string>,
  expects: BindingExpect[],
): NonNullable<CmsBindingValue> {
  const next: Record<string, unknown> = {
    docId: docIndex,
    collection: collection.slug,
  };
  for (const expect of expects) {
    const fieldName = mapping[expect.key];
    if (!fieldName) continue;
    if (expect.omitPlaceholder) continue;
    next[expect.key] = bindingPlaceholder(collection.slug, fieldName);
  }
  return next as NonNullable<CmsBindingValue>;
}

/** Recupera el mapeo clave→campo desde los placeholders guardados. */
function mappingFromValue(
  value: NonNullable<CmsBindingValue>,
  expects: BindingExpect[],
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const expect of expects) {
    const stored = value[expect.key];
    if (typeof stored !== "string") continue;
    const match = PLACEHOLDER_RE.exec(stored);
    if (match && match[1] === value.collection) mapping[expect.key] = match[2];
  }
  return mapping;
}

const selectClass =
  "w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground disabled:opacity-50";
const labelClass = "block text-[11px] font-medium text-muted";

/**
 * Crea el custom field de Puck. El render solo se ejecuta en el rail derecho
 * del editor (client); en `<Render>` RSC los renders de fields no se invocan.
 * UI con tokens de la plataforma (§11.4) — esto es chrome del editor, no canvas.
 */
export function createBindingField<T extends CmsBindingValue>(
  spec: BindingFieldSpec,
): CustomField<T> {
  const { label, collections, expects } = spec;

  return {
    type: "custom",
    label,
    render: ({ value, onChange, readOnly }) => {
      const current = (value ?? null) as NonNullable<CmsBindingValue> | null;
      const selectedCollection = current
        ? collections.find((collection) => collection.slug === current.collection)
        : undefined;
      const docIndex = current ? Math.max(1, Number(current.docId) || 1) : 1;
      const mapping = current ? mappingFromValue(current, expects) : {};

      const emit = (next: CmsBindingValue) => onChange(next as T);

      if (collections.length === 0) {
        return (
          <div className="rounded border border-border bg-surface px-2 py-2 text-[11px] text-muted">
            No hay colecciones en el artefacto <span className="font-mono">cms.collections</span>{" "}
            aprobado. Aprueba el modelo de datos para poder vincular contenido.
          </div>
        );
      }

      const issues: { kind: "error" | "warning"; text: string }[] = [];
      if (current && selectedCollection) {
        for (const expect of expects) {
          const mapped = mapping[expect.key];
          if (!mapped) {
            if (expect.required && !expect.omitPlaceholder) {
              issues.push({
                kind: "error",
                text: `Falta asignar un campo para «${expect.label}».`,
              });
            }
            continue;
          }
          if (mapped !== expect.key) {
            issues.push({
              kind: "warning",
              text: `El sitio publicado no refresca «${expect.key}» desde «${mapped}»: el runtime solo refresca claves con el mismo nombre de campo. Renombra el campo en cms.collections o trata este valor como estático.`,
            });
          }
        }
      }
      if (current && !selectedCollection) {
        issues.push({
          kind: "error",
          text: `La colección «${current.collection}» ya no existe en cms.collections. Reasigna el binding.`,
        });
      }

      return (
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Colección</label>
            <select
              className={selectClass}
              disabled={readOnly}
              value={selectedCollection?.slug ?? ""}
              onChange={(event) => {
                const slug = event.target.value;
                if (!slug) {
                  emit(null);
                  return;
                }
                const collection = collections.find((c) => c.slug === slug);
                if (!collection) return;
                emit(buildValue(collection, 1, defaultMapping(collection, expects), expects));
              }}
            >
              <option value="">— sin binding —</option>
              {collections.map((collection) => {
                const compatible = isCompatible(collection, expects);
                return (
                  <option key={collection.slug} value={collection.slug} disabled={!compatible}>
                    {collection.label} ({collection.slug})
                    {compatible ? "" : " — incompatible"}
                  </option>
                );
              })}
            </select>
          </div>

          {current && selectedCollection ? (
            <>
              <div>
                <label className={labelClass}>Documento de ejemplo (seed)</label>
                <select
                  className={selectClass}
                  disabled={readOnly}
                  value={String(docIndex)}
                  onChange={(event) =>
                    emit(
                      buildValue(
                        selectedCollection,
                        Number(event.target.value) || 1,
                        mapping,
                        expects,
                      ),
                    )
                  }
                >
                  {Array.from({ length: SAMPLE_DOC_COUNT }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={String(n)}>
                      Documento {n}
                    </option>
                  ))}
                </select>
              </div>

              {expects
                .filter((expect) => !expect.omitPlaceholder)
                .map((expect) => {
                  const options = fieldOptionsFor(selectedCollection, expect);
                  return (
                    <div key={expect.key}>
                      <label className={labelClass}>
                        Campo para <span className="font-mono">{expect.key}</span>
                        {expect.required ? " *" : ""}
                      </label>
                      <select
                        className={selectClass}
                        disabled={readOnly}
                        value={mapping[expect.key] ?? ""}
                        onChange={(event) =>
                          emit(
                            buildValue(
                              selectedCollection,
                              docIndex,
                              { ...mapping, [expect.key]: event.target.value },
                              expects,
                            ),
                          )
                        }
                      >
                        <option value="">— sin asignar —</option>
                        {options.map((field) => (
                          <option key={field.name} value={field.name}>
                            {field.label} ({field.name})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}

              {!readOnly ? (
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
                  onClick={() => emit(null)}
                >
                  Quitar binding
                </button>
              ) : null}
            </>
          ) : null}

          {issues.map((issue, i) => (
            <p
              key={i}
              className={`text-[11px] leading-4 ${
                issue.kind === "error" ? "text-accent-danger" : "text-accent-warning"
              }`}
            >
              {issue.text}
            </p>
          ))}
        </div>
      );
    },
  };
}
