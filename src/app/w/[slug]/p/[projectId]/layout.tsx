import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  Database,
  FolderGit2,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Palette,
  Rocket,
} from "lucide-react";

import { PROJECT_PHASES, type ArtifactTypeKey } from "@/modules/artifacts";
import {
  getProjectArtifacts,
  type ProjectArtifact,
} from "@/modules/artifacts/service";
import { signOutAction } from "@/modules/platform-core/actions";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import { Button, cn } from "@/ui";

import { NavLink } from "@/app/_components/nav-link";
import { ThemeToggle } from "@/app/_components/theme-toggle";

/**
 * Layout de proyecto con navegación lateral (§11.4): workspace arriba,
 * Cockpit + artefactos de Spec OS en medio, módulos activos (§14) y
 * usuario + sesión + tema abajo.
 */

/** Tipos cuya edición vive en Spec OS (las 6 secciones de la spec, §7.2). */
const SPEC_OS_TYPES: readonly ArtifactTypeKey[] = [
  "spec.intake",
  "spec.strategy",
  "spec.sitemap",
  "content.page",
  "cms.collections",
  "design.tokens",
];

const STATUS_LABELS: Record<string, string> = {
  empty: "Vacío",
  draft: "Borrador",
  in_review: "En revisión",
  approved: "Aprobado",
  locked: "Bloqueado",
};

/** Color del dot de estado en la nav, consistente con StatusPill. */
function statusDotClass(item: ProjectArtifact): string {
  if (item.artifact.rejected) return "bg-accent-danger";
  if (item.artifact.outdated) return "bg-accent-warning";
  switch (item.artifact.status) {
    case "in_review":
      return "bg-accent-action";
    case "approved":
      return "bg-accent-success";
    case "locked":
      return "bg-foreground";
    case "draft":
      return "bg-muted";
    default:
      return "bg-faint/60";
  }
}

function statusTitle(item: ProjectArtifact): string {
  const parts = [STATUS_LABELS[item.artifact.status] ?? item.artifact.status];
  if (item.artifact.outdated) parts.push("Desactualizado");
  if (item.artifact.rejected) parts.push("Rechazado");
  return parts.join(" · ");
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pt-4 pb-1 font-mono text-[10px] tracking-widest text-faint uppercase">
      {children}
    </p>
  );
}

const navItemClass =
  "flex items-center gap-2 rounded px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-surface-raised hover:text-foreground";
const navItemActiveClass = "bg-surface-raised font-medium text-foreground";

/** Módulos activos (§14): Studio (§7.4), CMS (§7.6), Review (§7.7) y Deploy (§7.8). */
const activeModules = [
  { label: "Studio", segment: "studio", icon: Palette },
  { label: "CMS", segment: "cms", icon: Database },
  { label: "Review", segment: "review", icon: MessageSquareText },
  { label: "Deploy", segment: "deploy", icon: Rocket },
] as const;

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId } = await params;
  const basePath = `/w/${slug}/p/${projectId}`;

  // Validación de sesión real en cada segmento (el proxy solo mira la cookie).
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(basePath)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  const artifacts = await getProjectArtifacts(projectId);
  const specArtifacts = SPEC_OS_TYPES.map((type) =>
    artifacts.find((item) => item.artifact.type === type),
  ).filter((item): item is ProjectArtifact => item != null);

  const phaseLabel =
    PROJECT_PHASES.find((phase) => phase.key === project.currentPhase)?.label ??
    project.currentPhase;

  return (
    <div className="flex min-h-dvh w-full">
      <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col border-r bg-surface">
        {/* Workspace arriba */}
        <div className="border-b px-4 py-3">
          <Link
            href="/w"
            className="font-mono text-[10px] tracking-widest text-faint uppercase transition-colors hover:text-foreground"
          >
            Agency Workstation
          </Link>
          <Link
            href={`/w/${slug}`}
            className="mt-1 block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
            title={membership.workspace.name}
          >
            {membership.workspace.name}
          </Link>
        </div>

        {/* Identidad del proyecto */}
        <div className="border-b px-4 py-3">
          <p className="truncate text-[13px] font-medium" title={project.name}>
            {project.name}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Fase: <span className="text-foreground">{phaseLabel}</span>
          </p>
        </div>

        {/* Navegación */}
        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Proyecto">
          <SectionLabel>Proyecto</SectionLabel>
          <NavLink
            href={basePath}
            exact
            className={navItemClass}
            activeClassName={navItemActiveClass}
          >
            <LayoutDashboard size={14} strokeWidth={1.75} aria-hidden />
            Cockpit
          </NavLink>
          <NavLink
            href={`${basePath}/generator`}
            className={navItemClass}
            activeClassName={navItemActiveClass}
          >
            <FolderGit2 size={14} strokeWidth={1.75} aria-hidden />
            Generator
          </NavLink>

          <SectionLabel>Spec OS</SectionLabel>
          <ul className="flex flex-col">
            {specArtifacts.map((item) => (
              <li key={item.artifact.id}>
                <NavLink
                  href={`${basePath}/artifacts/${item.artifact.id}`}
                  className={navItemClass}
                  activeClassName={navItemActiveClass}
                >
                  <span
                    className={cn("size-1.5 shrink-0 rounded-full", statusDotClass(item))}
                    title={statusTitle(item)}
                    aria-hidden
                  />
                  <span className="truncate">{item.label}</span>
                  {item.artifact.currentVersion > 0 ? (
                    <span className="ml-auto font-mono text-[10px] text-faint tabular-nums">
                      v{item.artifact.currentVersion}
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="mx-2 mt-4 border-t" role="separator" />

          <SectionLabel>Módulos</SectionLabel>
          <ul className="flex flex-col">
            {activeModules.map(({ label, segment, icon: Icon }) => (
              <li key={label}>
                <NavLink
                  href={`${basePath}/${segment}`}
                  className={navItemClass}
                  activeClassName={navItemActiveClass}
                >
                  <Icon size={14} strokeWidth={1.75} aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Usuario + sesión + tema abajo */}
        <div className="flex items-center gap-2 border-t px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium" title={user.name}>
              {user.name}
            </p>
            <p className="truncate font-mono text-[10px] text-faint" title={user.email}>
              {user.email}
            </p>
          </div>
          <ThemeToggle />
          <form action={signOutAction}>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="px-1.5"
            >
              <LogOut size={13} strokeWidth={1.75} aria-hidden />
            </Button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
