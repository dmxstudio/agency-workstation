"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/ui";

export interface CopyBlockProps {
  /** Texto completo que se copia al portapapeles (multilínea permitida). */
  text: string;
  /** Etiqueta accesible del botón de copia. */
  label?: string;
  className?: string;
}

/**
 * Bloque de código copiable: mono obligatoria para comandos y rutas (§11.4),
 * fondo raised, sin sombras. Copia siempre el texto completo.
 */
export function CopyBlock({ text, label = "Copiar comandos", className }: CopyBlockProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard no disponible (contexto inseguro): no-op
    }
  };

  return (
    <div
      className={cn(
        "relative rounded-md border border-border bg-surface-raised",
        className,
      )}
    >
      <pre className="overflow-x-auto px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed text-foreground">
        {text}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "Copiado" : label}
        aria-label={label}
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded border border-transparent text-muted transition-colors hover:border-border hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-action"
      >
        {copied ? (
          <Check size={12} strokeWidth={2.25} className="text-accent-success" aria-hidden />
        ) : (
          <Copy size={12} strokeWidth={2} aria-hidden />
        )}
      </button>
    </div>
  );
}
