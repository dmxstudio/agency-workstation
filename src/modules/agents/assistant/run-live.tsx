"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, CircleAlert, X } from "lucide-react";

import { Badge, Button, cn } from "@/ui";

import { getAgentRunStatusAction } from "./actions";
import type { RunStatusView } from "./types";

/**
 * Estado en vivo de un agent run (§7.9, §11.4): polling ligero del estado en
 * DB hasta que el run se asienta. Violeta = actividad de agentes (debut del
 * acento); mono para run id, modelo, tokens y detalle de error.
 */

const POLL_MS = 1500;

const STATUS_LABELS: Record<RunStatusView["status"], string> = {
  queued: "En cola",
  running: "Ejecutando",
  proposed: "Propuesta lista",
  approved: "Aprobado",
  rejected: "Rechazado",
  failed: "Fallido",
};

function isSettled(status: RunStatusView["status"]): boolean {
  return status !== "queued" && status !== "running";
}

export interface RunLiveProps {
  initialRun: RunStatusView;
  /** Etiqueta humana de la skill (el run solo lleva el name técnico). */
  skillLabel: string;
  /** Base del proyecto: /w/[slug]/p/[projectId]. */
  basePath: string;
  onReset: () => void;
}

export function RunLive({ initialRun, skillLabel, basePath, onReset }: RunLiveProps) {
  const router = useRouter();
  const [run, setRun] = useState<RunStatusView>(initialRun);
  const [pollError, setPollError] = useState<string | null>(null);

  // Polling ligero del estado en DB hasta que el run se asienta. El id y el
  // estado inicial son estables por montaje (el panel remonta por run).
  useEffect(() => {
    if (isSettled(initialRun.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const result = await getAgentRunStatusAction(initialRun.id);
      if (cancelled) return;
      if (result.ok) {
        setPollError(null);
        setRun(result.data);
        if (isSettled(result.data.status)) {
          // La pantalla bajo el panel debe reflejar el draft propuesto
          // (status pills, banners): refresco del server state, sin navegar.
          router.refresh();
          return;
        }
      } else {
        setPollError(result.error);
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initialRun.id, initialRun.status, router]);

  const active = !isSettled(run.status);
  const validations = run.validations ?? [];
  const artifactHref = run.targetArtifactId
    ? `${basePath}/artifacts/${run.targetArtifactId}`
    : null;
  const runHref = `${basePath}/runs/${run.id}`;

  return (
    <div className="flex flex-col gap-3">
      {/* Identidad del run — mono obligatoria (§11.4) */}
      <div className="rounded-md border border-accent-agent/40 bg-accent-agent/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full bg-accent-agent",
              active && "animate-pulse",
            )}
            aria-hidden
          />
          <span className="text-sm font-medium text-foreground">{skillLabel}</span>
          <Badge tone="agent">{STATUS_LABELS[run.status]}</Badge>
        </div>
        <dl className="mt-2 flex flex-col gap-0.5 font-mono text-[11px] text-muted">
          <div className="flex gap-2">
            <dt className="text-faint">run</dt>
            <dd className="truncate">{run.id}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-faint">skill</dt>
            <dd>
              {run.skill}@{run.skillVersion}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-faint">modelo</dt>
            <dd>{run.modelId ?? `${run.provider} · pendiente`}</dd>
          </div>
          {run.usage ? (
            <div className="flex gap-2 tabular-nums">
              <dt className="text-faint">uso</dt>
              <dd>
                {run.usage.inputTokens}→{run.usage.outputTokens} tok · $
                {run.usage.costUsd.toFixed(4)}
              </dd>
            </div>
          ) : null}
        </dl>
        {run.instruction ? (
          <p className="mt-2 border-t border-accent-agent/20 pt-2 text-xs text-muted">
            Instrucción: <span className="text-foreground">{run.instruction}</span>
          </p>
        ) : null}
      </div>

      {active ? (
        <p className="text-xs text-muted" role="status">
          {run.status === "queued"
            ? "El run está en cola; empezará en un momento…"
            : "La skill está leyendo el contexto aprobado y generando la propuesta…"}
        </p>
      ) : null}
      {pollError ? (
        <p className="text-xs text-accent-warning">
          No se pudo refrescar el estado: {pollError}
        </p>
      ) : null}

      {/* Validaciones de la skill (§8.6) */}
      {validations.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
          {validations.map((validation) => (
            <li key={validation.key} className="text-xs">
              <span className="flex items-center gap-1.5">
                {validation.ok ? (
                  <Check size={12} className="shrink-0 text-accent-success" aria-hidden />
                ) : (
                  <X size={12} className="shrink-0 text-accent-danger" aria-hidden />
                )}
                <span className="text-foreground">{validation.label}</span>
                <span className="ml-auto font-mono text-[10px] text-faint">
                  {validation.key}
                </span>
              </span>
              {validation.detail ? (
                <p className="mt-0.5 pl-4.5 text-[11px] text-muted">{validation.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Fallo: detalle diferenciado en mono (§16) */}
      {run.status === "failed" && run.errorDetail ? (
        <div className="rounded-md border border-accent-danger/40 bg-accent-danger/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-accent-danger">
            <CircleAlert size={13} aria-hidden />
            El run falló
          </p>
          <p className="mt-1 font-mono text-[11px] break-words text-muted">
            {run.errorDetail}
          </p>
        </div>
      ) : null}

      {/* Decisión humana: la propuesta se revisa y aprueba vía artifacts (§19) */}
      {run.status === "proposed" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            La propuesta quedó como borrador del artefacto. Revisarla, aprobarla o
            rechazarla es una decisión humana.
          </p>
          <Link
            href={runHref}
            className="inline-flex h-8.5 items-center justify-center gap-1.5 rounded border border-transparent bg-accent-action px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-action/85"
          >
            Revisar propuesta
            <ArrowUpRight size={14} aria-hidden />
          </Link>
          {artifactHref ? (
            <Link
              href={artifactHref}
              className="text-center text-xs text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              Abrir el artefacto objetivo (diff e historial)
            </Link>
          ) : null}
        </div>
      ) : null}

      {isSettled(run.status) ? (
        <Button variant="ghost" size="sm" onClick={onReset}>
          Lanzar otra skill
        </Button>
      ) : null}
    </div>
  );
}
