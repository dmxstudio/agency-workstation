import type { ReactNode } from "react";
import { cn } from "./cn";

export interface PageHeaderProps {
  title: string;
  /** Etiqueta pequeña con tracking sobre el título (metadato editorial, §11.4). */
  eyebrow?: string;
  description?: string;
  /** Acciones a la derecha (botones, menús). */
  actions?: ReactNode;
  /** Fila de metadatos bajo el título (pills, MonoId, etc.). */
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("border-b border-border pb-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1 font-mono text-[11px] tracking-widest text-faint uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
    </header>
  );
}
