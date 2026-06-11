"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, TriangleAlert } from "lucide-react";

import { closeReviewRequestAction } from "@/modules/review/actions";
import { Button } from "@/ui";

/**
 * Cerrar la ronda: el token deja de aceptar comentarios y aprobaciones (la
 * lectura sigue disponible para el cliente). Las tareas de comentarios
 * abiertos NO se cierran — siguen reflejando feedback real (§12.2).
 */
export function CloseRoundButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    startTransition(async () => {
      const result = await closeReviewRequestAction(requestId);
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      setError(null);
      setConfirming(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">¿Cerrar la ronda?</span>
          <Button size="sm" variant="danger" onClick={close} disabled={pending} aria-busy={pending}>
            {pending ? "Cerrando…" : "Sí, cerrar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          <Archive size={14} strokeWidth={1.75} aria-hidden />
          Cerrar ronda
        </Button>
      )}
      {error ? (
        <p role="alert" className="flex items-center gap-1 text-xs text-accent-danger">
          <TriangleAlert size={12} strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
