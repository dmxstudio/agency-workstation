import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FolderOpen, LogOut, Settings } from "lucide-react";

import { PROJECT_PHASES } from "@/modules/artifacts";
import { getProjectArtifacts } from "@/modules/artifacts/service";
import { signOutAction } from "@/modules/platform-core/actions";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { listProjects } from "@/modules/platform-core/projects";
import {
  getWorkspaceBySlug,
  listWorkspacesForUser,
} from "@/modules/platform-core/workspaces";
import type { WorkspaceRole } from "@/db/schema";
import {
  Badge,
  Button,
  EmptyState,
  MonoId,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui";

import { CreateProjectModal } from "@/app/_components/create-project-modal";
import { ThemeToggle } from "@/app/_components/theme-toggle";

export const metadata: Metadata = { title: "Proyectos" };

const dateFormatter = new Intl.DateTimeFormat("es", { dateStyle: "medium" });

const roleLabels: Record<WorkspaceRole, string> = {
  admin: "Admin",
  member: "Miembro",
  client: "Cliente",
};

function phaseLabelOf(phaseKey: string): string {
  return PROJECT_PHASES.find((phase) => phase.key === phaseKey)?.label ?? phaseKey;
}

/** Resumen barato de artefactos por proyecto para la tabla densa. */
type ArtifactSummary = {
  total: number;
  approved: number; // approved | locked
  inReview: number;
  outdated: number;
};

export default async function WorkspaceHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // El layout ya valida, pero las pages repiten el check (defensa en
  // profundidad: los layouts no se re-ejecutan en navegación client-side).
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/w/${slug}`)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();
  const { workspace, role } = membership;

  const [projects, memberships] = await Promise.all([
    listProjects(workspace.id),
    listWorkspacesForUser(user.id),
  ]);

  const summaries = await Promise.all(
    projects.map(async (project): Promise<ArtifactSummary> => {
      const items = await getProjectArtifacts(project.id);
      return {
        total: items.length,
        approved: items.filter(
          (item) =>
            item.artifact.status === "approved" || item.artifact.status === "locked",
        ).length,
        inReview: items.filter((item) => item.artifact.status === "in_review").length,
        outdated: items.filter((item) => item.artifact.outdated).length,
      };
    }),
  );

  const otherWorkspaces = memberships.filter(
    (entry) => entry.workspace.id !== workspace.id,
  );
  const isInternal = role === "admin" || role === "member";

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar del workspace */}
      <header className="flex items-center justify-between gap-4 border-b bg-surface px-6 py-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link
            href="/w"
            className="font-mono text-[11px] tracking-widest text-faint uppercase transition-colors hover:text-foreground"
          >
            Agency Workstation
          </Link>
          <span className="text-faint" aria-hidden>
            /
          </span>
          <span className="truncate text-sm font-medium">{workspace.name}</span>
          <Badge>{roleLabels[role]}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted sm:inline">{user.name}</span>
          {role !== "client" ? (
            <Link
              href={`/w/${slug}/settings`}
              className="inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <Settings size={13} strokeWidth={1.75} aria-hidden />
              Ajustes
            </Link>
          ) : null}
          <ThemeToggle />
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm" title="Cerrar sesión">
              <LogOut size={13} strokeWidth={1.75} aria-hidden />
              Salir
            </Button>
          </form>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        <PageHeader
          eyebrow="Workspace"
          title={workspace.name}
          description="Proyectos del workspace: cada uno con sus 8 artefactos versionados y gates de fase."
          meta={
            <>
              <MonoId id={workspace.id} />
              <span className="font-mono text-xs text-muted">/w/{workspace.slug}</span>
            </>
          }
          actions={
            isInternal && projects.length > 0 ? (
              <CreateProjectModal workspaceSlug={workspace.slug} />
            ) : undefined
          }
        />

        {projects.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={20} strokeWidth={1.5} aria-hidden />}
            title="Sin proyectos todavía"
            description={
              isInternal
                ? "Crea el primer proyecto: nace con sus 8 artefactos vacíos y el grafo de dependencias instanciado."
                : "Aún no hay proyectos en este workspace."
            }
            action={
              isInternal ? <CreateProjectModal workspaceSlug={workspace.slug} /> : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Fase</TableHead>
                <TableHead>Artefactos</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creado</TableHead>
                <TableHead>ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project, index) => {
                const summary = summaries[index];
                return (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Link
                        href={`/w/${workspace.slug}/p/${project.id}`}
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {project.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted">
                      {phaseLabelOf(project.currentPhase)}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs tabular-nums">
                        {summary.approved}/{summary.total}
                      </span>{" "}
                      <span className="text-xs text-faint">aprobados</span>
                      {summary.inReview > 0 ? (
                        <span className="ml-2 font-mono text-xs text-accent-action tabular-nums">
                          {summary.inReview} en revisión
                        </span>
                      ) : null}
                      {summary.outdated > 0 ? (
                        <span className="ml-2 font-mono text-xs text-accent-warning tabular-nums">
                          {summary.outdated} desactualizados
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge tone={project.status === "active" ? "success" : "neutral"}>
                        {project.status === "active" ? "Activo" : "Archivado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted">
                      {dateFormatter.format(project.createdAt)}
                    </TableCell>
                    <TableCell>
                      <MonoId id={project.id} truncate={10} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {otherWorkspaces.length > 0 ? (
          <p className="text-xs text-muted">
            Tus otros workspaces:{" "}
            {otherWorkspaces.map((entry, index) => (
              <span key={entry.workspace.id}>
                {index > 0 ? " · " : null}
                <Link
                  href={`/w/${entry.workspace.slug}`}
                  className="text-accent-action underline-offset-2 hover:underline"
                >
                  {entry.workspace.name}
                </Link>
              </span>
            ))}
            {" · "}
            <Link
              href="/onboarding"
              className="text-accent-action underline-offset-2 hover:underline"
            >
              Crear otro
            </Link>
          </p>
        ) : (
          <p className="text-xs text-faint">
            ¿Necesitas otro workspace?{" "}
            <Link
              href="/onboarding"
              className="text-accent-action underline-offset-2 hover:underline"
            >
              Créalo aquí
            </Link>
            .
          </p>
        )}
      </main>
    </div>
  );
}
