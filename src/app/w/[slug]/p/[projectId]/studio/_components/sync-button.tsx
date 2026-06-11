"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { syncCompositionArtifactsAction } from "@/modules/artifacts/actions";
import { Button, cn } from "@/ui";

/**
 * Botón "Sincronizar páginas desde sitemap": deriva los artefactos
 * `page.composition` del sitemap APROBADO (uno por página). Reusa la server
 * action del módulo artifacts — crea los que falten y marca como `outdated`
 * los de páginas que salieron del sitemap; nunca borra ni regenera (§8.4).
 */

export interface SyncCompositionsButtonProps {
  projectId: string;
  /** Rol admin|member. */
  enabled: boolean;
  /** Por qué está deshabilitado (se muestra junto al botón). */
  disabledReason: string | null;
  size?: "sm" | "md";
}

export function SyncCompositionsButton({
  projectId,
  enabled,
  disabledReason,
  size = "md",
}: SyncCompositionsButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = () => {
    startTransition(async () => {
      const result = await syncCompositionArtifactsAction(projectId);
      if (!result.ok) {
        setError(result.error);
        setNotice(null);
        return;
      }
      setError(null);
      const { created, orphaned, migratedLegacyId } = result.data;
      const parts: string[] = [];
      if (created.length > 0) {
        parts.push(`${created.length} composici${created.length === 1 ? "ón creada" : "ones creadas"}`);
      }
      if (orphaned.length > 0) {
        parts.push(
          `${orphaned.length} marcada${orphaned.length === 1 ? "" : "s"} fuera del sitemap`,
        );
      }
      if (migratedLegacyId) parts.push("composición legada migrada a la home");
      setNotice(
        parts.length > 0
          ? `Sincronización completada: ${parts.join(", ")}.`
          : "Sin cambios: las páginas ya estaban sincronizadas con el sitemap.",
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size={size} onClick={handleSync} disabled={!enabled || pending} aria-busy={pending}>
          <RefreshCw
            size={13}
            strokeWidth={1.75}
            className={pending ? "animate-spin" : undefined}
            aria-hidden
          />
          {pending ? "Sincronizando…" : "Sincronizar páginas desde sitemap"}
        </Button>
        {!enabled && disabledReason ? (
          <span className="text-xs text-muted">{disabledReason}</span>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className={cn("text-xs", "text-accent-success")}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-accent-danger">
          <TriangleAlert size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
