"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { Button, Field, Input, Select, cn } from "@/ui";

import { moveItem, removeAt, replaceAt } from "./list-utils";
import { pathKey, type IssueMap } from "./types";

/** Primitivas compartidas por los formularios de Spec OS (densas, §11.4). */

// ---------------------------------------------------------------------------
// Section: agrupador visual con heading mono
// ---------------------------------------------------------------------------

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-md border border-border bg-surface p-4", className)}>
      <h3 className="font-mono text-[11px] tracking-widest text-faint uppercase">{title}</h3>
      {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Botones de fila (reordenar / eliminar)
// ---------------------------------------------------------------------------

export function RowControls({
  index,
  count,
  onMove,
  onRemove,
  disabled,
}: {
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="size-7 px-0"
        aria-label="Subir"
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ChevronUp size={13} aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="size-7 px-0"
        aria-label="Bajar"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ChevronDown size={13} aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="size-7 px-0 text-accent-danger hover:bg-accent-danger/10 hover:text-accent-danger"
        aria-label="Eliminar"
        onClick={onRemove}
      >
        <Trash2 size={13} aria-hidden />
      </Button>
    </div>
  );
}

export function AddButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <Button variant="ghost" size="sm" className="self-start" onClick={onClick}>
      <Plus size={13} aria-hidden />
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-sm text-foreground select-none",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-accent-action"
      />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// StringListEditor: lista dinámica de strings (añadir/quitar/reordenar)
// ---------------------------------------------------------------------------

export interface StringListEditorProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  readOnly: boolean;
  /** Path base dentro del payload para mapear errores, p.ej. `scope.inScope`. */
  basePath: string;
  issues: IssueMap;
  placeholder?: string;
  addLabel?: string;
  hint?: string;
  required?: boolean;
}

export function StringListEditor({
  label,
  values,
  onChange,
  readOnly,
  basePath,
  issues,
  placeholder,
  addLabel = "Añadir",
  hint,
  required,
}: StringListEditorProps) {
  return (
    <Field label={label} error={issues[basePath]} hint={hint} required={required}>
      <div className="flex flex-col gap-1.5">
        {values.length === 0 && readOnly ? (
          <p className="text-xs text-faint">—</p>
        ) : null}
        {values.map((value, index) => {
          const rowError = issues[pathKey(basePath, index)];
          return (
            <div key={index} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <Input
                  value={value}
                  placeholder={placeholder}
                  disabled={readOnly}
                  invalid={!!rowError}
                  onChange={(event) =>
                    onChange(replaceAt(values, index, event.target.value))
                  }
                />
                <RowControls
                  index={index}
                  count={values.length}
                  disabled={readOnly}
                  onMove={(delta) => onChange(moveItem(values, index, delta))}
                  onRemove={() => onChange(removeAt(values, index))}
                />
              </div>
              {rowError ? (
                <p role="alert" className="text-xs text-accent-danger">
                  {rowError}
                </p>
              ) : null}
            </div>
          );
        })}
        <AddButton label={addLabel} disabled={readOnly} onClick={() => onChange([...values, ""])} />
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// SlugListEditor: lista de slugs elegidos de un conjunto disponible (navegación)
// ---------------------------------------------------------------------------

export interface SlugListEditorProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** Slugs disponibles (del árbol del sitemap). */
  options: string[];
  readOnly: boolean;
  basePath: string;
  issues: IssueMap;
  addLabel?: string;
  hint?: string;
}

export function SlugListEditor({
  label,
  values,
  onChange,
  options,
  readOnly,
  basePath,
  issues,
  addLabel = "Añadir página",
  hint,
}: SlugListEditorProps) {
  return (
    <Field label={label} error={issues[basePath]} hint={hint}>
      <div className="flex flex-col gap-1.5">
        {values.length === 0 && readOnly ? <p className="text-xs text-faint">—</p> : null}
        {values.map((value, index) => {
          const rowError = issues[pathKey(basePath, index)];
          // Un slug que ya no existe en el árbol sigue visible para poder corregirlo.
          const choices = options.includes(value) || value === "" ? options : [value, ...options];
          return (
            <div key={index} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <Select
                  value={value}
                  disabled={readOnly}
                  invalid={!!rowError}
                  className="font-mono"
                  onChange={(event) => onChange(replaceAt(values, index, event.target.value))}
                >
                  <option value="" disabled>
                    Selecciona un slug…
                  </option>
                  {choices.map((slug) => (
                    <option key={slug} value={slug}>
                      {slug}
                    </option>
                  ))}
                </Select>
                <RowControls
                  index={index}
                  count={values.length}
                  disabled={readOnly}
                  onMove={(delta) => onChange(moveItem(values, index, delta))}
                  onRemove={() => onChange(removeAt(values, index))}
                />
              </div>
              {rowError ? (
                <p role="alert" className="text-xs text-accent-danger">
                  {rowError}
                </p>
              ) : null}
            </div>
          );
        })}
        <AddButton
          label={addLabel}
          disabled={readOnly || options.length === 0}
          onClick={() => onChange([...values, options[0] ?? ""])}
        />
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// TokenMapEditor: pares clave→valor (design tokens)
// ---------------------------------------------------------------------------

export interface TokenMapEditorProps {
  label: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  readOnly: boolean;
  basePath: string;
  issues: IssueMap;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  hint?: string;
}

export function TokenMapEditor({
  label,
  value,
  onChange,
  readOnly,
  basePath,
  issues,
  keyPlaceholder = "nombre",
  valuePlaceholder = "valor",
  hint,
}: TokenMapEditorProps) {
  const entries = Object.entries(value);
  const emit = (next: [string, string][]) => onChange(Object.fromEntries(next));

  return (
    <Field label={label} error={issues[basePath]} hint={hint}>
      <div className="flex flex-col gap-1.5">
        {entries.length === 0 && readOnly ? <p className="text-xs text-faint">—</p> : null}
        {entries.map(([key, val], index) => {
          const rowError = issues[pathKey(basePath, key)];
          return (
            <div key={index} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <Input
                  value={key}
                  placeholder={keyPlaceholder}
                  disabled={readOnly}
                  invalid={!!rowError}
                  className="basis-2/5 font-mono"
                  onChange={(event) =>
                    emit(replaceAt(entries, index, [event.target.value, val]))
                  }
                />
                <Input
                  value={val}
                  placeholder={valuePlaceholder}
                  disabled={readOnly}
                  invalid={!!rowError}
                  className="flex-1 font-mono"
                  onChange={(event) =>
                    emit(replaceAt(entries, index, [key, event.target.value]))
                  }
                />
                <RowControls
                  index={index}
                  count={entries.length}
                  disabled={readOnly}
                  onMove={(delta) => emit(moveItem(entries, index, delta))}
                  onRemove={() => emit(removeAt(entries, index))}
                />
              </div>
              {rowError ? (
                <p role="alert" className="text-xs text-accent-danger">
                  {rowError}
                </p>
              ) : null}
            </div>
          );
        })}
        <AddButton
          label="Añadir token"
          disabled={readOnly || entries.some(([key]) => key === "")}
          onClick={() => emit([...entries, ["", ""]])}
        />
      </div>
    </Field>
  );
}
