"use client";

import { CircleCheck } from "lucide-react";

import {
  Badge,
  EmptyState,
  MonoId,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui";

/** Versión sellada, serializable (fechas ya formateadas por el servidor). */
export interface VersionListItem {
  id: string;
  version: number;
  origin: "human" | "agent_run";
  agentRunId: string | null;
  authorName: string | null;
  createdAtLabel: string;
}

export interface ApprovalListItem {
  id: string;
  version: number;
  approverName: string;
  comment: string | null;
  createdAtLabel: string;
}

/**
 * Historial del artefacto (§8.3): versiones inmutables con autor, origen
 * (humano | agent run — violeta EXCLUSIVO de agentes, §11.4), fecha y
 * comentario de aprobación.
 */
export function HistoryPanel({
  versions,
  approvals,
}: {
  versions: VersionListItem[];
  approvals: ApprovalListItem[];
}) {
  if (versions.length === 0) {
    return (
      <EmptyState
        title="Sin versiones selladas"
        description="Las versiones inmutables se crean al aprobar el artefacto (§8.3)."
      />
    );
  }

  const approvalByVersion = new Map(approvals.map((approval) => [approval.version, approval]));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Versión</TableHead>
          <TableHead>Origen</TableHead>
          <TableHead>Autor</TableHead>
          <TableHead>Aprobación</TableHead>
          <TableHead className="text-right">Fecha</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {versions.map((version) => {
          const approval = approvalByVersion.get(version.version);
          return (
            <TableRow key={version.id}>
              <TableCell className="font-mono text-foreground">v{version.version}</TableCell>
              <TableCell>
                {version.origin === "agent_run" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Badge tone="agent">Agente</Badge>
                    {version.agentRunId ? (
                      <MonoId id={version.agentRunId} truncate={12} />
                    ) : null}
                  </span>
                ) : (
                  <Badge tone="neutral">Humano</Badge>
                )}
              </TableCell>
              <TableCell>{version.authorName ?? "—"}</TableCell>
              <TableCell>
                {approval ? (
                  <span className="inline-flex max-w-md items-baseline gap-1.5">
                    <CircleCheck
                      size={12}
                      aria-hidden
                      className="shrink-0 self-center text-accent-success"
                    />
                    <span className="text-foreground">{approval.approverName}</span>
                    {approval.comment ? (
                      <span className="truncate text-muted italic">
                        «{approval.comment}»
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-muted tabular-nums whitespace-nowrap">
                {version.createdAtLabel}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
