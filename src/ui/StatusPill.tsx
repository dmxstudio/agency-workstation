import { Lock } from "lucide-react";
import { cn } from "./cn";

/** Estados del ciclo de vida de un artefacto (§8.2). */
export type ArtifactStatus =
  | "empty"
  | "draft"
  | "in_review"
  | "approved"
  | "locked";

export interface StatusPillProps {
  status: ArtifactStatus;
  /** Flag transversal: el artefacto depende de algo que cambió (§8.4). Puede coexistir con `approved`. */
  outdated?: boolean;
  /** Flag transversal: la última revisión fue rechazada. */
  rejected?: boolean;
  className?: string;
}

const statusConfig: Record<ArtifactStatus, { label: string; pill: string; dot: string }> = {
  empty: {
    label: "Vacío",
    pill: "border-border text-faint",
    dot: "bg-faint/60",
  },
  draft: {
    label: "Borrador",
    pill: "border-border text-muted",
    dot: "bg-muted",
  },
  in_review: {
    label: "En revisión",
    pill: "border-accent-action/40 text-accent-action",
    dot: "bg-accent-action",
  },
  approved: {
    label: "Aprobado",
    pill: "border-accent-success/40 text-accent-success",
    dot: "bg-accent-success",
  },
  locked: {
    label: "Bloqueado",
    pill: "border-border-strong text-foreground",
    dot: "bg-foreground",
  },
};

const pillBase =
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-[11px] font-medium leading-4 whitespace-nowrap";

/**
 * Pill de estado de artefacto. Renderiza el estado principal y, si aplica,
 * pills adicionales para los flags transversales `outdated` / `rejected`.
 */
export function StatusPill({ status, outdated, rejected, className }: StatusPillProps) {
  const config = statusConfig[status];
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className={cn(pillBase, config.pill)}>
        {status === "locked" ? (
          <Lock size={10} strokeWidth={2.25} aria-hidden />
        ) : (
          <span className={cn("size-1.5 rounded-full", config.dot)} aria-hidden />
        )}
        {config.label}
      </span>
      {outdated ? (
        <span className={cn(pillBase, "border-accent-warning/40 text-accent-warning")}>
          <span className="size-1.5 rounded-full bg-accent-warning" aria-hidden />
          Desactualizado
        </span>
      ) : null}
      {rejected ? (
        <span className={cn(pillBase, "border-accent-danger/40 text-accent-danger")}>
          <span className="size-1.5 rounded-full bg-accent-danger" aria-hidden />
          Rechazado
        </span>
      ) : null}
    </span>
  );
}
