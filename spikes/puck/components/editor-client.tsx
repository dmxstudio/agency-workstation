"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Puck, type Data } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import { puckConfig, editorViewports } from "@/lib/puck/config";
import { createApprovalPlugin } from "@/lib/puck/approval-plugin";
import { publishPage, savePageDraft, setApprovalStatus } from "@/lib/actions";

type EditorPage = {
  id: string | number;
  title: string;
  path: string;
  puckData: Data | null;
  publishedData: Data | null;
  approvalStatus: "draft" | "in_review" | "approved";
};

const emptyData: Data = { root: { props: {} }, content: [], zones: {} };

function countSections(data: Data | null): number {
  if (!data) return 0;
  let n = 0;
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item && typeof item === "object" && "type" in item) {
        n++;
        const props = (item as { props?: Record<string, unknown> }).props ?? {};
        for (const v of Object.values(props)) walk(v);
      }
    }
  };
  walk(data.content);
  return n;
}

export function EditorClient({ page }: { page: EditorPage }) {
  // §18.1 punto 7 — initial render measurement (client mount → editor mounted)
  const t0 = useRef<number>(performance.now());
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const sectionCount = countSections(page.puckData);

  useEffect(() => {
    const ms = performance.now() - t0.current;
    setRenderMs(ms);
    performance.mark("puck-editor-interactive");
    console.log(
      `[spike] Puck editor mounted in ${ms.toFixed(0)}ms — ${sectionCount} sections, ` +
        `${(new Blob([JSON.stringify(page.puckData ?? {})]).size / 1024).toFixed(1)} kB data json`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Baseline for the approval panel diff = last published snapshot.
  const baselineRef = useRef<Data | null>(page.publishedData);

  const plugins = useMemo(
    () => [
      createApprovalPlugin({
        pageId: page.id,
        initialStatus: page.approvalStatus,
        getBaseline: () => baselineRef.current,
        onSetStatus: async (status) => {
          await setApprovalStatus(page.id, status);
        },
        onSaveDraft: async (data) => {
          await savePageDraft(page.id, data);
        },
      }),
    ],
    [page.id, page.approvalStatus]
  );

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderBottom: "1px solid #e5e5e5",
          fontSize: 13,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <a href="/" style={{ fontWeight: 600, textDecoration: "none", color: "#171717" }}>
          ← Páginas
        </a>
        <span style={{ color: "#a3a3a3" }}>/</span>
        <strong>{page.title}</strong>
        <code style={{ color: "#737373", fontSize: 12 }}>/{page.path}</code>
        <span style={{ marginLeft: "auto", color: "#a3a3a3", fontSize: 12 }}>
          {renderMs != null
            ? `editor montado en ${renderMs.toFixed(0)} ms · ${sectionCount} secciones`
            : "cargando…"}
        </span>
        <a
          href={`/${page.path}`}
          target="_blank"
          style={{ color: "#4f46e5", fontWeight: 600, textDecoration: "none" }}
        >
          Ver publicada ↗
        </a>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Puck
          config={puckConfig}
          data={page.puckData ?? emptyData}
          viewports={editorViewports}
          plugins={plugins}
          onPublish={async (data) => {
            await publishPage(page.id, data);
            baselineRef.current = data;
          }}
        />
      </div>
    </div>
  );
}
