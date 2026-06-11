import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Sparkles } from "lucide-react";

import type { AgentRunStatus } from "@/db/schema";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import {
  Badge,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@/ui";

import { formatRelativeTimeEs } from "../_components/relative-time";
import { AutoRefresh } from "./_components/auto-refresh";
import { RunStatusPill } from "./_components/run-status-pill";
import { listProjectRuns, type RunWithRelations } from "./_lib/queries";
import {
  RUN_STATUSES,
  RUN_STATUS_LABELS,
  formatCostUsd,
  formatTokens,
  isRunLive,
  isRunStatus,
  skillRef,
  targetLabel,
} from "./_lib/run-format";

/**
 * Agent run log del proyecto (§7.9, §9.6, §11.4 "componente firma"): tabla
 * densa de runs con skill+versión exactas, target, estado, proveedor/modelo,
 * key por referencia, coste y actor. Violeta SOLO en lo que hizo (o dejó
 * pendiente) el agente; mono en ids, versiones y modelos.
 */

function costCell(run: RunWithRelations): { text: string; title: string } | null {
  if (!run.usage) return null;
  const tokens = `${formatTokens(run.usage.inputTokens)} in / ${formatTokens(run.usage.outputTokens)} out tok`;
  if (run.usage.costUsd > 0) {
    return { text: formatCostUsd(run.usage.costUsd), title: tokens };
  }
  // 0 = mock o modelo sin tabla de precios (runtime/cost.ts): se muestran tokens.
  return { text: tokens, title: "Coste estimado no disponible para este proveedor/modelo." };
}

export default async function AgentRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; projectId: string }>;
  searchParams: Promise<{ estado?: string | string[] }>;
}) {
  const { slug, projectId } = await params;
  const path = `/w/${slug}/p/${projectId}`;

  // El proxy solo comprueba la cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`${path}/runs`)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  const runs = await listProjectRuns(project.id);

  const estadoParam = (await searchParams).estado;
  const filter: AgentRunStatus | null =
    typeof estadoParam === "string" && isRunStatus(estadoParam) ? estadoParam : null;
  const visible = filter ? runs.filter((run) => run.status === filter) : runs;

  const counts = new Map<AgentRunStatus, number>();
  for (const run of runs) counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  const pendingDecision = counts.get("proposed") ?? 0;
  const hasLiveRuns = runs.some((run) => isRunLive(run.status));

  const now = new Date();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      {hasLiveRuns ? <AutoRefresh /> : null}

      <PageHeader
        eyebrow={`${membership.workspace.name} · ${project.name}`}
        title="Agent runs"
        description="Cada run registra qué leyó (con versiones exactas), qué propuso, qué modelo usó y quién decidió (§9.6). Ningún run aprueba nada: la decisión es siempre humana."
        meta={
          <>
            <span className="font-mono text-xs text-muted tabular-nums">
              {runs.length} run{runs.length === 1 ? "" : "s"}
            </span>
            {pendingDecision > 0 ? (
              <Badge tone="agent">
                {pendingDecision} propuesta{pendingDecision === 1 ? "" : "s"} pendiente
                {pendingDecision === 1 ? "" : "s"} de decisión
              </Badge>
            ) : null}
          </>
        }
      />

      {runs.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={24} strokeWidth={1.5} aria-hidden />}
          title="Este proyecto aún no tiene agent runs"
          description="Lanza una skill desde el asistente contextual (en el Cockpit, Spec OS o Studio). El agente lee artefactos aprobados, genera una propuesta con diff y validaciones, y espera tu decisión: nada se aprueba solo."
          action={
            <Link
              href={path}
              className="inline-flex h-7 items-center gap-1.5 rounded border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-raised"
            >
              Ir al Cockpit
            </Link>
          }
          className="py-16"
        />
      ) : (
        <>
          {/* Filtro simple por estado del run */}
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtrar por estado">
            <Link
              href={`${path}/runs`}
              className={cn(
                "rounded-full border px-2 py-px text-[11px] font-medium leading-4 transition-colors",
                filter == null
                  ? "border-border-strong bg-surface-raised text-foreground"
                  : "border-border text-muted hover:text-foreground",
              )}
            >
              Todos{" "}
              <span className="font-mono tabular-nums">{runs.length}</span>
            </Link>
            {RUN_STATUSES.map((status) => {
              const count = counts.get(status) ?? 0;
              return (
                <Link
                  key={status}
                  href={`${path}/runs?estado=${status}`}
                  className={cn(
                    "rounded-full border px-2 py-px text-[11px] font-medium leading-4 transition-colors",
                    filter === status
                      ? "border-border-strong bg-surface-raised text-foreground"
                      : "border-border text-muted hover:text-foreground",
                    count === 0 && filter !== status && "opacity-50",
                  )}
                >
                  {RUN_STATUS_LABELS[status]}{" "}
                  <span className="font-mono tabular-nums">{count}</span>
                </Link>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Skill</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Proveedor / modelo</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Coste</TableHead>
                  <TableHead>Lanzado</TableHead>
                  <TableHead>Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-xs text-faint">
                      Sin runs en estado «{filter ? RUN_STATUS_LABELS[filter] : ""}».
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((run) => {
                    const cost = costCell(run);
                    return (
                      <TableRow key={run.id}>
                        <TableCell>
                          <Link
                            href={`${path}/runs/${run.id}`}
                            className="font-mono text-xs text-foreground underline-offset-2 hover:underline"
                            title={run.id}
                          >
                            {skillRef(run.skill, run.skillVersion)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {run.targetArtifactId ? (
                            <Link
                              href={`${path}/artifacts/${run.targetArtifactId}`}
                              className="text-xs underline-offset-2 hover:underline"
                            >
                              {targetLabel(
                                run.targetType,
                                run.targetKey,
                                run.targetArtifact?.label,
                              )}
                            </Link>
                          ) : (
                            <span className="text-xs text-faint">
                              {targetLabel(run.targetType, run.targetKey)} (eliminado)
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <RunStatusPill status={run.status} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted">
                          {run.provider}
                          {run.modelId ? (
                            <span className="text-foreground"> · {run.modelId}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted">
                          {run.keyRefPublic ? (
                            <span title={`${run.keyRefPublic.label} (${run.keyRefPublic.id})`}>
                              ····{run.keyRefPublic.last4}
                            </span>
                          ) : run.provider === "mock" ? (
                            "—"
                          ) : (
                            <span title="Run sin key resuelta (falló antes de resolverla o la key fue borrada).">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted tabular-nums">
                          {cost ? <span title={cost.title}>{cost.text}</span> : "—"}
                        </TableCell>
                        <TableCell
                          className="text-xs whitespace-nowrap text-muted"
                          title={run.createdAt.toISOString()}
                        >
                          {formatRelativeTimeEs(run.createdAt, now)}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {run.creator?.name ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </main>
  );
}
