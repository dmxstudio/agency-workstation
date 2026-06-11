import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, Map as MapIcon, Palette, TriangleAlert } from "lucide-react";

import {
  flattenSitemap,
  getProjectArtifacts,
  specSitemapPayloadSchema,
  type FlatPage,
  type ProjectArtifact,
} from "@/modules/artifacts";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import {
  Badge,
  Button,
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

import {
  formatBytes,
  loadCompositionData,
  loadSealedPayload,
  type CompositionData,
} from "./_components/queries";
import { SyncCompositionsButton } from "./_components/sync-button";

/**
 * Índice del Visual Studio (§7.4): una fila por página del sitemap APROBADO
 * cruzada con su artefacto `page.composition` (instancia keyed por path).
 * Las composiciones son artefactos de primera clase con el ciclo §13; este
 * índice solo lista y sincroniza — la edición vive en `studio/<key>` y la
 * aprobación en el flujo estándar de artifacts.
 */

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

function isApproved(item: ProjectArtifact): boolean {
  const { status, currentVersion } = item.artifact;
  return (status === "approved" || status === "locked") && currentVersion > 0;
}

function sourceTitle(data: CompositionData): string | undefined {
  if (data.source === "draft") return "Calculado sobre el borrador actual";
  if (data.source === "version")
    return `Calculado sobre la versión sellada v${data.item.artifact.currentVersion}`;
  return undefined;
}

function CompositionCells({
  data,
  editorHref,
}: {
  data: CompositionData | null;
  editorHref: string | null;
}) {
  if (!data) {
    return (
      <>
        <TableCell>
          <Badge>Sin artefacto</Badge>
        </TableCell>
        <TableCell className="text-faint">—</TableCell>
        <TableCell className="text-faint">—</TableCell>
        <TableCell className="text-faint">—</TableCell>
        <TableCell className="text-xs text-faint">Sincroniza para crearlo</TableCell>
      </>
    );
  }
  const { artifact } = data.item;
  return (
    <>
      <TableCell>
        <StatusPill
          status={toArtifactStatus(artifact.status)}
          outdated={artifact.outdated}
          rejected={artifact.rejected}
        />
      </TableCell>
      <TableCell className="font-mono text-[11px] text-faint tabular-nums">
        {artifact.currentVersion > 0 ? `v${artifact.currentVersion}` : "—"}
      </TableCell>
      <TableCell className="tabular-nums" title={sourceTitle(data)}>
        {data.unreadable ? (
          <span
            className="inline-flex items-center gap-1 text-accent-warning"
            title="El payload no valida con ningún schema de composición conocido"
          >
            <TriangleAlert size={12} strokeWidth={2} aria-hidden />
            ilegible
          </span>
        ) : data.sectionCount != null ? (
          data.sectionCount
        ) : (
          <span className="text-faint">—</span>
        )}
      </TableCell>
      <TableCell
        className="font-mono text-[11px] text-muted tabular-nums"
        title={sourceTitle(data)}
      >
        {data.byteSize != null ? formatBytes(data.byteSize) : <span className="text-faint">—</span>}
      </TableCell>
      <TableCell>
        {editorHref ? (
          <Link
            href={editorHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Abrir editor
            <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
          </Link>
        ) : (
          <span className="text-faint">—</span>
        )}
      </TableCell>
    </>
  );
}

export default async function StudioIndexPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId } = await params;
  const basePath = `/w/${slug}/p/${projectId}`;

  // El proxy solo comprueba la cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`${basePath}/studio`)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  const canEdit = membership.role === "admin" || membership.role === "member";
  const syncDisabledReason = canEdit
    ? null
    : "Tu rol no permite sincronizar: requiere admin o member.";

  const items = await getProjectArtifacts(projectId);
  const sitemapItem = items.find(
    (item) => item.artifact.type === "spec.sitemap" && item.artifact.key == null,
  );
  const sitemapApproved = sitemapItem != null && isApproved(sitemapItem);

  // --- Sin sitemap aprobado: el Studio no tiene de qué derivar páginas -----
  if (!sitemapItem || !sitemapApproved) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
        <PageHeader
          eyebrow={project.name}
          title="Studio"
          description="Composición visual de páginas con el component registry (§7.4). Cada página del sitemap es un artefacto page.composition con su propio ciclo draft → in_review → approved."
          meta={<MonoId id={projectId} />}
        />
        <EmptyState
          icon={<MapIcon size={20} strokeWidth={1.5} aria-hidden />}
          title="El Studio necesita un sitemap aprobado"
          description="Las páginas del Studio se derivan del artefacto «Sitemap» (§7.2). Complétalo y apruébalo en Spec OS; después podrás sincronizar una composición por página."
          action={
            sitemapItem ? (
              <Link href={`${basePath}/artifacts/${sitemapItem.artifact.id}`}>
                <Button variant="primary">Abrir Sitemap en Spec OS</Button>
              </Link>
            ) : undefined
          }
        />
      </main>
    );
  }

  // --- Sitemap aprobado: páginas × composiciones ---------------------------
  const sealedSitemap = specSitemapPayloadSchema.parse(
    await loadSealedPayload(sitemapItem.artifact),
  );
  const flatPages: FlatPage[] = flattenSitemap(sealedSitemap.pages);

  const compositions = await loadCompositionData(items);
  const byKey = new Map(compositions.map((data) => [data.key, data]));
  const sitemapKeys = new Set(flatPages.map((page) => page.pagePath));
  const orphans = compositions.filter((data) => !sitemapKeys.has(data.key));
  const legacyKeyless = items.filter(
    (item) => item.artifact.type === "page.composition" && item.artifact.key == null,
  );

  const linked = flatPages.filter((page) => byKey.has(page.pagePath));
  const approvedCount = compositions.filter((data) => isApproved(data.item)).length;
  const missingCount = flatPages.length - linked.length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <PageHeader
        eyebrow={project.name}
        title="Studio"
        description="Composición visual de páginas con el component registry (§7.4). Cada página del sitemap es un artefacto page.composition con su propio ciclo draft → in_review → approved; la aprobación es siempre humana (§13)."
        meta={
          <>
            <Badge tone={approvedCount === compositions.length && compositions.length > 0 ? "success" : "neutral"}>
              {approvedCount}/{compositions.length} aprobadas
            </Badge>
            {missingCount > 0 ? (
              <Badge tone="warning">
                {missingCount} página{missingCount === 1 ? "" : "s"} sin sincronizar
              </Badge>
            ) : null}
            {orphans.length > 0 ? (
              <Badge tone="warning">
                {orphans.length} fuera del sitemap
              </Badge>
            ) : null}
            <span className="font-mono text-[11px] text-faint">
              sitemap v{sitemapItem.artifact.currentVersion}
            </span>
            <MonoId id={projectId} />
          </>
        }
      />

      {/* Sincronización sitemap → composiciones (§8.4: marca, nunca destruye) */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Páginas del sitemap aprobado</CardTitle>
            <CardDescription>
              Sincronizar crea el artefacto de composición de las páginas que falten y marca como
              desactualizadas las composiciones cuya página salió del sitemap — nunca borra ni
              regenera contenido (§8.4).
            </CardDescription>
          </div>
          <SyncCompositionsButton
            projectId={projectId}
            enabled={canEdit}
            disabledReason={syncDisabledReason}
            size="sm"
          />
        </CardHeader>

        {compositions.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={<Palette size={20} strokeWidth={1.5} aria-hidden />}
              title="Sitemap aprobado, sin composiciones todavía"
              description={`El sitemap define ${flatPages.length} página${flatPages.length === 1 ? "" : "s"}. Sincroniza para crear un artefacto page.composition por página (estado inicial: vacío) y empezar a componer en el editor.`}
              action={
                <SyncCompositionsButton
                  projectId={projectId}
                  enabled={canEdit}
                  disabledReason={syncDisabledReason}
                />
              }
            />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clave</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Secciones</TableHead>
                <TableHead>Peso</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flatPages.map((page) => {
                const data = byKey.get(page.pagePath) ?? null;
                return (
                  <TableRow key={page.pagePath}>
                    <TableCell className="font-mono text-xs text-foreground">
                      {page.pagePath}
                    </TableCell>
                    <TableCell className="font-medium">{page.title}</TableCell>
                    <TableCell className="font-mono text-xs text-muted">{page.path}</TableCell>
                    <CompositionCells
                      data={data}
                      editorHref={data ? `${basePath}/studio/${data.key}` : null}
                    />
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {legacyKeyless.length > 0 ? (
          <div className="flex items-start gap-2 border-t border-border px-4 py-2.5">
            <TriangleAlert
              size={14}
              strokeWidth={2}
              className="mt-px shrink-0 text-accent-warning"
              aria-hidden
            />
            <p className="text-xs text-muted">
              Existe una composición legada sin página asignada (modelo anterior a
              multi-instancia). Sincroniza para migrarla a la home si la home aún no tiene
              artefacto propio.
            </p>
          </div>
        ) : null}
      </Card>

      {/* Composiciones huérfanas: páginas que salieron del sitemap (§8.4) */}
      {orphans.length > 0 ? (
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
                <CardTitle>Composiciones fuera del sitemap ({orphans.length})</CardTitle>
                <CardDescription>
                  Sus páginas ya no están en el sitemap aprobado. El sistema las marca como
                  desactualizadas con una tarea derivada, pero nunca las borra: decide tú si
                  restaurar la página en el sitemap o retirar la composición.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clave</TableHead>
                <TableHead>Artefacto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Secciones</TableHead>
                <TableHead>Peso</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orphans.map((data) => (
                <TableRow key={data.key}>
                  <TableCell className="font-mono text-xs text-foreground">{data.key}</TableCell>
                  <TableCell className="font-medium">{data.item.label}</TableCell>
                  <TableCell>
                    <StatusPill
                      status={toArtifactStatus(data.item.artifact.status)}
                      outdated={data.item.artifact.outdated}
                      rejected={data.item.artifact.rejected}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-faint tabular-nums">
                    {data.item.artifact.currentVersion > 0
                      ? `v${data.item.artifact.currentVersion}`
                      : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums" title={sourceTitle(data)}>
                    {data.sectionCount ?? <span className="text-faint">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted tabular-nums">
                    {data.byteSize != null ? (
                      formatBytes(data.byteSize)
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`${basePath}/studio/${data.key}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
                    >
                      Abrir editor
                      <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </main>
  );
}
