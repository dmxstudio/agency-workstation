"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "./cn";

export interface MonoIdProps {
  /** El identificador completo, p.ej. `art_x7k2m9q4`. */
  id: string;
  /** Si se define, muestra solo los primeros N caracteres seguidos de una elipsis. */
  truncate?: number;
  className?: string;
}

/**
 * ID en tipografía mono (obligatoria para identificadores, §11.4) con
 * copy-to-clipboard al click. Siempre copia el ID completo, aunque se trunque.
 */
export function MonoId({ id, truncate, className }: MonoIdProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const display =
    truncate !== undefined && id.length > truncate
      ? `${id.slice(0, truncate)}…`
      : id;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard no disponible (p.ej. contexto inseguro): no-op
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copiado" : `Copiar ${id}`}
      aria-label={`Copiar ID ${id}`}
      className={cn(
        "inline-flex items-center gap-1 rounded border border-transparent px-1 py-px font-mono text-xs text-muted transition-colors hover:border-border hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-action",
        className,
      )}
    >
      <span className="truncate">{display}</span>
      {copied ? (
        <Check size={11} strokeWidth={2.25} className="shrink-0 text-accent-success" aria-hidden />
      ) : (
        <Copy size={11} strokeWidth={2} className="shrink-0 opacity-60" aria-hidden />
      )}
    </button>
  );
}
