import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthUser, getSessionUser } from "@/modules/platform-core/auth/adapter";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function RegisterPage() {
  // Auto-redirect con sesión real (contrato de rutas, igual que /login).
  const sessionUser = await getSessionUser();
  if (sessionUser) redirect(`/w/${sessionUser.workspaceSlug}`);
  const authUser = await getAuthUser();
  if (authUser) redirect("/onboarding");

  return <RegisterForm />;
}
