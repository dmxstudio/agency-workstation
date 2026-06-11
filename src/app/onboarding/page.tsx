import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthUser, getSessionUser } from "@/modules/platform-core/auth/adapter";

import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Crear workspace" };

export default async function OnboardingPage() {
  // Sesión real obligatoria (el proxy solo comprueba presencia de cookie).
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login?next=/onboarding");

  // Si ya pertenece a un workspace, la pantalla sigue sirviendo para crear
  // otro; solo cambia el copy y se ofrece la vuelta.
  const sessionUser = await getSessionUser();
  const hasWorkspace = sessionUser !== null;

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center px-4 py-10">
      <main className="w-full max-w-sm">
        <p className="mb-6 text-center font-mono text-[11px] tracking-widest text-faint uppercase">
          Agency Workstation
        </p>
        <OnboardingForm
          userName={authUser.name}
          title={hasWorkspace ? "Nuevo workspace" : "Crea tu workspace"}
          description={
            hasWorkspace
              ? "Un workspace agrupa proyectos y miembros de una agencia."
              : "Tu agencia trabaja dentro de un workspace: proyectos, miembros y artefactos."
          }
        />
        {hasWorkspace ? (
          <p className="mt-4 text-center text-xs text-muted">
            <Link
              href={`/w/${sessionUser.workspaceSlug}`}
              className="text-accent-action underline-offset-2 hover:underline"
            >
              Volver a {sessionUser.workspaceSlug}
            </Link>
          </p>
        ) : null}
      </main>
    </div>
  );
}
