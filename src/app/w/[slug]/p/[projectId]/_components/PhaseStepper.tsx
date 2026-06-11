import type { ReactNode } from "react";
import { Check, Lock, TriangleAlert } from "lucide-react";

import type { PhaseGate } from "@/modules/artifacts";
import { cn } from "@/ui";

interface PhaseStepperProps {
  gates: PhaseGate[];
  /** Phase key to highlight as the working phase (validated by the caller). */
  activePhase: string | null;
}

type GateVisualState = "empty" | "in_progress" | "closable" | "closed";

function gateState(gate: PhaseGate): GateVisualState {
  const required = gate.artifacts.filter(
    (item) => item.definition?.requiredForGate ?? false,
  );
  if (required.length > 0 && required.every((item) => item.artifact.status === "locked")) {
    return "closed";
  }
  if (gate.closable) return "closable";
  const touched = gate.artifacts.some((item) => item.artifact.status !== "empty");
  return touched ? "in_progress" : "empty";
}

function countOutdated(gate: PhaseGate): number {
  return gate.artifacts.filter((item) => item.artifact.outdated).length;
}

const stateIcon: Record<GateVisualState, ReactNode> = {
  closed: <Lock size={11} strokeWidth={2.25} aria-hidden />,
  closable: <Check size={12} strokeWidth={2.5} aria-hidden />,
  in_progress: <span className="size-1.5 rounded-full bg-accent-action" aria-hidden />,
  empty: <span className="size-1.5 rounded-full bg-faint/50" aria-hidden />,
};

const stateIconClasses: Record<GateVisualState, string> = {
  closed: "border-border-strong text-foreground",
  closable: "border-accent-success/50 text-accent-success",
  in_progress: "border-accent-action/40 text-accent-action",
  empty: "border-border text-faint",
};

const stateLabel: Record<GateVisualState, string> = {
  closed: "Cerrada",
  closable: "Cerrable",
  in_progress: "En curso",
  empty: "Sin empezar",
};

/**
 * Fila de fases con gates (§8.5): estado agregado por fase — artefactos
 * obligatorios aprobados/total, cerrable o no, desactualizados pendientes.
 */
export function PhaseStepper({ gates, activePhase }: PhaseStepperProps) {
  return (
    <ol
      aria-label="Fases del proyecto"
      className="flex w-full divide-x divide-border overflow-x-auto rounded-md border border-border bg-surface"
    >
      {gates.map((gate, index) => {
        const state = gateState(gate);
        const outdated = countOutdated(gate);
        const isActive = gate.phase === activePhase;
        return (
          <li
            key={gate.phase}
            aria-current={isActive ? "step" : undefined}
            title={`${gate.label}: ${stateLabel[state]}${outdated > 0 ? ` · ${outdated} desactualizado(s)` : ""}`}
            className={cn(
              "min-w-28 flex-1 px-3 py-2",
              isActive && "bg-surface-raised/70",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "font-mono text-[10px] tracking-widest uppercase",
                  isActive ? "text-accent-action" : "text-faint",
                )}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={cn(
                  "flex size-4.5 items-center justify-center rounded-full border",
                  stateIconClasses[state],
                )}
              >
                {stateIcon[state]}
              </span>
            </div>
            <p className="mt-1 truncate text-xs font-medium text-foreground">{gate.label}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className={cn(
                  "font-mono text-[11px] tabular-nums",
                  state === "closable" || state === "closed"
                    ? "text-accent-success"
                    : gate.approvedCount > 0
                      ? "text-muted"
                      : "text-faint",
                )}
              >
                {gate.approvedCount}/{gate.requiredCount}
              </span>
              {outdated > 0 ? (
                <span
                  className="inline-flex items-center gap-0.5 font-mono text-[11px] text-accent-warning tabular-nums"
                  aria-label={`${outdated} artefactos desactualizados`}
                >
                  <TriangleAlert size={11} strokeWidth={2.25} aria-hidden />
                  {outdated}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
