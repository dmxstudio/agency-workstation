"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link as LinkIcon } from "lucide-react";

import { Button } from "@/ui";

/**
 * Copia el enlace PÚBLICO de una ronda (`/review/<token>`) como URL absoluta.
 * El origin solo se conoce en el navegador, por eso es una isla client.
 */
export function CopyReviewLink({
  token,
  size = "sm",
}: {
  token: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/review/${token}`,
      );
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard no disponible (contexto inseguro): no-op */
    }
  };

  return (
    <Button size={size} variant="secondary" onClick={copy} title="Copiar enlace para el cliente">
      {copied ? (
        <Check size={13} strokeWidth={2.25} className="text-accent-success" aria-hidden />
      ) : (
        <LinkIcon size={13} strokeWidth={2} aria-hidden />
      )}
      {copied ? "Copiado" : "Copiar enlace"}
    </Button>
  );
}
