"use client";

import { useState, useTransition } from "react";
import { createUsePuck, type Data, type Plugin } from "@puckeditor/core";
import { diffPuckData } from "../diff";

/**
 * §18.1 punto 6 — "extensiones laterales".
 *
 * Puck 0.21 plugin: gets its own icon in the editor's plugin rail and renders
 * a side panel. The panel simulates the platform's propose→diff→approve loop:
 * approval state + transitions (persisted via server action) and a structural
 * diff of the live Data JSON vs. the last published snapshot, read through
 * `usePuck()` (public Puck API, no internals).
 */

export type ApprovalStatus = "draft" | "in_review" | "approved";

type PanelDeps = {
  pageId: string | number;
  initialStatus: ApprovalStatus;
  getBaseline: () => Data | null;
  onSetStatus: (status: ApprovalStatus) => Promise<void>;
  onSaveDraft: (data: Data) => Promise<void>;
};

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  approved: "Aprobado",
};

const STATUS_STYLE: Record<ApprovalStatus, React.CSSProperties> = {
  draft: { background: "#f5f5f5", color: "#525252", border: "1px solid #d4d4d4" },
  in_review: { background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d" },
  approved: { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
};

const KIND_LABEL: Record<string, string> = {
  added: "+ añadido",
  removed: "− eliminado",
  changed: "~ cambiado",
  moved: "↕ movido",
};

const KIND_COLOR: Record<string, string> = {
  added: "#166534",
  removed: "#991b1b",
  changed: "#92400e",
  moved: "#1e40af",
};

const btn: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  border: "1px solid #d4d4d4",
  background: "#fff",
  cursor: "pointer",
};

const usePuckSelector = createUsePuck();

function ApprovalPanel({ deps }: { deps: PanelDeps }) {
  const data = usePuckSelector((s) => s.appState.data);
  const history = usePuckSelector((s) => s.history);
  const [status, setStatus] = useState<ApprovalStatus>(deps.initialStatus);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const baseline = deps.getBaseline();
  const diff = diffPuckData(baseline, data as Data);
  const jsonBytes = new Blob([JSON.stringify(data)]).size;

  const transition = (next: ApprovalStatus) =>
    startTransition(async () => {
      await deps.onSetStatus(next);
      setStatus(next);
    });

  return (
    <div
      style={{
        padding: 16,
        fontSize: 13,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Aprobación</h3>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              ...STATUS_STYLE[status],
              padding: "3px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {STATUS_LABEL[status]}
          </span>
          {pending ? <span style={{ color: "#a3a3a3", fontSize: 11 }}>guardando…</span> : null}
        </div>
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {status === "draft" && (
            <button style={btn} onClick={() => transition("in_review")}>
              Enviar a revisión
            </button>
          )}
          {status === "in_review" && (
            <>
              <button
                style={{ ...btn, background: "#16a34a", borderColor: "#16a34a", color: "#fff" }}
                onClick={() => transition("approved")}
              >
                Aprobar
              </button>
              <button style={btn} onClick={() => transition("draft")}>
                Devolver a borrador
              </button>
            </>
          )}
          {status === "approved" && (
            <button style={btn} onClick={() => transition("draft")}>
              Reabrir como borrador
            </button>
          )}
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>
          Diff vs. última publicación
        </h3>
        {baseline == null ? (
          <p style={{ color: "#737373", marginTop: 6 }}>
            Esta página nunca se ha publicado: todo el contenido es nuevo (
            {diff.entries.length} bloques).
          </p>
        ) : diff.clean ? (
          <p style={{ color: "#16a34a", marginTop: 6 }}>Sin cambios sobre lo publicado.</p>
        ) : (
          <ul
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              listStyle: "none",
              padding: 0,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {diff.rootChanged ? (
              <li style={{ color: "#92400e" }}>~ cambiado root (metadatos de página)</li>
            ) : null}
            {diff.entries.map((e) => (
              <li key={`${e.kind}-${e.id}`} style={{ color: KIND_COLOR[e.kind] }}>
                {KIND_LABEL[e.kind]} {e.type}{" "}
                <span style={{ color: "#a3a3a3" }}>#{e.id.slice(0, 16)}</span>
                {e.detail ? <span style={{ color: "#737373" }}> ({e.detail})</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Borrador</h3>
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            style={btn}
            onClick={() =>
              startTransition(async () => {
                await deps.onSaveDraft(data as Data);
                setSavedAt(new Date().toLocaleTimeString());
              })
            }
          >
            Guardar borrador
          </button>
          <button style={btn} disabled={!history.hasPast} onClick={() => history.back()}>
            ← Deshacer
          </button>
          <button style={btn} disabled={!history.hasFuture} onClick={() => history.forward()}>
            Rehacer →
          </button>
        </div>
        {savedAt ? (
          <p style={{ color: "#737373", marginTop: 6, fontSize: 11 }}>
            Borrador guardado a las {savedAt}
          </p>
        ) : null}
      </div>

      <div
        style={{
          borderTop: "1px solid #e5e5e5",
          paddingTop: 10,
          color: "#737373",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
        }}
      >
        <div>data json: {(jsonBytes / 1024).toFixed(1)} kB</div>
        <div>bloques: {data.content?.length ?? 0} (nivel raíz)</div>
        <div>historial: {history.histories.length} estados</div>
      </div>
    </div>
  );
}

export function createApprovalPlugin(deps: PanelDeps): Plugin {
  return {
    name: "approvals",
    label: "Aprobación",
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    render: () => <ApprovalPanel deps={deps} />,
  };
}
