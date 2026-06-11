import Link from "next/link";
import type { ReactNode } from "react";
import {
  Archive,
  BadgeCheck,
  FilePen,
  FolderPlus,
  GitCommitHorizontal,
  History,
  ListPlus,
  ListChecks,
  Lock,
  LockOpen,
  RotateCcw,
  Send,
  Shapes,
  XCircle,
} from "lucide-react";

import { getArtifactTypeOrNull } from "@/modules/artifacts";
import type { ActivityEvent } from "@/modules/platform-core/audit";
import { ActivityItem, EmptyState } from "@/ui";

import { formatRelativeTimeEs } from "./relative-time";

interface ActivityFeedProps {
  events: ActivityEvent[];
  /** Base del editor: `/w/[slug]/p/[projectId]/artifacts` (sin slash final). */
  artifactBaseHref: string;
}

// --- helpers de extracción segura sobre `detail: unknown` ---------------------

function field(detail: unknown, key: string): unknown {
  if (detail !== null && typeof detail === "object" && key in detail) {
    return (detail as Record<string, unknown>)[key];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function typeLabel(typeKey: string | null): string | null {
  if (!typeKey) return null;
  return getArtifactTypeOrNull(typeKey)?.label ?? typeKey;
}

// --- presentación por evento --------------------------------------------------

interface EventView {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  variant: "default" | "agent";
}

function actorNode(event: ActivityEvent): ReactNode {
  return (
    <span className="font-medium">{event.actorName ?? "Sistema"}</span>
  );
}

function artifactNode(
  event: ActivityEvent,
  artifactBaseHref: string,
): ReactNode {
  // approval/version llevan artifactId+artifactType en detail; los audits de
  // artefacto llevan entityType "artifact" + detail.type.
  const artifactId =
    asString(field(event.detail, "artifactId")) ??
    (event.entityType === "artifact" ? event.entityId : null);
  const label =
    typeLabel(
      asString(field(event.detail, "artifactType")) ??
        asString(field(event.detail, "type")),
    ) ?? "artefacto";

  if (!artifactId) return <span className="font-medium">{label}</span>;
  return (
    <Link
      href={`${artifactBaseHref}/${artifactId}`}
      className="font-medium underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
}

function versionNode(event: ActivityEvent): ReactNode {
  const version = asNumber(field(event.detail, "version"));
  if (version == null) return null;
  return (
    <>
      {" "}
      <span className="font-mono text-xs tabular-nums">v{version}</span>
    </>
  );
}

function buildView(event: ActivityEvent, artifactBaseHref: string): EventView {
  const actor = actorNode(event);
  const artifact = artifactNode(event, artifactBaseHref);
  const version = versionNode(event);

  switch (event.action) {
    case "artifact.approved": {
      const comment = asString(field(event.detail, "comment"));
      return {
        icon: <BadgeCheck size={14} strokeWidth={2} className="text-accent-success" aria-hidden />,
        title: (
          <>
            {actor} aprobó {artifact}
            {version}
          </>
        ),
        description: comment ? <>«{comment}»</> : undefined,
        variant: "default",
      };
    }
    case "artifact.version_created": {
      const origin = asString(field(event.detail, "origin"));
      const isAgent = origin === "agent_run";
      const agentRunId = asString(field(event.detail, "agentRunId"));
      return {
        icon: <GitCommitHorizontal size={14} strokeWidth={2} aria-hidden />,
        title: (
          <>
            {actor} selló la versión{version} de {artifact}
          </>
        ),
        description:
          isAgent && agentRunId ? (
            <span className="font-mono">{agentRunId}</span>
          ) : undefined,
        variant: isAgent ? "agent" : "default",
      };
    }
    case "artifact.draft_saved":
      return {
        icon: <FilePen size={14} strokeWidth={2} aria-hidden />,
        title: (
          <>
            {actor} guardó un borrador de {artifact}
          </>
        ),
        variant: "default",
      };
    case "artifact.submitted_for_review":
      return {
        icon: <Send size={14} strokeWidth={2} className="text-accent-action" aria-hidden />,
        title: (
          <>
            {actor} envió {artifact} a revisión
          </>
        ),
        variant: "default",
      };
    case "artifact.rejected": {
      const feedback = asString(field(event.detail, "feedback"));
      return {
        icon: <XCircle size={14} strokeWidth={2} className="text-accent-danger" aria-hidden />,
        title: (
          <>
            {actor} rechazó {artifact}
          </>
        ),
        description: feedback ? <>«{feedback}»</> : undefined,
        variant: "default",
      };
    }
    case "artifact.revalidated":
      return {
        icon: <RotateCcw size={14} strokeWidth={2} aria-hidden />,
        title: (
          <>
            {actor} revalidó {artifact} sin cambios
          </>
        ),
        variant: "default",
      };
    case "artifact.locked": {
      const lockedBy = asString(field(event.detail, "lockedBy"));
      return {
        icon: <Lock size={14} strokeWidth={2} aria-hidden />,
        title: (
          <>
            {actor} bloqueó {artifact}
          </>
        ),
        description: lockedBy ? <span className="font-mono">{lockedBy}</span> : undefined,
        variant: "default",
      };
    }
    case "artifact.unlocked":
      return {
        icon: <LockOpen size={14} strokeWidth={2} className="text-accent-warning" aria-hidden />,
        title: (
          <>
            {actor} desbloqueó {artifact} — los dependientes quedan desactualizados
          </>
        ),
        variant: "default",
      };
    case "project.created":
      return {
        icon: <FolderPlus size={14} strokeWidth={2} aria-hidden />,
        title: <>{actor} creó el proyecto</>,
        variant: "default",
      };
    case "project.artifacts_instantiated": {
      const createdTypes = field(event.detail, "createdTypes");
      const count = Array.isArray(createdTypes) ? createdTypes.length : null;
      return {
        icon: <Shapes size={14} strokeWidth={2} aria-hidden />,
        title: <>{actor} instanció los artefactos del proyecto</>,
        description: count != null ? `${count} artefactos creados con su grafo de dependencias` : undefined,
        variant: "default",
      };
    }
    case "project.archived":
      return {
        icon: <Archive size={14} strokeWidth={2} aria-hidden />,
        title: <>{actor} archivó el proyecto</>,
        variant: "default",
      };
    case "task.created": {
      const title = asString(field(event.detail, "title"));
      return {
        icon: <ListPlus size={14} strokeWidth={2} aria-hidden />,
        title: (
          <>
            {actor} creó la tarea {title ? <>«{title}»</> : null}
          </>
        ),
        variant: "default",
      };
    }
    case "task.completed": {
      const title = asString(field(event.detail, "title"));
      return {
        icon: <ListChecks size={14} strokeWidth={2} className="text-accent-success" aria-hidden />,
        title: (
          <>
            {actor} completó la tarea {title ? <>«{title}»</> : null}
          </>
        ),
        variant: "default",
      };
    }
    default:
      return {
        icon: <History size={14} strokeWidth={2} aria-hidden />,
        title: (
          <>
            {actor} <span className="font-mono text-xs">{event.action}</span>
          </>
        ),
        variant: "default",
      };
  }
}

/**
 * Activity feed del proyecto (§12.2): versiones, aprobaciones y mutaciones
 * auditadas, con timestamps relativos en español. La actividad de agentes
 * (origin `agent_run`) usa la variante violeta reservada (§11.4).
 */
export function ActivityFeed({ events, artifactBaseHref }: ActivityFeedProps) {
  // approve() audita además con action "artifact.approved" (entityType
  // "artifact"); el feed ya sirve la aprobación como evento de primera clase
  // desde la tabla approvals — se omite el duplicado de audit aquí.
  const visible = events.filter(
    (event) => !(event.kind === "audit" && event.action === "artifact.approved"),
  );

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<History size={20} strokeWidth={1.75} aria-hidden />}
        title="Sin actividad todavía"
        description="Las versiones, aprobaciones y cambios del proyecto aparecerán aquí."
        className="border-0 py-8"
      />
    );
  }

  const now = new Date();

  return (
    <div className="flex flex-col divide-y divide-border">
      {visible.map((event) => {
        const view = buildView(event, artifactBaseHref);
        return (
          <ActivityItem
            key={`${event.kind}:${event.id}`}
            icon={view.icon}
            title={view.title}
            description={view.description}
            timestamp={formatRelativeTimeEs(event.createdAt, now)}
            variant={view.variant}
          />
        );
      })}
    </div>
  );
}
