import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { PhaseGate } from "@/modules/artifacts";
import {
  MonoId,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@/ui";

interface ArtifactsByPhaseProps {
  gates: PhaseGate[];
  /** Base del editor: `/w/[slug]/p/[projectId]/artifacts` (sin slash final). */
  artifactBaseHref: string;
  /** userId → nombre, para resolver owners (miembros vivos del workspace). */
  ownerNames: ReadonlyMap<string, string>;
}

/**
 * Lista de artefactos del Cockpit (§7.1): tabla densa agrupada por fase, con
 * estado + flags transversales (§8.2), versión sellada, owner y link al
 * editor de Spec OS.
 */
export function ArtifactsByPhase({
  gates,
  artifactBaseHref,
  ownerNames,
}: ArtifactsByPhaseProps) {
  const groups = gates.filter((gate) => gate.artifacts.length > 0);

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[34%]">Artefacto</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="w-16">Versión</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>ID</TableHead>
          <TableHead className="w-8">
            <span className="sr-only">Abrir editor</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((gate, index) => {
          const phaseNumber = String(index + 1).padStart(2, "0");
          return [
            <TableRow
              key={`phase-${gate.phase}`}
              className="border-b-0 bg-surface-raised/40 hover:bg-surface-raised/40"
            >
              <TableCell colSpan={6} className="py-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
                    {phaseNumber} · {gate.label}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[10px] tabular-nums",
                      gate.closable ? "text-accent-success" : "text-faint",
                    )}
                  >
                    {gate.approvedCount}/{gate.requiredCount} aprobados
                    {gate.closable ? " · gate cerrable" : ""}
                  </span>
                </div>
              </TableCell>
            </TableRow>,
            ...gate.artifacts.map(({ artifact, label }) => {
              const href = `${artifactBaseHref}/${artifact.id}`;
              const hasPendingDraft =
                artifact.draftPayload != null &&
                (artifact.status === "approved" || artifact.status === "locked");
              return (
                <TableRow key={artifact.id}>
                  <TableCell>
                    <Link
                      href={href}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {label}
                    </Link>
                    <span className="ml-2 font-mono text-[11px] text-faint">
                      {artifact.type}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <StatusPill
                        status={artifact.status}
                        outdated={artifact.outdated}
                        rejected={artifact.rejected}
                      />
                      {hasPendingDraft ? (
                        <span className="font-mono text-[10px] text-faint">+borrador</span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted tabular-nums">
                    {artifact.currentVersion > 0 ? `v${artifact.currentVersion}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted">
                    {(artifact.ownerId ? ownerNames.get(artifact.ownerId) : null) ?? "—"}
                  </TableCell>
                  <TableCell>
                    <MonoId id={artifact.id} truncate={10} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={href}
                      aria-label={`Abrir ${label} en el editor`}
                      className="inline-flex size-5 items-center justify-center rounded text-faint transition-colors hover:bg-surface-raised hover:text-foreground"
                    >
                      <ArrowUpRight size={13} strokeWidth={2} aria-hidden />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            }),
          ];
        })}
      </TableBody>
    </Table>
  );
}
