"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ChevronRight, Sparkles, X } from "lucide-react";

import { cn } from "@/ui";

import { getAssistantContextAction } from "./actions";
import { RunLive } from "./run-live";
import { SkillForm } from "./skill-form";
import type {
  AssistantContextData,
  AssistantSkillInfo,
  AssistantSurface,
  AssistantTypeOption,
  RunStatusView,
} from "./types";

/**
 * Asistente contextual ÚNICO (§9.2): botón discreto + panel lateral sobrio.
 * Debut del acento violeta — reservado EXCLUSIVAMENTE a actividad de agentes
 * (§11.4): vive en este trigger, en la identidad del panel y en el estado del
 * run, y en ningún otro sitio de la plataforma.
 *
 * El panel es un overlay (sheet) sobre la pantalla actual: no altera el
 * layout, cierra con Esc o clic fuera, y todo lo que muestra del workspace
 * son skills del registry + estado de runs en DB (polling ligero).
 */

export interface AssistantPanelProps {
  surface: AssistantSurface;
  projectId: string;
  /** Base del proyecto: /w/[slug]/p/[projectId]. */
  basePath: string;
  settingsHref: string;
  skills: AssistantSkillInfo[];
  typeOptions: AssistantTypeOption[];
  artifactType?: string;
  artifactKey?: string;
}

type View =
  | { kind: "skills" }
  | { kind: "form"; skill: AssistantSkillInfo }
  | { kind: "run"; run: RunStatusView; skillLabel: string };

export function AssistantPanel({
  surface,
  projectId,
  basePath,
  settingsHref,
  skills,
  typeOptions,
  artifactType,
  artifactKey,
}: AssistantPanelProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "skills" });
  const [context, setContext] = useState<AssistantContextData | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const refreshContext = useCallback(() => {
    startLoading(async () => {
      const result = await getAssistantContextAction(projectId);
      if (result.ok) {
        setContext(result.data);
        setContextError(null);
      } else {
        setContextError(result.error);
      }
    });
  }, [projectId]);

  const openPanel = () => {
    setOpen(true);
    setView(
      skills.length === 1 ? { kind: "form", skill: skills[0] } : { kind: "skills" },
    );
    refreshContext();
  };
  const close = useCallback(() => setOpen(false), []);

  // Esc cierra; el scroll del fondo se congela mientras el sheet está abierto.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  return (
    <>
      {/* Trigger discreto: violeta = lo hace una IA (§11.4) */}
      <button
        type="button"
        onClick={openPanel}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded border border-accent-agent/40 px-2.5 text-xs font-medium whitespace-nowrap text-accent-agent transition-colors select-none",
          "hover:bg-accent-agent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-agent",
        )}
      >
        <Sparkles size={13} strokeWidth={1.75} aria-hidden />
        Asistente
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/60"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Asistente de agentes"
            className="fixed inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border-strong bg-surface"
          >
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Sparkles size={15} className="shrink-0 text-accent-agent" aria-hidden />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  Asistente
                </h2>
                <p className="truncate text-xs text-muted">
                  Skills con contrato: leen contexto aprobado, escriben propuestas. Tú
                  decides.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar"
                className="-m-1 ml-auto rounded p-1 text-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-agent"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {view.kind === "run" ? (
                <RunLive
                  initialRun={view.run}
                  skillLabel={view.skillLabel}
                  basePath={basePath}
                  onReset={() => {
                    refreshContext();
                    setView(
                      skills.length === 1
                        ? { kind: "form", skill: skills[0] }
                        : { kind: "skills" },
                    );
                  }}
                />
              ) : loading && !context ? (
                <p className="text-xs text-muted" role="status">
                  Cargando contexto del proyecto…
                </p>
              ) : contextError ? (
                <p role="alert" className="text-xs text-accent-danger">
                  {contextError}
                </p>
              ) : context == null ? null : view.kind === "form" ? (
                <SkillForm
                  key={view.skill.name}
                  skill={view.skill}
                  typeOptions={typeOptions}
                  context={context}
                  surface={surface}
                  artifactType={artifactType}
                  artifactKey={artifactKey}
                  projectId={projectId}
                  settingsHref={settingsHref}
                  onLaunched={(run) =>
                    setView({ kind: "run", run, skillLabel: view.skill.label })
                  }
                  onBack={
                    skills.length > 1 ? () => setView({ kind: "skills" }) : null
                  }
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {skills.map((skill) => (
                    <li key={skill.name}>
                      <button
                        type="button"
                        onClick={() => setView({ kind: "form", skill })}
                        className="group flex w-full items-start gap-2 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:border-accent-agent/40 hover:bg-accent-agent/5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {skill.label}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">{skill.description}</p>
                          <p className="mt-1 font-mono text-[10px] text-faint">
                            {skill.name}@{skill.version}
                          </p>
                        </div>
                        <ChevronRight
                          size={14}
                          className="mt-1 shrink-0 text-faint transition-colors group-hover:text-accent-agent"
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <footer className="border-t border-border px-4 py-2.5">
              <p className="text-[11px] text-faint">
                Toda actividad de agentes queda auditada: qué leyó, qué propuso, qué modelo
                usó y quién decidió (§9.6).
              </p>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
