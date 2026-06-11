import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Package,
  Server,
  TriangleAlert,
} from "lucide-react";

import { releasePayloadSchema, type ReleasePayload } from "@/modules/artifacts";
import {
  getArtifactWithHistory,
  getProjectArtifacts,
} from "@/modules/artifacts/service";
import { DEPLOY_SLOTS, getSlotUrl, type DeploySlot, type SlotStatus } from "@/modules/deploy";
import {
  getSlotStatuses,
  listDeployments,
  parseDeploymentDetail,
  type DeploymentWithActor,
} from "@/modules/deploy/service";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import { runReleaseChecklist } from "@/modules/review";
import type { ReleaseChecklistItem } from "@/modules/artifacts";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui";

import { formatRelativeTimeEs } from "../_components/relative-time";
import {
  AutoRefresh,
  CreateReleaseButton,
  DeployReleaseButton,
  StopSlotButton,
} from "./deploy-controls";

/**
 * Pantalla Deploy (§7.8): checklist de release en vivo con confirmación
 * humana, historial de releases (versiones inmutables del artefacto release),
 * y slots locales producción/preview con estado REAL del provider, deploy,
 * detención y rollback. Deploy es siempre acción humana con rol (§13, §19) —
 * cero violeta en esta pantalla.
 */

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

const SLOT_LABELS: Record<DeploySlot, string> = {
  production: "Producción",
  preview: "Preview",
};

/** A dónde lleva cada ítem del checklist cuando falla (§7.8). */
const CHECKLIST_LINKS: Record<string, { segment: string; label: string }> = {
  "generator-inputs-approved": { segment: "/generator", label: "Abrir Generator" },
  "compositions-approved": { segment: "/studio", label: "Abrir Studio" },
  "bindings-valid": { segment: "/cms", label: "Revisar CMS" },
  "generation-up-to-date": { segment: "/generator", label: "Abrir Generator" },
  "no-pending-outdated": { segment: "", label: "Abrir Cockpit" },
};

interface ReleaseRow {
  version: number;
  createdAt: Date;
  authorName: string | null;
  /** null = versión con schema legado (ilegible bajo 2.0). */
  payload: ReleasePayload | null;
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

function ChecklistRow({
  item,
  basePath,
}: {
  item: ReleaseChecklistItem;
  basePath: string;
}) {
  const link = item.ok ? null : CHECKLIST_LINKS[item.key];
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      {item.ok ? (
        <CircleCheck
          size={15}
          strokeWidth={2}
          className="mt-px shrink-0 text-accent-success"
          aria-hidden
        />
      ) : (
        <CircleAlert
          size={15}
          strokeWidth={2}
          className="mt-px shrink-0 text-accent-warning"
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{item.label}</p>
        {item.detail ? <p className="mt-0.5 text-xs text-muted">{item.detail}</p> : null}
      </div>
      {link ? (
        <Link
          href={`${basePath}${link.segment}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          {link.label}
          <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
        </Link>
      ) : null}
    </li>
  );
}

function slotStateBadge(status: SlotStatus, building: boolean) {
  if (building) return <Badge tone="warning">Build en curso</Badge>;
  if (status.state === "running") {
    return status.healthy ? (
      <Badge tone="success">Corriendo</Badge>
    ) : (
      <Badge tone="warning">Corriendo · sin respuesta sana</Badge>
    );
  }
  // Pidfile huérfano: el proceso murió fuera de la plataforma.
  if (status.releaseNumber != null) {
    return <Badge tone="warning">Detenido · proceso caído</Badge>;
  }
  return <Badge>Detenido</Badge>;
}

const DEPLOYMENT_STATUS_LABELS: Record<string, string> = {
  building: "build en curso",
  running: "corriendo",
  stopped: "detenido",
  failed: "falló",
};

function SlotCard({
  projectId,
  slot,
  status,
  lastDeployment,
  latestRelease,
  canEdit,
  now,
}: {
  projectId: string;
  slot: DeploySlot;
  status: SlotStatus;
  lastDeployment: DeploymentWithActor | null;
  latestRelease: number;
  canEdit: boolean;
  now: Date;
}) {
  const slotLabel = SLOT_LABELS[slot];
  const building = lastDeployment?.deployment.status === "building";
  const running = status.state === "running";
  const activeRelease = running ? status.releaseNumber : null;
  const rollbackTarget =
    running && status.releaseNumber != null && status.releaseNumber > 1
      ? status.releaseNumber - 1
      : null;
  const url = status.url ?? getSlotUrl(slot);
  const failedDetail =
    lastDeployment?.deployment.status === "failed"
      ? parseDeploymentDetail(lastDeployment.deployment.detail).error
      : null;
  const disabledReason = canEdit
    ? null
    : "Tu rol no permite desplegar: requiere admin o member.";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Server size={15} strokeWidth={1.75} className="text-muted" aria-hidden />
          <div>
            <CardTitle>{slotLabel}</CardTitle>
            <CardDescription>
              {running ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs underline-offset-2 hover:text-foreground hover:underline"
                >
                  {url}
                  <ExternalLink size={11} strokeWidth={2} aria-hidden />
                </a>
              ) : (
                <span className="font-mono text-xs">{url}</span>
              )}
            </CardDescription>
          </div>
        </div>
        {slotStateBadge(status, building)}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="text-[11px] font-medium tracking-wider text-muted uppercase">
              Release activo
            </dt>
            <dd className="mt-0.5 font-mono text-foreground tabular-nums">
              {activeRelease != null
                ? `v${activeRelease}`
                : status.releaseNumber != null
                  ? `v${status.releaseNumber} (caído)`
                  : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium tracking-wider text-muted uppercase">
              Proceso
            </dt>
            <dd className="mt-0.5 font-mono text-foreground tabular-nums">
              {status.pid != null ? `pid ${status.pid}` : "—"}
              {status.startedAt
                ? ` · ${formatRelativeTimeEs(new Date(status.startedAt), now)}`
                : ""}
            </dd>
          </div>
        </dl>

        {lastDeployment ? (
          <p
            className="text-xs text-muted"
            title={dateFormatter.format(lastDeployment.deployment.createdAt)}
          >
            Último deploy: v{lastDeployment.deployment.releaseVersion} —{" "}
            {DEPLOYMENT_STATUS_LABELS[lastDeployment.deployment.status] ??
              lastDeployment.deployment.status}
            {lastDeployment.actorName ? ` · ${lastDeployment.actorName}` : ""} ·{" "}
            {formatRelativeTimeEs(lastDeployment.deployment.createdAt, now)}
          </p>
        ) : null}

        {failedDetail ? (
          <pre className="max-h-28 overflow-auto rounded border border-accent-danger/40 bg-surface-raised px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-accent-danger">
            {failedDetail}
          </pre>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {latestRelease > 0 ? (
            <>
              <DeployReleaseButton
                projectId={projectId}
                releaseVersion={latestRelease}
                slot={slot}
                slotLabel={slotLabel}
                buttonLabel={
                  activeRelease === latestRelease
                    ? `Re-desplegar v${latestRelease}`
                    : `Desplegar v${latestRelease}`
                }
                variant={activeRelease === latestRelease ? "secondary" : "primary"}
                disabled={!canEdit}
                disabledReason={disabledReason}
              />
              {rollbackTarget != null ? (
                <DeployReleaseButton
                  projectId={projectId}
                  releaseVersion={rollbackTarget}
                  slot={slot}
                  slotLabel={slotLabel}
                  buttonLabel={`Rollback a v${rollbackTarget}`}
                  intent="rollback"
                  variant="secondary"
                  disabled={!canEdit}
                  disabledReason={disabledReason}
                />
              ) : null}
              {running ? (
                <StopSlotButton
                  projectId={projectId}
                  slot={slot}
                  slotLabel={slotLabel}
                  runningRelease={status.releaseNumber}
                  disabled={!canEdit}
                  disabledReason={disabledReason}
                />
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted">
              Sin releases que desplegar: crea el primero desde el checklist.
            </p>
          )}
          {!canEdit && latestRelease > 0 ? (
            <span className="text-xs text-muted">{disabledReason}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function versionsSummary(payload: ReleasePayload): string {
  const v = payload.versions;
  const pages = Object.keys(v.compositions).length;
  return [
    `sitemap v${v.sitemap}`,
    `cms v${v.cms}`,
    `tokens v${v.tokens}`,
    v.content > 0 ? `contenido v${v.content}` : "contenido —",
    `${pages} página${pages === 1 ? "" : "s"}`,
  ].join(" · ");
}

function ReleaseSlotBadges({
  version,
  statusBySlot,
  lastDeployFor,
}: {
  version: number;
  statusBySlot: Map<DeploySlot, SlotStatus>;
  lastDeployFor: (version: number, slot: DeploySlot) => DeploymentWithActor | null;
}) {
  const badges = DEPLOY_SLOTS.map((slot) => {
    const status = statusBySlot.get(slot);
    const active = status?.state === "running" && status.releaseNumber === version;
    const last = lastDeployFor(version, slot)?.deployment ?? null;
    if (active) {
      return (
        <Badge key={slot} tone="success">
          {SLOT_LABELS[slot]}
        </Badge>
      );
    }
    if (last?.status === "building") {
      return (
        <Badge key={slot} tone="warning">
          {SLOT_LABELS[slot]}: build…
        </Badge>
      );
    }
    if (last?.status === "failed") {
      return (
        <Badge key={slot} tone="danger">
          {SLOT_LABELS[slot]}: falló
        </Badge>
      );
    }
    return null;
  }).filter(Boolean);
  return badges.length > 0 ? (
    <span className="flex flex-wrap gap-1">{badges}</span>
  ) : (
    <span className="text-faint">—</span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DeployPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId } = await params;
  const basePath = `/w/${slug}/p/${projectId}`;

  // El proxy solo comprueba la cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`${basePath}/deploy`)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  const canEdit = membership.role === "admin" || membership.role === "member";

  const [checklist, projectArtifacts, deploymentRows, statuses] = await Promise.all([
    runReleaseChecklist(projectId),
    getProjectArtifacts(projectId),
    listDeployments(projectId),
    getSlotStatuses(projectId),
  ]);

  const releaseItem =
    projectArtifacts.find(
      (item) => item.artifact.type === "release" && item.artifact.key == null,
    ) ?? null;
  const latestRelease = releaseItem?.artifact.currentVersion ?? 0;

  let releases: ReleaseRow[] = [];
  if (releaseItem && latestRelease > 0) {
    const history = await getArtifactWithHistory(releaseItem.artifact.id);
    releases = history.versions.map((version) => {
      const parsed = releasePayloadSchema.safeParse(version.payload);
      return {
        version: version.version,
        createdAt: version.createdAt,
        authorName: version.author?.name ?? null,
        payload: parsed.success ? parsed.data : null,
      };
    });
  }

  const statusBySlot = new Map<DeploySlot, SlotStatus>(
    statuses.map((status) => [status.slot, status]),
  );
  // deploymentRows viene newest-first: el primero por slot es el último.
  const lastDeploymentBySlot = new Map<DeploySlot, DeploymentWithActor>();
  for (const row of deploymentRows) {
    if (!lastDeploymentBySlot.has(row.deployment.slot)) {
      lastDeploymentBySlot.set(row.deployment.slot, row);
    }
  }
  const lastDeployFor = (version: number, slot: DeploySlot): DeploymentWithActor | null =>
    deploymentRows.find(
      (row) => row.deployment.releaseVersion === version && row.deployment.slot === slot,
    ) ?? null;

  const checklistFailing = checklist.filter((item) => !item.ok);
  const checklistOk = checklistFailing.length === 0;
  const buildingCount = deploymentRows.filter(
    (row) => row.deployment.status === "building",
  ).length;
  const runningSlots = statuses.filter((status) => status.state === "running");

  const createDisabledReason = !releaseItem
    ? "El proyecto no tiene artefacto release; entra al Cockpit para instanciar el grafo de artefactos."
    : !canEdit
      ? "Tu rol no permite crear releases: requiere admin o member."
      : !checklistOk
        ? `El checklist tiene ${checklistFailing.length} punto${checklistFailing.length === 1 ? "" : "s"} pendiente${checklistFailing.length === 1 ? "" : "s"}.`
        : null;

  const now = new Date();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      {/* Polling ligero mientras haya builds en curso (deploys de otras pestañas). */}
      <AutoRefresh enabled={buildingCount > 0} />

      <PageHeader
        eyebrow={project.name}
        title="Deploy"
        description="Releases inmutables del proyecto generado y slots locales producción/preview (§7.8). Ningún release sin checklist en verde + confirmación humana con rol; rollback = desplegar la versión anterior."
        meta={
          <>
            <Badge tone={latestRelease > 0 ? "success" : "neutral"}>
              {latestRelease > 0 ? `Último release: v${latestRelease}` : "Sin releases"}
            </Badge>
            <Badge tone={runningSlots.length > 0 ? "success" : "neutral"}>
              {runningSlots.length} slot{runningSlots.length === 1 ? "" : "s"} corriendo
            </Badge>
            {buildingCount > 0 ? <Badge tone="warning">Build en curso</Badge> : null}
            <MonoId id={projectId} />
          </>
        }
      />

      {/* 1. Checklist de release en vivo (§7.8) + crear release con confirmación */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Checklist de release</CardTitle>
            <CardDescription>
              Validaciones automáticas en vivo (§7.8). Crear el release exige además tu
              confirmación explícita: sella las versiones aprobadas y tagea el repo.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-faint tabular-nums">
              {checklist.length - checklistFailing.length}/{checklist.length} en verde
            </span>
            <CreateReleaseButton
              projectId={projectId}
              nextReleaseNumber={latestRelease + 1}
              checklist={checklist}
              enabled={createDisabledReason == null}
              disabledReason={createDisabledReason}
            />
          </div>
        </CardHeader>
        <ul className="flex flex-col divide-y divide-border">
          {checklist.map((item) => (
            <ChecklistRow key={item.key} item={item} basePath={basePath} />
          ))}
        </ul>
      </Card>

      {/* 2. Slots locales: estado REAL del provider + acciones humanas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {DEPLOY_SLOTS.map((slot) => {
          const status =
            statusBySlot.get(slot) ??
            ({
              slot,
              state: "stopped",
              releaseNumber: null,
              url: null,
              pid: null,
              healthy: false,
              startedAt: null,
            } satisfies SlotStatus);
          return (
            <SlotCard
              key={slot}
              projectId={projectId}
              slot={slot}
              status={status}
              lastDeployment={lastDeploymentBySlot.get(slot) ?? null}
              latestRelease={latestRelease}
              canEdit={canEdit}
              now={now}
            />
          );
        })}
      </div>

      {/* 3. Releases: versiones inmutables del artefacto release */}
      <Card>
        <CardHeader>
          <CardTitle>Releases</CardTitle>
          {releases.length > 0 ? (
            <span className="font-mono text-[11px] text-faint tabular-nums">
              {releases.length} release{releases.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </CardHeader>
        {releases.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Release</TableHead>
                <TableHead>Tag git</TableHead>
                <TableHead>Versiones selladas</TableHead>
                <TableHead>Slots</TableHead>
                <TableHead>Autor</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.map((release) => (
                <TableRow key={release.version}>
                  <TableCell>
                    <span className="font-mono text-xs font-medium text-foreground tabular-nums">
                      v{release.version}
                    </span>
                    {release.payload?.notes ? (
                      <p
                        className="mt-0.5 max-w-48 truncate text-xs text-muted"
                        title={release.payload.notes}
                      >
                        {release.payload.notes}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {release.payload ? (
                      <MonoId id={release.payload.gitTag} />
                    ) : (
                      <Badge tone="warning">schema legado</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted tabular-nums">
                    {release.payload ? versionsSummary(release.payload) : "—"}
                  </TableCell>
                  <TableCell>
                    <ReleaseSlotBadges
                      version={release.version}
                      statusBySlot={statusBySlot}
                      lastDeployFor={lastDeployFor}
                    />
                  </TableCell>
                  <TableCell className="text-muted">{release.authorName ?? "—"}</TableCell>
                  <TableCell
                    className="whitespace-nowrap text-muted"
                    title={dateFormatter.format(release.createdAt)}
                  >
                    {formatRelativeTimeEs(release.createdAt, now)}
                  </TableCell>
                  <TableCell>
                    {release.payload && canEdit ? (
                      <span className="flex gap-1">
                        <DeployReleaseButton
                          projectId={projectId}
                          releaseVersion={release.version}
                          slot="preview"
                          slotLabel={SLOT_LABELS.preview}
                          buttonLabel="Preview"
                          variant="ghost"
                          size="sm"
                        />
                        <DeployReleaseButton
                          projectId={projectId}
                          releaseVersion={release.version}
                          slot="production"
                          slotLabel={SLOT_LABELS.production}
                          buttonLabel="Producción"
                          variant="ghost"
                          size="sm"
                        />
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <CardContent>
            <EmptyState
              icon={<Package size={20} strokeWidth={1.5} aria-hidden />}
              title="Sin releases todavía"
              description={
                checklistOk
                  ? "El checklist está en verde: crea el primer release para sellar el snapshot y poder desplegar."
                  : "Un release sella las versiones aprobadas del proyecto como snapshot inmutable. Se desbloquea cuando el checklist de arriba está en verde."
              }
            />
          </CardContent>
        )}
      </Card>

      {/* Nota operativa del MVP local */}
      <p className="flex items-start gap-1.5 text-xs text-faint">
        <TriangleAlert size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
        <span>
          Deploy local (MVP): los slots sirven builds inmutables con procesos{" "}
          <code className="font-mono">next start</code> en los puertos 4100/4200 (env{" "}
          <code className="font-mono">DEPLOY_PROD_PORT</code>/
          <code className="font-mono">DEPLOY_PREVIEW_PORT</code>). Vercel llegará detrás de la
          misma interfaz. Mientras un build está en curso esta pantalla se refresca sola; el
          resultado queda siempre registrado en deployments y en el audit log.
        </span>
      </p>
    </main>
  );
}
