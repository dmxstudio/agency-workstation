import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, MessagesSquare, Rocket } from "lucide-react";

import {
  getArtifactWithHistory,
  getProjectArtifacts,
  releasePayloadSchema,
} from "@/modules/artifacts";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import { listReviewRequests } from "@/modules/review";
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui";

import { getRunningSlotsByRelease } from "@/app/review/_lib/release-surface";
import { formatRelativeTimeEs } from "../_components/relative-time";
import { CopyReviewLink } from "./copy-link-button";
import { CreateRoundControl, type ReleaseOption } from "./create-round";

/**
 * Cara INTERNA del Client Review (§7.7, §13): rondas de revisión del
 * proyecto, cada una con su enlace de cliente (token), contadores de
 * conversación y aprobaciones. La revisión de cliente es sobre RESULTADOS
 * (releases desplegados); esta pantalla gobierna esa conversación.
 */

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function ReviewListPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId } = await params;
  const basePath = `/w/${slug}/p/${projectId}`;

  // El proxy solo comprueba la cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`${basePath}/review`)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  const canEdit = membership.role === "admin" || membership.role === "member";

  const [rounds, items, runningSlots] = await Promise.all([
    listReviewRequests(projectId),
    getProjectArtifacts(projectId),
    getRunningSlotsByRelease(projectId),
  ]);

  // Releases = versiones SELLADAS del artefacto singleton `release` (§7.8).
  const releaseItem = items.find(
    (item) => item.artifact.type === "release" && item.artifact.key == null,
  );
  let releases: ReleaseOption[] = [];
  if (releaseItem && releaseItem.artifact.currentVersion > 0) {
    const history = await getArtifactWithHistory(releaseItem.artifact.id);
    releases = history.versions.flatMap((version) => {
      const parsed = releasePayloadSchema.safeParse(version.payload);
      if (!parsed.success) return []; // release legado: no se ofrece para rondas
      return [
        {
          number: version.version,
          notes: parsed.data.notes,
          pageCount: Object.keys(parsed.data.versions.compositions).length,
          createdAtLabel: dateFormatter.format(version.createdAt),
          runningSlots: runningSlots.get(version.version) ?? [],
        },
      ];
    });
  }

  const now = new Date();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <PageHeader
        eyebrow={project.name}
        title="Review"
        description="Rondas de revisión de cliente sobre releases desplegados (§7.7): el cliente entra por un enlace con token, comenta sobre páginas y secciones y aprueba la versión — nunca ve artefactos internos (§13)."
        actions={
          <CreateRoundControl
            projectId={projectId}
            basePath={basePath}
            releases={releases}
            canCreate={canEdit}
          />
        }
        meta={
          releases.length > 0 ? (
            <Badge tone="neutral">
              {releases.length} release{releases.length === 1 ? "" : "s"} disponible
              {releases.length === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge tone="warning">Sin releases sellados</Badge>
          )
        }
      />

      {releases.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Rocket size={20} strokeWidth={1.5} aria-hidden />}
              title="Todavía no hay releases"
              description="Una ronda de revisión siempre apunta a un release sellado. Crea el primero desde Deploy (checklist §7.8 + confirmación humana) y vuelve aquí para compartirlo con el cliente."
              action={
                <Link
                  href={`${basePath}/deploy`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  Ir a Deploy
                  <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        {rounds.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ronda</TableHead>
                <TableHead>Release</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Comentarios</TableHead>
                <TableHead>Aprobaciones</TableHead>
                <TableHead>Enlace del cliente</TableHead>
                <TableHead>Creada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rounds.map(({ request, commentCount, openCommentCount, approvalCount }) => (
                <TableRow key={request.id}>
                  <TableCell>
                    <Link
                      href={`${basePath}/review/${request.id}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {request.label}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs tabular-nums">
                      v{request.releaseVersion}
                    </span>
                  </TableCell>
                  <TableCell>
                    {request.status === "open" ? (
                      <Badge tone="action">Abierta</Badge>
                    ) : (
                      <Badge>Cerrada</Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {commentCount === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span
                        title={`${openCommentCount} abiertos · ${commentCount - openCommentCount} resueltos`}
                      >
                        {openCommentCount > 0 ? (
                          <span className="font-medium text-accent-warning">
                            {openCommentCount} abiertos
                          </span>
                        ) : (
                          <span className="text-accent-success">todo resuelto</span>
                        )}
                        <span className="text-faint"> / {commentCount}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {approvalCount > 0 ? (
                      <span className="font-medium text-accent-success">{approvalCount}</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <CopyReviewLink token={request.token} />
                      <a
                        href={`/review/${request.token}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
                        title="Abrir la vista del cliente en otra pestaña"
                      >
                        Abrir
                        <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell
                    className="whitespace-nowrap text-muted"
                    title={dateFormatter.format(request.createdAt)}
                  >
                    {formatRelativeTimeEs(request.createdAt, now)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <CardContent>
            <EmptyState
              icon={<MessagesSquare size={20} strokeWidth={1.5} aria-hidden />}
              title="Sin rondas de revisión"
              description={
                releases.length > 0
                  ? "Crea la primera ronda para compartir un enlace con el cliente: comentará sobre el deployment real y aprobará la versión con su nombre."
                  : "Cuando exista un release sellado podrás abrir aquí la primera ronda con el cliente."
              }
            />
          </CardContent>
        )}
      </Card>
    </main>
  );
}
