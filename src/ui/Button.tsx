import type { ComponentPropsWithRef } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const baseClasses =
  "inline-flex items-center justify-center gap-1.5 rounded font-medium whitespace-nowrap select-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action disabled:pointer-events-none disabled:opacity-50";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-accent-action text-white hover:bg-accent-action/85",
  secondary:
    "border border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-raised",
  ghost:
    "border border-transparent text-muted hover:bg-surface-raised hover:text-foreground",
  danger:
    "border border-accent-danger/40 text-accent-danger hover:bg-accent-danger/10 focus-visible:outline-accent-danger",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8.5 px-3.5 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
  );
}
