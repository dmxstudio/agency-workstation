import type { ComponentPropsWithRef, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

export interface FieldProps {
  label: string;
  /** id del control asociado (se pasa como `htmlFor` del label). */
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Wrapper de campo de formulario: label pequeño con tracking, hint y error (§11.4). */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium tracking-wide text-muted"
      >
        {label}
        {required ? (
          <span className="ml-0.5 text-accent-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-accent-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

const controlBase =
  "w-full rounded border border-border bg-background text-sm text-foreground placeholder:text-faint transition-colors focus:border-accent-action focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-accent-danger";

export interface InputProps extends ComponentPropsWithRef<"input"> {
  /** Marca el control como inválido (borde danger + aria-invalid). */
  invalid?: boolean;
}

export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(controlBase, "h-8.5 px-2.5", className)}
      {...props}
    />
  );
}

export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(controlBase, "min-h-20 px-2.5 py-2", className)}
      {...props}
    />
  );
}

export interface SelectProps extends ComponentPropsWithRef<"select"> {
  invalid?: boolean;
}

export function Select({ invalid, className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(controlBase, "h-8.5 appearance-none pr-8 pl-2.5", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={2}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-faint"
      />
    </div>
  );
}
