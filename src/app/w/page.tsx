import { redirect } from "next/navigation";

import { getAuthUser, getSessionUser } from "@/modules/platform-core/auth/adapter";

/**
 * Resolver de `/w` (contrato de rutas): nunca renderiza UI. El proxy manda
 * aquí a quien tiene cookie; esta página resuelve el destino con la sesión
 * real — workspace activo, onboarding si aún no pertenece a ninguno, o login.
 */
export default async function WorkspaceResolverPage() {
  const sessionUser = await getSessionUser();
  if (sessionUser) redirect(`/w/${sessionUser.workspaceSlug}`);

  const authUser = await getAuthUser();
  if (authUser) redirect("/onboarding");

  redirect("/login?next=/w");
}
