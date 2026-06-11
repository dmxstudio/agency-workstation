"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  signInAction,
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

export function LoginForm({ next }: { next: string | null }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Accede a tu workspace de agencia.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}

          <Field label="Email" htmlFor="login-email" required>
            <Input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="tu@agencia.com"
              required
              autoFocus
            />
          </Field>

          <Field label="Contraseña" htmlFor="login-password" required>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
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
            {pending ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted">
          ¿No tienes cuenta?{" "}
          <Link
            href="/register"
            className="text-accent-action underline-offset-2 hover:underline"
          >
            Regístrate
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
