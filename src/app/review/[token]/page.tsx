import { cache } from "react";
import type { Metadata } from "next";
import { Link2Off } from "lucide-react";

import { getReviewByToken, isReviewDomainError } from "@/modules/review";

import {
  findRunningDeployment,
  getReleaseSections,
} from "../_lib/release-surface";
import {
  ReviewClient,
  type PublicApproval,
  type PublicComment,
  type PublicPage,
} from "./review-client";

/**
 * Superficie PÚBLICA de revisión de cliente (§7.7, §13, R8): acceso por link
 * con token, sin cuenta ni sesión. El cliente ve RESULTADOS — el deployment
 * real del release embebido por iframe (§16) — y conversa sobre páginas y
 * secciones con títulos humanos. Ningún artefacto interno ni nombre de tipo
 * cruza esta frontera.
 *
 * El token es la credencial completa: cada lectura/mutación lo valida contra
 * la DB (módulo review). Rondas cerradas quedan en solo lectura.
 */

// Una llamada por request aunque metadata y página pidan la misma surface.
const loadSurface = cache(getReviewByToken);

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  try {
    const surface = await loadSurface(token);
    return {
      title: `Revisión — ${surface.project.name}`,
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: "Revisión", robots: { index: false, follow: false } };
  }
}

function InvalidLink() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <Link2Off size={26} strokeWidth={1.5} className="text-faint" aria-hidden />
      <h1 className="text-lg font-semibold tracking-tight text-foreground">
        Este enlace de revisión no es válido
      </h1>
      <p className="max-w-md text-sm text-muted">
        El enlace puede haber caducado o estar incompleto. Pide a tu agencia un
        enlace nuevo para seguir revisando el proyecto.
      </p>
    </main>
  );
}

export default async function PublicReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let surface;
  try {
    surface = await loadSurface(token);
  } catch (error) {
    if (isReviewDomainError(error)) return <InvalidLink />;
    throw error;
  }

  // Deployment real del release (preferencia preview) + secciones selladas.
  const [deployment, sectionsByPage] = await Promise.all([
    findRunningDeployment(surface.project.id, surface.request.releaseVersion),
    getReleaseSections(surface.project.id, surface.pages),
  ]);

  const pages: PublicPage[] = surface.pages.map((page) => ({
    pageKey: page.pageKey,
    path: page.path,
    title: page.title,
    sections: sectionsByPage.get(page.pageKey) ?? [],
  }));

  const comments: PublicComment[] = surface.comments.map((comment) => ({
    id: comment.id,
    pageKey: comment.pageKey,
    sectionId: comment.sectionId,
    parentId: comment.parentId,
    authorKind: comment.authorKind,
    authorName: comment.authorName,
    body: comment.body,
    status: comment.status,
    createdAtLabel: dateFormatter.format(comment.createdAt),
  }));

  const approvals: PublicApproval[] = surface.approvals.map((approval) => ({
    id: approval.id,
    pageKey: approval.pageKey,
    approvedName: approval.approvedName,
    comment: approval.comment,
    createdAtLabel: dateFormatter.format(approval.createdAt),
  }));

  return (
    <ReviewClient
      token={token}
      projectName={surface.project.name}
      round={{
        label: surface.request.label,
        status: surface.request.status,
        releaseNumber: surface.release.releaseNumber,
        createdAtLabel: dateFormatter.format(surface.request.createdAt),
        closedAtLabel: surface.request.closedAt
          ? dateFormatter.format(surface.request.closedAt)
          : null,
      }}
      deployment={deployment ? { slot: deployment.slot, url: deployment.url } : null}
      pages={pages}
      comments={comments}
      approvals={approvals}
    />
  );
}
