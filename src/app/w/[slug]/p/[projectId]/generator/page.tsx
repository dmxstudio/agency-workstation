import path from "node:path";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  FolderGit2,
  GitCommitHorizontal,
  TriangleAlert,
} from "lucide-react";

import {
  getGenerationRequirements,
  getGenerations,
  getProjectRepoDir,
  gitLog,
  hasManifest,
  type Conflict,
  type GenerationRequirement,
  type GenerationSummary,
  type GenerationWithActor,
} from "@/modules/generator";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
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
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type ArtifactStatus,
} from "@/ui";

import { formatRelativeTimeEs } from "../_components/relative-time";
import { ConflictList } from "./conflict-list";
import { CopyBlock } from "./copy-block";
import { GenerateButton, RegenerateControls } from "./generate-controls";

/**
 * Pantalla del Project Generator (§7.3, §18.2): checklist de artefactos
 * aprobados que habilitan la generación, panel del repo generado con
 * instrucciones de arranque, conflictos de la última generación como UI de
 * primera clase (el sistema marca, nunca resuelve) e historial de corridas.
 */

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

// ---------------------------------------------------------------------------
// Normalización del summary (jsonb sin tipar en el schema)
// ---------------------------------------------------------------------------

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeSummary(value: unknown): GenerationSummary {
  const raw = (value ?? {}) as Partial<Record<keyof GenerationSummary, unknown>>;
  return {
    written: asStringArray(raw.written),
    created: asStringArray(raw.created),
    preserved: asStringArray(raw.preserved),
    skipped: asStringArray(raw.skipped),
    deletedOrphans: asStringArray(raw.deletedOrphans),
    conflicts: Array.isArray(raw.conflicts) ? (raw.conflicts as Conflict[]) : [],
    inputVersions:
      raw.inputVersions && typeof raw.inputVersions === "object"
        ? (raw.inputVersions as GenerationSummary["inputVersions"])
        : {},
    commit: typeof raw.commit === "string" ? raw.commit : null,
  };
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

const ARTIFACT_STATUSES: readonly ArtifactStatus[] = [
  "empty",
  "draft",
  "in_review",
  "approved",
  "locked",
];

function toArtifactStatus(status: string): ArtifactStatus {
  return (ARTIFACT_STATUSES as readonly string[]).includes(status)
    ? (status as ArtifactStatus)
    : "empty";
}

function RequirementIcon({ requirement }: { requirement: GenerationRequirement }) {
  if (requirement.ok) {
    return (
      <CircleCheck size={15} strokeWidth={2} className="shrink-0 text-accent-success" aria-hidden />
    );
  }
  if (requirement.required) {
    return (
      <CircleAlert size={15} strokeWidth={2} className="shrink-0 text-accent-warning" aria-hidden />
    );
  }
  return <CircleDashed size={15} strokeWidth={2} className="shrink-0 text-faint" aria-hidden />;
}

function RequirementRow({
  requirement,
  artifactBaseHref,
}: {
  requirement: GenerationRequirement;
  artifactBaseHref: string;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <RequirementIcon requirement={requirement} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium text-foreground">{requirement.label}</span>
          <code className="font-mono text-[11px] text-faint">{requirement.type}</code>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {requirement.required
            ? "Requerido para generar"
            : "Opcional: enriquece el seed y las composiciones"}
        </p>
      </div>
      {requirement.currentVersion > 0 ? (
        <span className="font-mono text-[11px] text-faint tabular-nums">
          v{requirement.currentVersion}
        </span>
      ) : null}
      <StatusPill
        status={toArtifactStatus(requirement.status)}
        outdated={requirement.outdated}
      />
      {requirement.artifactId ? (
        <Link
          href={`${artifactBaseHref}/${requirement.artifactId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          {requirement.ok ? "Abrir" : "Completar"}
          <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
        </Link>
      ) : null}
    </li>
  );
}

function GenerationStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <Badge tone="success">Éxito</Badge>;
    case "conflicts":
      return <Badge tone="warning">Conflictos</Badge>;
    case "error":
      return <Badge tone="danger">Error</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function summaryLabel(summary: GenerationSummary): string {
  const parts: string[] = [];
  if (summary.created.length > 0) parts.push(`${summary.created.length} creados`);
  if (summary.written.length > 0) parts.push(`${summary.written.length} reescritos`);
  if (summary.preserved.length > 0) parts.push(`${summary.preserved.length} preservados`);
  if (summary.deletedOrphans.length > 0)
    parts.push(`${summary.deletedOrphans.length} huérfanos eliminados`);
  if (summary.conflicts.length > 0) parts.push(`${summary.conflicts.length} conflictos`);
  return parts.length > 0 ? parts.join(" · ") : "sin cambios";
}

function inputVersionsLabel(summary: GenerationSummary): string {
  return Object.entries(summary.inputVersions)
    .map(([type, version]) => `${type} v${version}`)
    .join(", ");
}

function HistoryTable({
  history,
  now,
}: {
  history: GenerationWithActor[];
  now: Date;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tipo</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Resumen</TableHead>
          <TableHead>Commit</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Fecha</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.map(({ generation, actorName }) => {
          const summary = normalizeSummary(generation.summary);
          const versions = inputVersionsLabel(summary);
          return (
            <TableRow key={generation.id}>
              <TableCell title={versions || undefined}>
                {generation.kind === "generate" ? "Generación" : "Regeneración"}
              </TableCell>
              <TableCell>
                <GenerationStatusBadge status={generation.status} />
              </TableCell>
              <TableCell
                className="text-muted tabular-nums"
                title={generation.status === "error" ? (generation.error ?? undefined) : undefined}
              >
                {generation.status === "error"
                  ? (generation.error ?? "error desconocido")
                  : summaryLabel(summary)}
              </TableCell>
              <TableCell>
                {summary.commit ? (
                  <MonoId id={summary.commit} truncate={7} />
                ) : (
                  <span className="text-faint">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted">{actorName ?? "—"}</TableCell>
              <TableCell
                className="whitespace-nowrap text-muted"
                title={dateFormatter.format(generation.createdAt)}
              >
                {formatRelativeTimeEs(generation.createdAt, now)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function GeneratorPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId } = await params;
  const basePath = `/w/${slug}/p/${projectId}`;

  // El proxy solo comprueba la cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`${basePath}/generator`)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  const [requirements, history] = await Promise.all([
    getGenerationRequirements(projectId),
    getGenerations(projectId),
  ]);

  const repoDir = getProjectRepoDir(projectId);
  const generated = hasManifest(repoDir);

  // Último commit real del repo (HEAD), que puede ser humano o de plataforma.
  let headCommit: { hash: string; message: string } | null = null;
  if (generated) {
    try {
      const [head] = await gitLog(repoDir, 1);
      if (head) {
        const spaceIndex = head.indexOf(" ");
        headCommit =
          spaceIndex > 0
            ? { hash: head.slice(0, spaceIndex), message: head.slice(spaceIndex + 1) }
            : { hash: head, message: "" };
      }
    } catch {
      headCommit = null; // repo ilegible: el panel sigue mostrando la ruta
    }
  }

  const canEdit = membership.role === "admin" || membership.role === "member";
  const missingRequired = requirements.filter((req) => req.required && !req.ok);
  const allRequiredOk = missingRequired.length === 0;
  const outdatedApproved = requirements.filter((req) => req.ok && req.outdated);

  const runEnabled = allRequiredOk && canEdit;
  const disabledReason = !canEdit
    ? "Tu rol no permite generar: requiere admin o member."
    : !allRequiredOk
      ? `Aprueba primero: ${missingRequired.map((req) => req.label).join(", ")}.`
      : null;

  const latest = history[0] ?? null;
  const latestSummary = latest ? normalizeSummary(latest.generation.summary) : null;
  const latestConflicts = latestSummary?.conflicts ?? [];

  // Ruta para el bloque de comandos: relativa al monolito si vive dentro.
  const relativeRepo = path.relative(process.cwd(), repoDir);
  const cdTarget = relativeRepo.startsWith("..") ? repoDir : relativeRepo;
  const runCommands = [
    `cd ${cdTarget}`,
    "npm install",
    "npm run generate:types",
    "npm run seed",
    "npm run dev",
  ].join("\n");

  const artifactBaseHref = `${basePath}/artifacts`;
  const now = new Date();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <PageHeader
        eyebrow={project.name}
        title="Generator"
        description="De artefactos aprobados a un proyecto Next.js + Payload con repo git propio (§7.3). La regeneración solo toca zonas codegen y marca conflictos, nunca pisa trabajo humano (§18.2)."
        meta={
          <>
            <Badge tone={generated ? "success" : "neutral"}>
              {generated ? "Proyecto generado" : "Sin generar"}
            </Badge>
            {latestConflicts.length > 0 ? (
              <Badge tone="warning">
                {latestConflicts.length} conflicto{latestConflicts.length === 1 ? "" : "s"} sin
                resolver
              </Badge>
            ) : null}
            <MonoId id={projectId} />
          </>
        }
      />

      {/* 1. Checklist de requisitos (§7.3): qué artefactos habilitan generar */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Requisitos de generación</CardTitle>
            <CardDescription>
              Se usa siempre la última versión aprobada de cada artefacto, nunca borradores.
            </CardDescription>
          </div>
          <span className="font-mono text-[11px] text-faint tabular-nums">
            {requirements.filter((req) => req.required && req.ok).length}/
            {requirements.filter((req) => req.required).length} requeridos
          </span>
        </CardHeader>
        <ul className="flex flex-col divide-y divide-border">
          {requirements.map((requirement) => (
            <RequirementRow
              key={requirement.type}
              requirement={requirement}
              artifactBaseHref={artifactBaseHref}
            />
          ))}
        </ul>
        {outdatedApproved.length > 0 ? (
          <div className="flex items-start gap-2 border-t border-border px-4 py-2.5">
            <TriangleAlert
              size={14}
              strokeWidth={2}
              className="mt-px shrink-0 text-accent-warning"
              aria-hidden
            />
            <p className="text-xs text-muted">
              {outdatedApproved.map((req) => req.label).join(", ")}{" "}
              {outdatedApproved.length === 1 ? "está aprobado pero marcado" : "están aprobados pero marcados"}{" "}
              como desactualizado (§8.4). Puedes generar igualmente con la versión sellada; si
              quieres incorporar los cambios pendientes, re-aprueba antes.
            </p>
          </div>
        ) : null}
      </Card>

      {/* Banner de error de la última corrida */}
      {latest && latest.generation.status === "error" ? (
        <Card className="border-accent-danger/40">
          <CardContent className="flex items-start gap-3">
            <TriangleAlert
              size={16}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-accent-danger"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                La última {latest.generation.kind === "generate" ? "generación" : "regeneración"}{" "}
                falló
              </p>
              <pre className="mt-1.5 overflow-x-auto rounded border border-border bg-surface-raised px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                {latest.generation.error ?? "Error desconocido."}
              </pre>
              <p className="mt-1.5 text-xs text-muted">
                Ningún cambio se registró como aplicado. Corrige la causa y vuelve a intentarlo.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {generated ? (
        /* 2. Panel del proyecto generado + regeneración (§18.2) */
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FolderGit2 size={15} strokeWidth={1.75} className="text-muted" aria-hidden />
              <div>
                <CardTitle>Proyecto generado</CardTitle>
                <CardDescription>
                  Repo git propio del proyecto; la plataforma escribe vía commits descriptivos.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium tracking-wider text-muted uppercase">
                Ruta del repo
              </p>
              <MonoId id={repoDir} className="self-start text-left" />
            </div>

            {headCommit ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-medium tracking-wider text-muted uppercase">
                  Último commit
                </p>
                <p className="flex items-center gap-2 text-xs">
                  <GitCommitHorizontal
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-muted"
                    aria-hidden
                  />
                  <MonoId id={headCommit.hash} truncate={7} />
                  <span className="truncate font-mono text-xs text-muted" title={headCommit.message}>
                    {headCommit.message}
                  </span>
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium tracking-wider text-muted uppercase">
                Cómo correrlo
              </p>
              <CopyBlock text={runCommands} />
              <p className="text-xs text-muted">
                La generación nunca instala dependencias: <code className="font-mono">npm install</code>{" "}
                es tu paso (tarda unos minutos la primera vez).{" "}
                <code className="font-mono">generate:types</code> re-sincroniza los tipos de Payload
                con las colecciones generadas (repítelo tras regenerar colecciones). El proyecto corre
                en <code className="font-mono">http://localhost:4000</code>; el admin de Payload vive
                en <code className="font-mono">/admin</code>.
              </p>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-[11px] font-medium tracking-wider text-muted uppercase">
                Regenerar desde la spec
              </p>
              <p className="text-xs text-muted">
                Reescribe SOLO las zonas codegen (<code className="font-mono">site.config.ts</code>,{" "}
                <code className="font-mono">src/generated/</code>,{" "}
                <code className="font-mono">src/collections/</code>,{" "}
                <code className="font-mono">src/seed/</code>) desde la última versión aprobada de
                cada artefacto. Las composiciones de página y cualquier edición humana no se tocan:
                si algo choca, se reporta como conflicto y queda en tus manos (§18.2). Es
                idempotente — sin cambios de spec, no hace nada.
              </p>
              <RegenerateControls
                projectId={projectId}
                enabled={runEnabled}
                disabledReason={disabledReason}
              />
            </div>
          </CardContent>
        </Card>
      ) : allRequiredOk ? (
        /* 5b. Todo listo y sin generación: hero sobrio */
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <FolderGit2 size={22} strokeWidth={1.5} className="text-faint" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-foreground">Listo para generar</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                Se creará un proyecto Next.js + Payload en{" "}
                <code className="font-mono">{cdTarget}</code> con repo git propio: colecciones CMS
                desde el Data Model, navegación desde el sitemap, tokens del Design System y seed de
                contenido. Tarda segundos y no instala dependencias.
              </p>
            </div>
            <GenerateButton
              projectId={projectId}
              enabled={runEnabled}
              disabledReason={disabledReason}
            />
          </CardContent>
        </Card>
      ) : (
        /* 5a. Requisitos sin cumplir: explica qué aprobar primero */
        <EmptyState
          icon={<FolderGit2 size={20} strokeWidth={1.5} aria-hidden />}
          title="Aún no se puede generar"
          description={`La generación se desbloquea cuando los artefactos requeridos están aprobados. Pendientes: ${missingRequired
            .map((req) => req.label)
            .join(", ")}. Edítalos y apruébalos desde Spec OS (checklist de arriba).`}
          action={
            <GenerateButton
              projectId={projectId}
              enabled={false}
              disabledReason={disabledReason}
            />
          }
        />
      )}

      {/* 3. Conflictos de la última generación: UI de primera clase (§18.2) */}
      {latestConflicts.length > 0 ? (
        <Card className="border-accent-warning/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TriangleAlert
                size={15}
                strokeWidth={2}
                className="shrink-0 text-accent-warning"
                aria-hidden
              />
              <div>
                <CardTitle>
                  Conflictos de la última{" "}
                  {latest?.generation.kind === "generate" ? "generación" : "regeneración"} (
                  {latestConflicts.length})
                </CardTitle>
                <CardDescription>
                  El generador marca, nunca resuelve: estos cambios NO se aplicaron y tu trabajo
                  sigue intacto. Resuélvelos en el repo y vuelve a regenerar.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <ConflictList conflicts={latestConflicts} />
        </Card>
      ) : null}

      {/* 4. Historial de generaciones */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de generaciones</CardTitle>
          {history.length > 0 ? (
            <span className="font-mono text-[11px] text-faint tabular-nums">
              {history.length} corrida{history.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </CardHeader>
        {history.length > 0 ? (
          <HistoryTable history={history} now={now} />
        ) : (
          <CardContent>
            <EmptyState
              title="Sin generaciones todavía"
              description="Cada corrida (generación o regeneración) queda registrada aquí con su resultado, commit y actor."
            />
          </CardContent>
        )}
      </Card>
    </main>
  );
}
