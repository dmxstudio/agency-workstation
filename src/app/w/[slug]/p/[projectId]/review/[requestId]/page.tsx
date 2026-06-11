import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, BadgeCheck, MessagesSquare } from "lucide-react";

import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import { getReviewByToken, listReviewRequests, type ReviewPage } from "@/modules/review";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  MonoId,
  PageHeader,
} from "@/ui";

import {
  findRunningDeployment,
  getReleaseSections,
} from "@/app/review/_lib/release-surface";
import { CopyReviewLink } from "../copy-link-button";
import { PageThreads, type InternalComment, type InternalThread } from "./comment-threads";
import { CloseRoundButton } from "./round-controls";

/**
 * Detalle interno de una ronda de revisión (§7.7, §13): la conversación con
 * el cliente página a página — hilos, respuestas del equipo, resolución
 * (cierra la tarea derivada §12.2), aprobaciones del cliente y cierre de la
 * ronda. La cara pública vive en /review/[token].
 */

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function ReviewRoundPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string; requestId: string }>;
}) {
  const { slug, projectId, requestId } = await params;
  const basePath = `/w/${slug}/p/${projectId}`;

  // El proxy solo comprueba la cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`${basePath}/review/${requestId}`)}`);
  }

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  const canEdit = membership.role === "admin" || membership.role === "member";

  const rounds = await listReviewRequests(projectId);
  const summary = rounds.find((round) => round.request.id === requestId);
  if (!summary) notFound();
  const { request } = summary;

  // Misma surface que ve el cliente: páginas del release sellado + hilos.
  const surface = await getReviewByToken(request.token);
  const [deployment, sectionsByPage] = await Promise.all([
    findRunningDeployment(projectId, request.releaseVersion),
    getReleaseSections(projectId, surface.pages),
  ]);

  const sectionLabelById = new Map<string, string>();
  for (const sections of sectionsByPage.values()) {
    for (const section of sections) sectionLabelById.set(section.id, section.label);
  }

  const toInternalComment = (
    comment: (typeof surface.comments)[number],
  ): InternalComment => ({
    id: comment.id,
    sectionId: comment.sectionId,
    sectionLabel: comment.sectionId
      ? (sectionLabelById.get(comment.sectionId) ?? null)
      : null,
    authorKind: comment.authorKind,
    authorName: comment.authorName,
    body: comment.body,
    status: comment.status,
    createdAtLabel: dateFormatter.format(comment.createdAt),
  });

  // Hilos por página: raíz + descendientes aplanados (orden cronológico).
  const childrenByParent = new Map<string, typeof surface.comments>();
  for (const comment of surface.comments) {
    if (!comment.parentId) continue;
    const list = childrenByParent.get(comment.parentId) ?? [];
    list.push(comment);
    childrenByParent.set(comment.parentId, list);
  }
  const collectReplies = (rootId: string): InternalComment[] => {
    const result: InternalComment[] = [];
    const queue = [...(childrenByParent.get(rootId) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      result.push(toInternalComment(next));
      queue.push(...(childrenByParent.get(next.id) ?? []));
    }
    return result;
  };

  const threadsByPage = new Map<string, InternalThread[]>();
  for (const comment of surface.comments) {
    if (comment.parentId) continue;
    const list = threadsByPage.get(comment.pageKey) ?? [];
    list.push({ root: toInternalComment(comment), replies: collectReplies(comment.id) });
    threadsByPage.set(comment.pageKey, list);
  }

  const pagesWithThreads = surface.pages.filter(
    (page) => (threadsByPage.get(page.pageKey) ?? []).length > 0,
  );
  const pageTitleByKey = new Map(surface.pages.map((page) => [page.pageKey, page.title]));

  const openCount = surface.comments.filter((c) => c.status === "open").length;
  const isOpen = request.status === "open";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <Link
        href={`${basePath}/review`}
        className="inline-flex items-center gap-1 self-start text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        <ArrowLeft size={12} strokeWidth={2} aria-hidden />
        Rondas de revisión
      </Link>

      <PageHeader
        eyebrow={project.name}
        title={request.label}
        description={`Ronda sobre el release v${request.releaseVersion} (${surface.release.gitTag}). El cliente revisa el deployment real por iframe y comenta sobre páginas y secciones; resolver un comentario cierra su tarea derivada (§12.2).`}
        actions={
          <>
            <CopyReviewLink token={request.token} size="md" />
            <a
              href={`/review/${request.token}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8.5 items-center gap-1.5 rounded border border-border bg-surface px-3.5 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-raised"
            >
              Vista del cliente
              <ArrowUpRight size={13} strokeWidth={2} aria-hidden />
            </a>
            {isOpen && canEdit ? <CloseRoundButton requestId={request.id} /> : null}
          </>
        }
        meta={
          <>
            {isOpen ? <Badge tone="action">Abierta</Badge> : <Badge>Cerrada</Badge>}
            <Badge tone="neutral">
              <span className="font-mono tabular-nums">v{request.releaseVersion}</span>
            </Badge>
            {deployment ? (
              <Badge tone={deployment.healthy ? "success" : "warning"}>
                {deployment.slot === "preview" ? "Preview activo" : "Producción activa"}
              </Badge>
            ) : (
              <Badge tone="warning">Release sin desplegar</Badge>
            )}
            {openCount > 0 ? (
              <Badge tone="warning">
                {openCount} comentario{openCount === 1 ? "" : "s"} abierto
                {openCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
            <span className="text-xs text-muted">
              Creada el {dateFormatter.format(request.createdAt)}
              {request.closedAt
                ? ` · cerrada el ${dateFormatter.format(request.closedAt)}`
                : ""}
            </span>
            <MonoId id={request.id} />
          </>
        }
      />

      {!deployment ? (
        <Card className="border-accent-warning/40">
          <CardContent className="py-3">
            <p className="text-xs text-muted">
              Ningún slot está sirviendo el release v{request.releaseVersion} ahora mismo:
              el cliente puede comentar, pero no ve la página embebida. Arranca el slot
              preview desde{" "}
              <Link
                href={`${basePath}/deploy`}
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                Deploy
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Aprobaciones del cliente (§8.5: tipo distinto, nunca artefactos) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BadgeCheck size={15} strokeWidth={1.75} className="text-muted" aria-hidden />
            <div>
              <CardTitle>Aprobaciones del cliente</CardTitle>
              <CardDescription>
                Aprueban la versión del release de esta ronda — nunca artefactos internos
                (§8.5). La identidad es el enlace de la ronda + el nombre escrito (R8).
              </CardDescription>
            </div>
          </div>
          <span className="font-mono text-[11px] text-faint tabular-nums">
            {surface.approvals.length}
          </span>
        </CardHeader>
        {surface.approvals.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {surface.approvals.map((approval) => (
              <li key={approval.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5">
                <span className="text-sm font-medium text-foreground">
                  {approval.approvedName}
                </span>
                <Badge tone="success">
                  {approval.pageKey
                    ? (pageTitleByKey.get(approval.pageKey) ?? approval.pageKey)
                    : `Versión ${approval.releaseVersion} completa`}
                </Badge>
                {approval.comment ? (
                  <span className="text-xs text-muted">«{approval.comment}»</span>
                ) : null}
                <span className="ml-auto text-[11px] text-faint">
                  {dateFormatter.format(approval.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <CardContent>
            <p className="text-xs text-muted">
              Aún no hay aprobaciones. El cliente aprueba desde su enlace con el botón
              «Aprobar esta versión».
            </p>
          </CardContent>
        )}
      </Card>

      {/* Conversación por página */}
      {pagesWithThreads.length > 0 ? (
        pagesWithThreads.map((page: ReviewPage) => (
          <Card key={page.pageKey}>
            <CardHeader>
              <div>
                <CardTitle>{page.title}</CardTitle>
                <CardDescription>
                  <code className="font-mono text-[11px]">{page.path}</code>
                  <span className="ml-2 font-mono text-[11px] text-faint">
                    composición v{page.compositionVersion}
                  </span>
                </CardDescription>
              </div>
              <span className="font-mono text-[11px] text-faint tabular-nums">
                {(threadsByPage.get(page.pageKey) ?? []).length} hilo
                {(threadsByPage.get(page.pageKey) ?? []).length === 1 ? "" : "s"}
              </span>
            </CardHeader>
            <CardContent>
              <PageThreads
                requestId={request.id}
                pageKey={page.pageKey}
                threads={threadsByPage.get(page.pageKey) ?? []}
                canEdit={canEdit}
                roundOpen={isOpen}
              />
            </CardContent>
          </Card>
        ))
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={<MessagesSquare size={20} strokeWidth={1.5} aria-hidden />}
              title="Sin comentarios todavía"
              description="Cuando el cliente comente desde su enlace, los hilos aparecerán aquí agrupados por página, con su sección anclada cuando la tenga."
            />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
