"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowUpRight, Check, Eye, ListTodo, TriangleAlert } from "lucide-react";

import { Badge, Button, EmptyState, Input, Select } from "@/ui";

import {
  completeManualTaskAction,
  createManualTaskAction,
  type TaskFormState,
} from "./actions";

/** Viewmodel serializable que construye la page (server) para esta lista. */
export interface CockpitTask {
  id: string;
  kind: "derived" | "manual";
  /** Para derivadas: causa según el prefijo del dedupeKey (§12.2). */
  derivedKind: "review" | "outdated" | null;
  title: string;
  assigneeName: string | null;
  /** Link al artefacto causante (derivadas) o vinculado (manuales). */
  artifactHref: string | null;
  /** Timestamp relativo ya formateado en el servidor (es). */
  createdAtLabel: string;
}

export interface AssigneeOption {
  id: string;
  name: string;
}

interface TasksPanelProps {
  projectId: string;
  tasks: CockpitTask[];
  assignees: AssigneeOption[];
  /** false para rol client: oculta creación y cierre de tareas. */
  canEdit: boolean;
}

const initialState: TaskFormState = { error: null };

function DoneButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title="Marcar como hecha"
      aria-label="Marcar tarea como hecha"
      className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border border-border-strong text-transparent transition-colors hover:border-accent-success hover:text-accent-success focus-visible:outline-2 focus-visible:outline-accent-action disabled:opacity-50"
    >
      <Check size={11} strokeWidth={2.5} aria-hidden />
    </button>
  );
}

function DerivedIcon({ kind }: { kind: CockpitTask["derivedKind"] }) {
  if (kind === "outdated") {
    return (
      <span
        className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center text-accent-warning"
        title="Tarea derivada: re-validación por dependencia desactualizada"
      >
        <TriangleAlert size={12} strokeWidth={2.25} aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center text-accent-action"
      title="Tarea derivada: artefacto en revisión"
    >
      <Eye size={12} strokeWidth={2.25} aria-hidden />
    </span>
  );
}

function TaskRow({ task, canEdit }: { task: CockpitTask; canEdit: boolean }) {
  return (
    <li className="flex items-start gap-2 py-2">
      {task.kind === "manual" ? (
        canEdit ? (
          <form action={completeManualTaskAction.bind(null, task.id)}>
            <DoneButton />
          </form>
        ) : (
          <span className="mt-0.5 size-4.5 shrink-0 rounded-full border border-border" aria-hidden />
        )
      ) : (
        <DerivedIcon kind={task.derivedKind} />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 text-foreground">
          {task.title}
          {task.artifactHref ? (
            <Link
              href={task.artifactHref}
              aria-label="Abrir artefacto vinculado"
              className="ml-1.5 inline-flex translate-y-px items-center text-faint transition-colors hover:text-foreground"
            >
              <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
            </Link>
          ) : null}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
          {task.kind === "derived" ? (
            <Badge className="px-1 py-0 font-mono text-[10px]">auto</Badge>
          ) : null}
          <span>{task.assigneeName ?? "Sin responsable"}</span>
          <span className="font-mono tabular-nums">{task.createdAtLabel}</span>
        </p>
      </div>
    </li>
  );
}

/**
 * Tareas abiertas del proyecto (§12.2): derivadas (solo-lectura, se cierran
 * solas al resolverse la causa) + manuales (form mínimo título/responsable,
 * cierre con un click).
 */
export function TasksPanel({ projectId, tasks, assignees, canEdit }: TasksPanelProps) {
  const [state, formAction, pending] = useActionState(createManualTaskAction, initialState);
  const [title, setTitle] = useState("");
  const wasPending = useRef(false);

  // Limpia el título solo cuando la creación terminó sin error.
  useEffect(() => {
    if (wasPending.current && !pending && state.error === null) {
      setTitle("");
    }
    wasPending.current = pending;
  }, [pending, state]);

  return (
    <div className="flex flex-col">
      {tasks.length === 0 ? (
        <EmptyState
          icon={<ListTodo size={20} strokeWidth={1.75} aria-hidden />}
          title="Sin tareas abiertas"
          description="Las tareas derivadas aparecen solas cuando un artefacto entra en revisión o queda desactualizado."
          className="border-0 py-8"
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} canEdit={canEdit} />
          ))}
        </ul>
      )}

      {canEdit ? (
        <form
          action={formAction}
          className="mt-1 flex flex-col gap-2 border-t border-border pt-3"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <Input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Nueva tarea manual…"
            aria-label="Título de la nueva tarea"
            required
            maxLength={200}
            invalid={!!state.error}
          />
          <div className="flex items-center gap-2">
            <Select
              name="assigneeId"
              aria-label="Responsable"
              defaultValue=""
              className="min-w-0 flex-1"
            >
              <option value="">Sin responsable</option>
              {assignees.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
            <Button
              type="submit"
              size="sm"
              disabled={pending || title.trim().length === 0}
            >
              {pending ? "Añadiendo…" : "Añadir"}
            </Button>
          </div>
          {state.error ? (
            <p role="alert" className="text-xs text-accent-danger">
              {state.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
