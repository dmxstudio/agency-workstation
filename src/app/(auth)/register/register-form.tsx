"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  signUpAction,
  type FormActionState,
} from "@/modules/platform-core/actions";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from "@/ui";

const initialState: FormActionState = { error: null };

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crear cuenta</CardTitle>
        <CardDescription>
          Después crearás tu primer workspace de agencia.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <Field label="Nombre" htmlFor="register-name" required>
            <Input
              id="register-name"
              name="name"
              autoComplete="name"
              placeholder="Ada Lovelace"
              required
              minLength={2}
              maxLength={120}
              autoFocus
            />
          </Field>

          <Field label="Email" htmlFor="register-email" required>
            <Input
              id="register-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="tu@agencia.com"
              required
            />
          </Field>

          <Field
            label="Contraseña"
            htmlFor="register-password"
            hint="Mínimo 8 caracteres."
            required
          >
            <Input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              required
              minLength={8}
              maxLength={256}
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

          <Button type="submit" variant="primary" disabled={pending} className="w-full">
            {pending ? "Creando cuenta…" : "Crear cuenta"}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted">
          ¿Ya tienes cuenta?{" "}
          <Link
            href="/login"
            className="text-accent-action underline-offset-2 hover:underline"
          >
            Inicia sesión
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
