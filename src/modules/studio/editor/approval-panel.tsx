"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createUsePuck, type Plugin } from "@puckeditor/core";
import {
  ArrowUpRight,
  GitCompareArrows,
  Link2,
  SquareCheckBig,
  TriangleAlert,
} from "lucide-react";

import {
  listCompositionBindings,
  parseAnyComposition,
  validateCompositionBindings,
  type BindingConflict,
  type CompositionBinding,
} from "@/modules/artifacts/bindings";
import { Button, StatusPill } from "@/ui";

import { useStudioEditor } from "./context";

/**
 * Panel "Aprobación" del Studio — el patrón validado en el spike §18.1
 * (`spikes/puck/lib/puck/approval-plugin.tsx`): un Plugin de Puck 0.21 con
 * panel propio en el rail izquierdo, al lado de Bloques/Outline. Diferencia
 * clave con el spike: aquí las transiciones NO son un toy — van por las
 * server actions del módulo artifacts (gated por rol, audit log, §19), y el
 * panel solo refleja el estado del artefacto `page.composition`.
 *
 * El plugin se crea UNA vez (objeto estable); todo lo vivo llega por
 * `StudioEditorContext` y por el store de Puck (`createUsePuck`).
 */

const usePuckSelector = createUsePuck();

// ---------------------------------------------------------------------------
// Guardado: "guardado hace Xs"
// ---------------------------------------------------------------------------

function formatAgo(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `hace ${minutes} min`;
}

function SaveIndicator() {
  const { saveState, editable } = useStudioEditor();
  const [now, setNow] = useState(() => Date.now());

  // Solo el tick periódico vive en el efecto; el "hace 0 s" inmediato tras un
  // guardado nuevo lo da el clamp de formatAgo (savedAt > now ⇒ 0 s) sin
  // setState síncrono (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (saveState.phase !== "saved" || saveState.savedAt == null) return;
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [saveState.phase, saveState.savedAt]);

  if (!editable && saveState.phase === "idle") return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted" role="status">
        {saveState.phase === "saving" ? (
          "Guardando borrador…"
        ) : saveState.phase === "dirty" ? (
          "Cambios sin guardar…"
        ) : saveState.phase === "saved" && saveState.savedAt != null ? (
          <>
            Borrador guardado{" "}
            <span className="font-mono tabular-nums">{formatAgo(saveState.savedAt, now)}</span>
          </>
        ) : saveState.phase === "error" ? (
          <span className="text-accent-danger">No se pudo guardar: {saveState.error}</span>
        ) : (
          "Sin cambios en esta sesión."
        )}
      </p>
      {saveState.issues.length > 0 ? (
        <ul
          role="alert"
          className="flex flex-col gap-0.5 rounded-md border border-accent-danger/40 bg-accent-danger/10 px-2 py-1.5"
        >
          {saveState.issues.map((issue, index) => (
            <li key={index} className="text-[11px] text-accent-danger">
              <span className="font-mono">{issue.path || "payload"}</span> — {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Indicador compacto para el header de Puck (sustituye al botón Publish). */
export function HeaderSaveIndicator() {
  const { saveState } = useStudioEditor();
  const [now, setNow] = useState(() => Date.now());

  // Mismo patrón que SaveIndicator: tick periódico en el efecto, frescura
  // inmediata vía el clamp de formatAgo (sin setState síncrono).
  useEffect(() => {
    if (saveState.phase !== "saved" || saveState.savedAt == null) return;
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [saveState.phase, saveState.savedAt]);

  const label =
    saveState.phase === "saving"
      ? "guardando…"
      : saveState.phase === "dirty"
        ? "sin guardar…"
        : saveState.phase === "saved" && saveState.savedAt != null
          ? `guardado ${formatAgo(saveState.savedAt, now)}`
          : saveState.phase === "error"
            ? "error al guardar"
            : "";

  if (!label) return <></>;
  return (
    <span
      className={
        saveState.phase === "error"
          ? "font-mono text-[11px] text-accent-danger"
          : "font-mono text-[11px] text-muted"
      }
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Bindings CMS en vivo (§7.4/§10.3): el helper compartido marca, nunca arregla
// ---------------------------------------------------------------------------

function shortConflictLabel(conflict: BindingConflict): string {
  return conflict.kind === "binding-missing-collection"
    ? `la colección «${conflict.collection}» ya no existe en la spec`
    : `el campo «${conflict.field}» ya no existe en «${conflict.collection}»`;
}

function BindingsSection() {
  const { artifact, cmsCollections, cmsArtifactHref } = useStudioEditor();
  const data = usePuckSelector((state) => state.appState.data);

  const { bindings, conflicts } = useMemo<{
    bindings: CompositionBinding[];
    conflicts: BindingConflict[];
  }>(() => {
    // El Data vivo del canvas tiene la misma forma que el payload v2.
    const composition = parseAnyComposition(data as unknown);
    if (!composition) return { bindings: [], conflicts: [] };
    return {
      bindings: listCompositionBindings(composition, artifact.pageKey),
      conflicts: cmsCollections
        ? validateCompositionBindings(composition, cmsCollections, artifact.pageKey)
        : [],
    };
  }, [data, cmsCollections, artifact.pageKey]);

  const conflictsBySection = useMemo(() => {
    const grouped = new Map<string, BindingConflict[]>();
    for (const conflict of conflicts) {
      const list = grouped.get(conflict.sectionId) ?? [];
      list.push(conflict);
      grouped.set(conflict.sectionId, list);
    }
    return grouped;
  }, [conflicts]);

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Link2 size={12} aria-hidden />
        Bindings CMS
      </h3>

      {bindings.length === 0 ? (
        <p className="text-xs text-faint">Esta página no tiene bindings CMS.</p>
      ) : cmsCollections == null ? (
        <p className="text-xs text-accent-warning">
          Hay {bindings.length} binding{bindings.length === 1 ? "" : "s"} pero no existe un
          Modelo de datos (cms.collections) aprobado contra el que validarlos.
        </p>
      ) : conflicts.length === 0 ? (
        <p className="text-xs text-muted">
          <span className="text-accent-success">✓</span> {bindings.length} binding
          {bindings.length === 1 ? "" : "s"} válido{bindings.length === 1 ? "" : "s"} contra el
          Modelo de datos aprobado.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[...conflictsBySection.entries()].map(([sectionId, sectionConflicts]) => (
            <div
              key={sectionId}
              className="rounded-md border border-accent-warning/40 bg-accent-warning/10 px-2 py-1.5"
            >
              <p className="flex items-center gap-1 text-[11px] font-medium text-accent-warning">
                <TriangleAlert size={11} aria-hidden />
                Sección <span className="font-mono">{sectionId}</span>
              </p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {sectionConflicts.map((conflict, index) => (
                  <li key={index} className="text-[11px] leading-snug text-muted">
                    <span className="font-mono text-foreground">{conflict.prop}</span>{" "}
                    <span className="font-mono">← {conflict.binding}</span>:{" "}
                    {shortConflictLabel(conflict)}. La composición no se modifica sola (§8.4) —
                    re-vincula el prop o restaura el campo.
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {cmsArtifactHref ? (
        <Link
          href={cmsArtifactHref}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Abrir Modelo de datos (CMS)
          <ArrowUpRight size={11} aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Panel principal
// ---------------------------------------------------------------------------

function ApprovalPanel() {
  const {
    artifact,
    canEdit,
    editable,
    readOnlyReason,
    pendingAction,
    actionError,
    notice,
    saveState,
    artifactHref,
    onStartNewVersion,
    onSubmitForReview,
    onOpenApprove,
    onOpenReject,
    onRevalidate,
    onOpenDiff,
  } = useStudioEditor();

  const data = usePuckSelector((state) => state.appState.data);
  const blockCount = Array.isArray(data.content) ? data.content.length : 0;
  const jsonKb = useMemo(() => {
    try {
      return (JSON.stringify(data).length / 1024).toFixed(1);
    } catch {
      return "—";
    }
  }, [data]);

  const submitDisabled =
    pendingAction ||
    saveState.phase === "dirty" ||
    saveState.phase === "saving" ||
    saveState.phase === "error" ||
    !artifact.hasDraft;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3 text-sm">
      {/* Estado del artefacto (§8.2) */}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold text-foreground">Estado</h3>
        <StatusPill
          status={artifact.status}
          outdated={artifact.outdated}
          rejected={artifact.rejected}
        />
        <p className="font-mono text-[11px] text-muted tabular-nums">
          {artifact.currentVersion > 0
            ? `v${artifact.currentVersion}`
            : "v0 · sin versión aprobada"}
          {artifact.lockedBy ? ` · lock: ${artifact.lockedBy}` : ""}
        </p>
        {readOnlyReason ? <p className="text-xs text-muted">{readOnlyReason}</p> : null}
      </section>

      {actionError ? (
        <p
          role="alert"
          className="rounded-md border border-accent-danger/40 bg-accent-danger/10 px-2 py-1.5 text-xs text-accent-danger"
        >
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-md border border-accent-success/40 bg-accent-success/10 px-2 py-1.5 text-xs text-accent-success"
        >
          {notice}
        </p>
      ) : null}

      {/* Ciclo §13 — solo humanos con rol; las acciones son server actions de artifacts */}
      {canEdit ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-foreground">Ciclo de aprobación</h3>
          <div className="flex flex-wrap gap-1.5">
            {artifact.status === "draft" || artifact.status === "empty" ? (
              <Button
                size="sm"
                disabled={submitDisabled}
                title={
                  saveState.phase === "dirty" || saveState.phase === "saving"
                    ? "Espera a que el autosave guarde el borrador."
                    : !artifact.hasDraft
                      ? "Compón algo primero: solo un borrador con contenido puede revisarse."
                      : undefined
                }
                onClick={onSubmitForReview}
              >
                Enviar a revisión
              </Button>
            ) : null}
            {artifact.status === "in_review" ? (
              <>
                <Button size="sm" variant="primary" disabled={pendingAction} onClick={onOpenApprove}>
                  Aprobar…
                </Button>
                <Button size="sm" variant="danger" disabled={pendingAction} onClick={onOpenReject}>
                  Rechazar…
                </Button>
              </>
            ) : null}
            {artifact.status === "approved" && !editable ? (
              <Button size="sm" variant="primary" disabled={pendingAction} onClick={onStartNewVersion}>
                Editar nueva versión
              </Button>
            ) : null}
            {artifact.outdated ? (
              <Button
                size="sm"
                disabled={pendingAction}
                className="border-accent-warning/40 text-accent-warning hover:bg-accent-warning/10"
                onClick={onRevalidate}
              >
                Revalidar sin cambios
              </Button>
            ) : null}
          </div>
          <SaveIndicator />
        </section>
      ) : (
        <SaveIndicator />
      )}

      {/* Diff estructural — componente firma (§11.4) */}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold text-foreground">Diff</h3>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={onOpenDiff}>
            <GitCompareArrows size={13} aria-hidden />
            Ver diff
          </Button>
          <Link
            href={artifactHref}
            className="inline-flex items-center gap-1 self-center text-[11px] font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Historial y versiones
            <ArrowUpRight size={11} aria-hidden />
          </Link>
        </div>
        <p className="text-[11px] text-faint">
          Borrador guardado vs. última versión aprobada, o entre versiones selladas.
        </p>
      </section>

      <BindingsSection />

      {/* Métricas del Data JSON (mono, §11.4) */}
      <section className="mt-auto border-t border-border pt-2 font-mono text-[11px] text-faint">
        <p>bloques raíz: {blockCount}</p>
        <p>data json: {jsonKb} kB</p>
        <p className="truncate" title={artifact.id}>
          {artifact.id}
        </p>
      </section>
    </div>
  );
}

/**
 * Plugin de Puck (rail izquierdo). Crear UNA vez por montaje del editor: el
 * panel lee todo del contexto y del store de Puck, así que el objeto puede
 * (y debe) ser estable.
 */
export function createApprovalPlugin(): Plugin {
  return {
    name: "studio-approval",
    label: "Aprobación",
    icon: <SquareCheckBig size={20} aria-hidden />,
    render: () => <ApprovalPanel />,
  };
}
