import { notFound, redirect } from "next/navigation";
import { Shapes } from "lucide-react";

import { AssistantLauncher } from "@/modules/agents/assistant";
import { PROJECT_PHASES, getPhaseLabel, type ProjectPhaseKey } from "@/modules/artifacts";
import { getPhaseGates } from "@/modules/artifacts/service";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectActivity } from "@/modules/platform-core/audit";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  MonoId,
  PageHeader,
} from "@/ui";

import { initProjectArtifactsAction } from "./_components/actions";
import { ActivityFeed } from "./_components/ActivityFeed";
import { ArtifactsByPhase } from "./_components/ArtifactsByPhase";
import { PhaseStepper } from "./_components/PhaseStepper";
import { getOpenProjectTasks, getWorkspaceMembers } from "./_components/queries";
import { formatRelativeTimeEs } from "./_components/relative-time";
import {
  TasksPanel,
  type AssigneeOption,
  type CockpitTask,
} from "./_components/TasksPanel";

/**
 * Project Cockpit (§7.1, §19.6-a): fases con gates (§8.5), lista de artefactos
 * con estados y flags (§8.2), activity feed y tareas abiertas (§12.2). Es la
 * pantalla de inicio de cada proyecto.
 */

export default async function ProjectCockpitPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId } = await params;
  const path = `/w/${slug}/p/${projectId}`;

  // El proxy solo comprueba la presencia de cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  const [gates, activity, openTasks, members] = await Promise.all([
    getPhaseGates(project.id),
    getProjectActivity(project.id, 30),
    getOpenProjectTasks(project.id),
    getWorkspaceMembers(membership.workspace.id),
  ]);

  const canEdit = membership.role === "admin" || membership.role === "member";
  const artifactBaseHref = `${path}/artifacts`;

  // projects.currentPhase nace como "spec" (no es un ProjectPhaseKey válido y
  // ningún flujo lo avanza aún): si no es una fase del grafo, se infiere la
  // fase de trabajo como la primera con artefactos obligatorios pendientes.
  const validPhase: ProjectPhaseKey | null = PROJECT_PHASES.some(
    (phase) => phase.key === project.currentPhase,
  )
    ? (project.currentPhase as ProjectPhaseKey)
    : null;
  const activePhase: ProjectPhaseKey | null =
    validPhase ?? gates.find((gate) => gate.pendingTypes.length > 0)?.phase ?? null;

  const artifactCount = gates.reduce((sum, gate) => sum + gate.artifacts.length, 0);
  const approvedTotal = gates.reduce((sum, gate) => sum + gate.approvedCount, 0);
  const requiredTotal = gates.reduce((sum, gate) => sum + gate.requiredCount, 0);
  const outdatedTotal = gates.reduce(
    (sum, gate) => sum + gate.artifacts.filter((item) => item.artifact.outdated).length,
    0,
  );

  const ownerNames = new Map(members.map(({ user: member }) => [member.id, member.name]));
  const assignees: AssigneeOption[] = members.map(({ user: member }) => ({
    id: member.id,
    name: member.name,
  }));

  const now = new Date();
  const taskViews: CockpitTask[] = openTasks.map((task) => ({
    id: task.id,
    kind: task.kind,
    derivedKind:
      task.kind === "derived"
        ? task.dedupeKey?.startsWith("outdated:")
          ? "outdated"
          : "review"
        : null,
    title: task.title,
    assigneeName: task.assignee?.name ?? null,
    artifactHref: task.artifactId ? `${artifactBaseHref}/${task.artifactId}` : null,
    createdAtLabel: formatRelativeTimeEs(task.createdAt, now),
  }));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <PageHeader
        eyebrow={membership.workspace.name}
        title={project.name}
        actions={<AssistantLauncher surface="cockpit" slug={slug} projectId={project.id} />}
        meta={
          <>
            <Badge tone={project.status === "archived" ? "warning" : "neutral"}>
              {project.status === "archived" ? "Archivado" : "Activo"}
            </Badge>
            <MonoId id={project.id} />
            {activePhase ? (
              <span className="text-xs text-muted">
                Fase actual:{" "}
                <span className="text-foreground">{getPhaseLabel(activePhase)}</span>
              </span>
            ) : null}
            <span className="font-mono text-xs text-muted tabular-nums">
              {approvedTotal}/{requiredTotal} aprobados
            </span>
            {outdatedTotal > 0 ? (
              <span className="font-mono text-xs text-accent-warning tabular-nums">
                {outdatedTotal} desactualizado{outdatedTotal === 1 ? "" : "s"}
              </span>
            ) : null}
          </>
        }
      />

      {artifactCount === 0 ? (
        <EmptyState
          icon={<Shapes size={24} strokeWidth={1.5} aria-hidden />}
          title="Este proyecto no tiene artefactos instanciados"
          description="Cada proyecto trabaja sobre 8 artefactos tipados con su grafo de dependencias. Instáncialos para empezar con la spec."
          action={
            canEdit ? (
              <form action={initProjectArtifactsAction.bind(null, project.id)}>
                <Button type="submit" variant="primary" size="sm">
                  Instanciar artefactos
                </Button>
              </form>
            ) : undefined
          }
          className="py-16"
        />
      ) : (
        <>
          <PhaseStepper gates={gates} activePhase={activePhase} />

          <div className="grid items-start gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Artefactos</CardTitle>
                <span className="font-mono text-[11px] text-faint tabular-nums">
                  {artifactCount} artefactos · 8 fases
                </span>
              </CardHeader>
              <CardContent className="p-0">
                <ArtifactsByPhase
                  gates={gates}
                  artifactBaseHref={artifactBaseHref}
                  ownerNames={ownerNames}
                />
              </CardContent>
            </Card>

            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Tareas abiertas</CardTitle>
                  <Badge tone={taskViews.length > 0 ? "action" : "neutral"}>
                    {taskViews.length}
                  </Badge>
                </CardHeader>
                <CardContent className="px-4 py-2">
                  <TasksPanel
                    projectId={project.id}
                    tasks={taskViews}
                    assignees={assignees}
                    canEdit={canEdit}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Actividad</CardTitle>
                  <span className="font-mono text-[11px] text-faint tabular-nums">
                    últimos {activity.length}
                  </span>
                </CardHeader>
                <CardContent className="px-4 py-1">
                  <ActivityFeed
                    events={activity}
                    artifactBaseHref={artifactBaseHref}
                    runsBaseHref={`${path}/runs`}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
