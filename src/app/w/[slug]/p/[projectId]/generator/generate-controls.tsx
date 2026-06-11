"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Hammer, RefreshCw, TriangleAlert } from "lucide-react";

import {
  generateProjectAction,
  regenerateProjectAction,
} from "@/modules/generator/actions";
import { Button, cn } from "@/ui";

/**
 * Islands de mutación de la pantalla Generator. Llaman a las server actions
 * del módulo generator y refrescan el router (la revalidación es
 * responsabilidad de la pantalla llamante, mismo patrón que artifacts).
 */

interface RunNotice {
  tone: "success" | "warning";
  text: string;
}

function NoticeLine({ notice }: { notice: RunNotice }) {
  return (
    <p
      role="status"
      className={cn(
        "text-xs",
        notice.tone === "warning" ? "text-accent-warning" : "text-accent-success",
      )}
    >
      {notice.text}
    </p>
  );
}

function ErrorLine({ error }: { error: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-accent-danger">
      <TriangleAlert size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
      <span>{error}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Generación inicial
// ---------------------------------------------------------------------------

export interface GenerateButtonProps {
  projectId: string;
  /** Requisitos cumplidos + rol admin|member. */
  enabled: boolean;
  /** Por qué está deshabilitado (se muestra bajo el botón). */
  disabledReason: string | null;
}

export function GenerateButton({ projectId, enabled, disabledReason }: GenerateButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = () => {
    startTransition(async () => {
      const result = await generateProjectAction(projectId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      // La pantalla se re-renderiza: panel de proyecto generado + conflictos.
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant="primary"
        onClick={handleGenerate}
        disabled={!enabled || pending}
        aria-busy={pending}
      >
        <Hammer size={14} strokeWidth={1.75} aria-hidden />
        {pending ? "Generando…" : "Generar proyecto"}
      </Button>
      {!enabled && disabledReason ? (
        <p className="max-w-sm text-center text-xs text-muted">{disabledReason}</p>
      ) : null}
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regeneración parcial (§18.2)
// ---------------------------------------------------------------------------

export interface RegenerateControlsProps {
  projectId: string;
  /** Requisitos cumplidos + rol admin|member. */
  enabled: boolean;
  disabledReason: string | null;
}

export function RegenerateControls({
  projectId,
  enabled,
  disabledReason,
}: RegenerateControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<RunNotice | null>(null);

  const handleRegenerate = () => {
    setConfirming(false);
    startTransition(async () => {
      const result = await regenerateProjectAction(projectId);
      if (!result.ok) {
        setError(result.error);
        setNotice(null);
        return;
      }
      setError(null);
      const { summary } = result.data;
      const conflictCount = summary.conflicts.length;
      const changes =
        summary.written.length + summary.created.length + summary.deletedOrphans.length;
      const changeText =
        changes === 0
          ? "sin cambios (ya estaba al día)"
          : `${summary.written.length} reescritos, ${summary.created.length} creados, ${summary.deletedOrphans.length} huérfanos eliminados`;
      setNotice(
        conflictCount > 0
          ? {
              tone: "warning",
              text: `Regeneración completada con ${conflictCount} conflicto${conflictCount === 1 ? "" : "s"} — ${changeText}. Revisa el panel de conflictos.`,
            }
          : { tone: "success", text: `Regeneración completada: ${changeText}.` },
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">¿Regenerar ahora desde la spec aprobada?</span>
          <Button size="sm" variant="primary" onClick={handleRegenerate} disabled={pending}>
            Sí, regenerar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => setConfirming(true)}
            disabled={!enabled || pending}
            aria-busy={pending}
          >
            <RefreshCw
              size={14}
              strokeWidth={1.75}
              className={pending ? "animate-spin" : undefined}
              aria-hidden
            />
            {pending ? "Regenerando…" : "Regenerar"}
          </Button>
          {!enabled && disabledReason ? (
            <span className="text-xs text-muted">{disabledReason}</span>
          ) : null}
        </div>
      )}
      {notice ? <NoticeLine notice={notice} /> : null}
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}
