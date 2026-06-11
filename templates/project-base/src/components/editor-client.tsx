"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Puck, type Data } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import { puckConfig, editorViewports } from "@/puck/config";
import { publishPage, savePageDraft } from "@/lib/actions";

type EditorPage = {
  id: string | number;
  title: string;
  path: string;
  puckData: Data | null;
  publishedData: Data | null;
};

const emptyData: Data = { root: { props: {} }, content: [], zones: {} };

const AUTOSAVE_MS = 1200;

/**
 * Standalone Puck editor. Drafts autosave (debounced) to `pages.puckData`;
 * the header Publish button snapshots the draft into `pages.publishedData`,
 * which is what the public URL renders.
 */
export function EditorClient({ page }: { page: EditorPage }) {
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Skip the initial onChange Puck fires while mounting.
  const mounted = useRef(false);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleChange = useCallback(
    (data: Data) => {
      if (!mounted.current) {
        mounted.current = true;
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const result = await savePageDraft(page.id, data);
        setSavedAt(result.savedAt);
      }, AUTOSAVE_MS);
    },
    [page.id]
  );

  const time = (iso: string) => new Date(iso).toLocaleTimeString();

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
        <a href="/edit" style={{ fontWeight: 600, textDecoration: "none", color: "#171717" }}>
          ← Páginas
        </a>
        <span style={{ color: "#a3a3a3" }}>/</span>
        <strong>{page.title}</strong>
        <code style={{ color: "#737373", fontSize: 12 }}>/{page.path}</code>
        <span style={{ marginLeft: "auto", color: "#a3a3a3", fontSize: 12 }}>
          {publishedAt
            ? `publicado a las ${time(publishedAt)}`
            : savedAt
              ? `borrador guardado a las ${time(savedAt)}`
              : "sin cambios"}
        </span>
        <a
          href={`/${page.path}`}
          target="_blank"
          style={{ color: "var(--brand-600, #4f46e5)", fontWeight: 600, textDecoration: "none" }}
        >
          Ver publicada ↗
        </a>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Puck
          config={puckConfig}
          data={page.puckData ?? emptyData}
          viewports={editorViewports}
          onChange={handleChange}
          onPublish={async (data) => {
            const result = await publishPage(page.id, data);
            setPublishedAt(result.publishedAt);
          }}
        />
      </div>
    </div>
  );
}
