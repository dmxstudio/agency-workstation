"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";

import {
  createProjectAction,
  type FormActionState,
} from "@/modules/platform-core/actions";
import { Button, Field, Input, Modal } from "@/ui";

const initialState: FormActionState = { error: null };

/**
 * Botón "Nuevo proyecto" + modal con el formulario de creación.
 * En éxito la server action redirige a /w/[slug]/p/[projectId].
 */
export function CreateProjectModal({ workspaceSlug }: { workspaceSlug: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createProjectAction,
    initialState,
  );

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} strokeWidth={2} aria-hidden />
        Nuevo proyecto
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nuevo proyecto"
        description="El proyecto se crea con sus 8 artefactos vacíos y el grafo de dependencias instanciado."
        size="sm"
      >
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <Field label="Nombre del proyecto" htmlFor="project-name" required>
            <Input
              id="project-name"
              name="name"
              placeholder="Sitio corporativo Acme"
              autoFocus
              required
              minLength={2}
              maxLength={120}
              invalid={!!state.error}
            />
          </Field>

          {state.error ? (
            <p
              role="alert"
              className="rounded border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger"
            >
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Creando…" : "Crear proyecto"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
