import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthUser, getSessionUser } from "@/modules/platform-core/auth/adapter";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

/** Solo paths internos: evita open redirects vía ?next=. */
function safeInternalPath(path: string | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // El proxy deja pasar /login siempre; la página auto-redirige si la sesión
  // es real (contrato de rutas: evita loops con cookies stale).
  const sessionUser = await getSessionUser();
  if (sessionUser) redirect(`/w/${sessionUser.workspaceSlug}`);
  const authUser = await getAuthUser();
  if (authUser) redirect("/onboarding");

  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeInternalPath(rawNext);

  return <LoginForm next={next} />;
}
