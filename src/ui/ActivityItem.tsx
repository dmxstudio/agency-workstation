import type { ReactNode } from "react";
import { Bot, Circle } from "lucide-react";
import { cn } from "./cn";

export interface ActivityItemProps {
  /** Icono (lucide u otro). Por defecto: punto neutro; en variante `agent`, icono Bot. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Timestamp ya formateado (el caller decide el formato). Se renderiza en mono. */
  timestamp?: string;
  /**
   * `agent`: actividad ejecutada por un agente IA. Usa el acento violeta,
   * reservado EXCLUSIVAMENTE para esto (§11.4).
   */
  variant?: "default" | "agent";
  className?: string;
}

export function ActivityItem({
  icon,
  title,
  description,
  timestamp,
  variant = "default",
  className,
}: ActivityItemProps) {
  const isAgent = variant === "agent";
  const defaultIcon = isAgent ? (
    <Bot size={14} strokeWidth={2} aria-hidden />
  ) : (
    <Circle size={6} strokeWidth={0} fill="currentColor" aria-hidden />
  );

  return (
    <div className={cn("flex items-start gap-3 py-2.5", className)}>
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded border",
          isAgent
            ? "border-accent-agent/40 bg-accent-agent/10 text-accent-agent"
            : "border-border bg-surface text-muted",
        )}
      >
        {icon ?? defaultIcon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-[13px] leading-5 text-foreground">
            {isAgent ? (
              <span className="mr-1.5 font-mono text-[10px] font-medium tracking-wider text-accent-agent uppercase">
                Agente
              </span>
            ) : null}
            {title}
          </p>
          {timestamp ? (
            <time className="shrink-0 font-mono text-[11px] text-faint tabular-nums whitespace-nowrap">
              {timestamp}
            </time>
          ) : null}
        </div>
        {description ? (
          <p className="mt-0.5 text-xs leading-4 text-muted">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
