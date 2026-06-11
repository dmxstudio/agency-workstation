"use client";

import { useActionState, useState } from "react";

import {
  createWorkspaceAction,
  type FormActionState,
} from "@/modules/platform-core/actions";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from "@/ui";

const initialState: FormActionState = { error: null };

/**
 * Réplica cliente de `slugifyWorkspaceName` (platform-core/workspaces.ts).
 * No se importa de allí porque ese módulo arrastra el cliente de DB y no
 * puede entrar en el bundle del navegador.
 */
function slugifyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function OnboardingForm({
  userName,
  title,
  description,
}: {
  userName: string;
  title: string;
  description: string;
}) {
  const [state, formAction, pending] = useActionState(
    createWorkspaceAction,
    initialState,
  );
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Hola, {userName}. {description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <Field label="Nombre del workspace" htmlFor="workspace-name" required>
            <Input
              id="workspace-name"
              name="name"
              placeholder="Mi Agencia"
              required
              minLength={2}
              maxLength={80}
              autoFocus
              onChange={(event) => {
                if (!slugTouched) setSlug(slugifyName(event.target.value));
              }}
            />
          </Field>

          <Field
            label="Slug"
            htmlFor="workspace-slug"
            hint="Minúsculas, números y guiones. Será la URL: /w/<slug>"
          >
            <Input
              id="workspace-slug"
              name="slug"
              value={slug}
              placeholder="mi-agencia"
              maxLength={48}
              pattern="[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?"
              className="font-mono text-xs"
              invalid={!!state.error}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
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

          <Button type="submit" variant="primary" disabled={pending} className="w-full">
            {pending ? "Creando…" : "Crear workspace"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
