import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { getPhaseLabel, isArtifactDomainError } from "@/modules/artifacts";
import {
  computeDiff,
  getArtifactWithHistory,
  getProjectArtifacts,
} from "@/modules/artifacts/service";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import { getOpenOutdatedTask, getUserNameById } from "@/modules/spec-os/queries";
import { MonoId, PageHeader, StatusPill } from "@/ui";

import {
  ArtifactEditor,
  type EditorArtifact,
} from "./artifact-editor";
import type { ApprovalListItem, VersionListItem } from "./history-panel";

/**
 * Editor de artefacto de Spec OS (§19.6-b): header con identidad y estado,
 * banners de flags transversales (§8.2), y editor client con tabs
 * Editar / Diff / Historial sobre las server actions del módulo artifacts.
 */

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string; artifactId: string }>;
}) {
  const { slug, projectId, artifactId } = await params;
  const path = `/w/${slug}/p/${projectId}/artifacts/${artifactId}`;

  // El proxy solo comprueba la cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  let history;
  try {
    history = await getArtifactWithHistory(artifactId);
  } catch (error) {
    if (isArtifactDomainError(error) && error.code === "ARTIFACT_NOT_FOUND") notFound();
    throw error;
  }
  const { artifact, definition } = history;
  if (artifact.projectId !== project.id) notFound();

  const [diff, projectArtifacts, outdatedTask, ownerName] = await Promise.all([
    computeDiff(artifactId),
    getProjectArtifacts(project.id),
    artifact.outdated ? getOpenOutdatedTask(project.id, artifactId) : Promise.resolve(null),
    getUserNameById(artifact.ownerId),
  ]);

  // Dependencias upstream (§8.4) para el banner de outdated.
  const byId = new Map(projectArtifacts.map((item) => [item.artifact.id, item]));
  const self = byId.get(artifactId);
  const upstream = (self?.dependsOnIds ?? [])
    .map((id) => byId.get(id))
    .filter((item): item is NonNullable<typeof item> => item != null);

  const sealedPayload =
    history.versions.find((version) => version.version === artifact.currentVersion)?.payload ??
    null;

  const editorArtifact: EditorArtifact = {
    id: artifact.id,
    type: artifact.type,
    label: definition?.label ?? artifact.type,
    status: artifact.status,
    outdated: artifact.outdated,
    rejected: artifact.rejected,
    currentVersion: artifact.currentVersion,
    lockedBy: artifact.lockedBy,
    hasDraft: artifact.draftPayload != null,
  };

  const versionItems: VersionListItem[] = history.versions.map((version) => ({
    id: version.id,
    version: version.version,
    origin: version.origin,
    agentRunId: version.agentRunId,
    authorName: version.author?.name ?? null,
    createdAtLabel: dateFormatter.format(version.createdAt),
  }));

  const approvalItems: ApprovalListItem[] = history.approvals.map((approval) => ({
    id: approval.id,
    version: approval.version,
    approverName: approval.approver.name,
    comment: approval.comment,
    createdAtLabel: dateFormatter.format(approval.createdAt),
  }));

  const canEdit = membership.role === "admin" || membership.role === "member";
  const cockpitHref = `/w/${slug}/p/${projectId}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-6">
      <div>
        <Link
          href={cockpitHref}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={12} aria-hidden />
          Volver al cockpit
        </Link>
      </div>

      <PageHeader
        eyebrow={`Spec OS · ${artifact.type}`}
        title={definition?.label ?? artifact.type}
        description={definition?.description}
        meta={
          <>
            <StatusPill
              status={artifact.status}
              outdated={artifact.outdated}
              rejected={artifact.rejected}
            />
            <MonoId id={artifact.id} />
            <span className="font-mono text-xs text-muted tabular-nums">
              {artifact.currentVersion > 0
                ? `v${artifact.currentVersion}`
                : "v0 · sin versión aprobada"}
            </span>
            <span className="text-xs text-muted">
              Owner: <span className="text-foreground">{ownerName ?? "sin asignar"}</span>
            </span>
            {definition ? (
              <span className="text-xs text-faint">Fase: {getPhaseLabel(definition.phase)}</span>
            ) : null}
            {artifact.lockedBy ? (
              <span className="font-mono text-xs text-muted">lock: {artifact.lockedBy}</span>
            ) : null}
          </>
        }
      />

      {artifact.outdated ? (
        <div className="rounded-md border border-accent-warning/40 bg-accent-warning/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-accent-warning">
            <TriangleAlert size={14} aria-hidden />
            Una dependencia cambió — revisa y revalida o actualiza.
          </p>
          {outdatedTask ? (
            <p className="mt-1 text-xs text-muted">{outdatedTask.title}</p>
          ) : null}
          {upstream.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {upstream.map((item) => (
                <li key={item.artifact.id} className="text-xs text-muted">
                  <Link
                    href={`/w/${slug}/p/${projectId}/artifacts/${item.artifact.id}`}
                    className="text-foreground underline-offset-2 hover:underline"
                  >
                    {item.label}
                  </Link>{" "}
                  <span className="font-mono tabular-nums">v{item.artifact.currentVersion}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {artifact.rejected ? (
        <div className="rounded-md border border-accent-danger/40 bg-accent-danger/10 px-3 py-2.5">
          <p className="text-sm font-medium text-accent-danger">
            La última revisión fue rechazada.
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Corrige el borrador con el feedback registrado en la actividad del proyecto y vuelve
            a enviarlo a revisión.
          </p>
        </div>
      ) : null}

      <ArtifactEditor
        artifact={editorArtifact}
        initialPayload={artifact.draftPayload ?? sealedPayload}
        canEdit={canEdit}
        initialDiff={diff}
        versions={versionItems}
        approvals={approvalItems}
      />
    </main>
  );
}
