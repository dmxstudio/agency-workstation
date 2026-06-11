import type { ComponentPropsWithRef } from "react";
import { cn } from "./cn";

export type BadgeTone =
  | "neutral"
  | "action"
  | "success"
  | "warning"
  | "danger"
  | "agent";

export interface BadgeProps extends ComponentPropsWithRef<"span"> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-border text-muted",
  action: "border-accent-action/40 bg-accent-action/10 text-accent-action",
  success: "border-accent-success/40 bg-accent-success/10 text-accent-success",
  warning: "border-accent-warning/40 bg-accent-warning/10 text-accent-warning",
  danger: "border-accent-danger/40 bg-accent-danger/10 text-accent-danger",
  /* Violeta: reservado EXCLUSIVAMENTE para actividad de agentes IA (§11.4) */
  agent: "border-accent-agent/40 bg-accent-agent/10 text-accent-agent",
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[11px] font-medium leading-4 whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
