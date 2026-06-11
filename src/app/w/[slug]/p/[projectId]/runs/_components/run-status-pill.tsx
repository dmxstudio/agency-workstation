import type { AgentRunStatus } from "@/db/schema";
import { cn } from "@/ui";

import { RUN_STATUS_LABELS } from "../_lib/run-format";

/**
 * Pill de estado de un agent run (§7.9). El violeta (`accent-agent`) está
 * reservado EXCLUSIVAMENTE a actividad de agentes (§11.4): aquí marca lo que
 * el agente hace (cola/ejecución, con pulso) o dejó pendiente de decisión
 * humana (`proposed`). Los estados decididos usan los acentos semánticos:
 * la decisión es humana, no del agente.
 */

interface RunStatusVisual {
  pill: string;
  dot: string;
  pulse?: boolean;
  title: string;
}

const statusConfig: Record<AgentRunStatus, RunStatusVisual> = {
  queued: {
    pill: "border-accent-agent/40 text-accent-agent",
    dot: "bg-accent-agent",
    pulse: true,
    title: "El run espera su turno de ejecución.",
  },
  running: {
    pill: "border-accent-agent/40 text-accent-agent",
    dot: "bg-accent-agent",
    pulse: true,
    title: "El agente está generando la propuesta.",
  },
  proposed: {
    pill: "border-accent-agent/40 bg-accent-agent/10 text-accent-agent",
    dot: "bg-accent-agent",
    title: "Propuesta generada — requiere decisión humana.",
  },
  approved: {
    pill: "border-accent-success/40 text-accent-success",
    dot: "bg-accent-success",
    title: "Propuesta aprobada por un humano con rol.",
  },
  rejected: {
    pill: "border-accent-danger/40 text-accent-danger",
    dot: "bg-accent-danger",
    title: "Propuesta rechazada por un humano con rol (con feedback).",
  },
  failed: {
    pill: "border-accent-danger/40 text-accent-danger",
    dot: "bg-accent-danger",
    title: "El run falló antes de producir una propuesta.",
  },
};

export interface RunStatusPillProps {
  status: AgentRunStatus;
  className?: string;
}

export function RunStatusPill({ status, className }: RunStatusPillProps) {
  const config = statusConfig[status];
  return (
    <span
      title={config.title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-[11px] font-medium leading-4 whitespace-nowrap",
        config.pill,
        className,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", config.dot, config.pulse && "animate-pulse")}
        aria-hidden
      />
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}
