import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";

/**
 * Guard del segmento /w/[slug]: sesión real + membership del workspace
 * (el proxy solo comprueba presencia de cookie). Sin chrome propio — la
 * home de workspace y el layout de proyecto pintan su propia estructura.
 *
 * Nota Next 16: un layout no se re-ejecuta en cada navegación client-side
 * dentro de su segmento, así que las pages anidadas repiten esta validación
 * (defensa en profundidad, doc oficial de authentication).
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/w/${slug}`)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  return <>{children}</>;
}
