import { cn } from "./cn";

export type DiffChangeType = "added" | "removed" | "changed";

/** Un cambio estructural entre dos versiones de un artefacto. */
export interface DiffChange {
  /** Ruta del campo dentro del payload, p.ej. `hero.title` o `sections[2].cta.label`. */
  path: string;
  type: DiffChangeType;
  before?: unknown;
  after?: unknown;
}

export interface DiffViewProps {
  changes: DiffChange[];
  /** Texto cuando no hay cambios. */
  emptyLabel?: string;
  className?: string;
}

const MAX_VALUE_LENGTH = 160;

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

const markerByType: Record<DiffChangeType, { glyph: string; className: string }> = {
  added: { glyph: "+", className: "text-accent-success" },
  removed: { glyph: "−", className: "text-accent-danger" },
  changed: { glyph: "~", className: "text-accent-warning" },
};

const rowBorderByType: Record<DiffChangeType, string> = {
  added: "border-l-accent-success",
  removed: "border-l-accent-danger",
  changed: "border-l-accent-warning",
};

function ValueChip({ tone, children }: { tone: "before" | "after"; children: string }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1 py-px break-words",
        tone === "before"
          ? "bg-accent-danger/10 text-accent-danger"
          : "bg-accent-success/10 text-accent-success",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Diff estructural de artefacto — componente firma del producto (§11.4):
 * mono obligatoria, colores semánticos por tipo de cambio, densidad alta.
 */
export function DiffView({ changes, emptyLabel = "Sin cambios", className }: DiffViewProps) {
  const added = changes.filter((c) => c.type === "added").length;
  const removed = changes.filter((c) => c.type === "removed").length;
  const changed = changes.filter((c) => c.type === "changed").length;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-background font-mono text-xs",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-border bg-surface px-3 py-2">
        <span className="text-[11px] tracking-wider text-muted uppercase">
          {changes.length === 1 ? "1 cambio" : `${changes.length} cambios`}
        </span>
        <span className="ml-auto flex items-center gap-2 tabular-nums">
          <span className="text-accent-success">+{added}</span>
          <span className="text-accent-danger">−{removed}</span>
          <span className="text-accent-warning">~{changed}</span>
        </span>
      </div>

      {changes.length === 0 ? (
        <p className="px-3 py-6 text-center text-faint">{emptyLabel}</p>
      ) : (
        <ul>
          {changes.map((change, index) => {
            const marker = markerByType[change.type];
            return (
              <li
                key={`${change.path}-${index}`}
                className={cn(
                  "flex items-baseline gap-2 border-b border-l-2 border-border/60 px-3 py-1.5 last:border-b-0",
                  rowBorderByType[change.type],
                )}
              >
                <span
                  className={cn("w-3 shrink-0 text-center font-semibold select-none", marker.className)}
                  aria-hidden
                >
                  {marker.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{change.path}</span>
                  <span className="ml-2 inline-flex max-w-full flex-wrap items-baseline gap-1.5">
                    {change.type === "added" ? (
                      <ValueChip tone="after">{formatValue(change.after)}</ValueChip>
                    ) : change.type === "removed" ? (
                      <ValueChip tone="before">{formatValue(change.before)}</ValueChip>
                    ) : (
                      <>
                        <ValueChip tone="before">{formatValue(change.before)}</ValueChip>
                        <span className="text-faint select-none" aria-hidden>
                          →
                        </span>
                        <ValueChip tone="after">{formatValue(change.after)}</ValueChip>
                      </>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
