import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, TriangleAlert } from "lucide-react";

import {
  cmsCollectionsPayloadSchema,
  designTokensPayloadSchema,
  emptyPageCompositionPayload,
  flattenSitemap,
  isArtifactDomainError,
  pageCompositionPayloadSchema,
  specSitemapPayloadSchema,
  type CmsCollectionsPayload,
  type DesignTokensPayload,
  type PageCompositionPayload,
  type SpecSitemapPayload,
} from "@/modules/artifacts";
import {
  computeDiff,
  getArtifactWithHistory,
  getProjectArtifacts,
  type ProjectArtifact,
} from "@/modules/artifacts/service";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getProjectById } from "@/modules/platform-core/projects";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import { getOpenOutdatedTask } from "@/modules/spec-os/queries";
import {
  buildStudioNavDefaults,
  StudioEditor,
  type StudioArtifactView,
} from "@/modules/studio/editor";
import { getLatestRejectionFeedback } from "@/modules/studio/editor/queries";
import { MonoId, StatusPill } from "@/ui";

import { resolveLiveSiteUrl } from "../_lib/live-site-url";

/**
 * Editor del Visual Studio (§7.4): UNA página del sitemap = UN artefacto
 * `page.composition` keyed por su path (`studio/<key>`, catch-all para paths
 * anidados como `legal/terms`). Server shell: valida sesión + membership,
 * carga el artefacto con historial y los artefactos aprobados que contextúan
 * el canvas (cms.collections → bindings, design.tokens → tokens del iframe,
 * spec.sitemap → defaults de navegación), y compone el island client.
 *
 * El ciclo §13 (draft → in_review → approved, outdated, rechazo) corre por
 * las server actions del módulo artifacts — el Studio no aprueba nada por su
 * cuenta (§19.1) y las versiones selladas son inmutables (§19.2).
 */

/**
 * Última versión APROBADA (sellada) de un artefacto singleton, parseada con
 * su schema; null si no está aprobado/bloqueado o el payload no valida.
 */
async function loadApprovedPayload<T>(
  item: ProjectArtifact | undefined,
  parse: (payload: unknown) => T | null,
): Promise<T | null> {
  if (!item) return null;
  const { status, currentVersion } = item.artifact;
  if ((status !== "approved" && status !== "locked") || currentVersion < 1) return null;
  const history = await getArtifactWithHistory(item.artifact.id);
  const sealed = history.versions.find((version) => version.version === currentVersion);
  return sealed ? parse(sealed.payload) : null;
}

function safeParse<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }) {
  return (payload: unknown): T | null => {
    const result = schema.safeParse(payload);
    return result.success ? (result.data as T) : null;
  };
}

export default async function StudioPageEditorPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string; pageKey: string[] }>;
}) {
  const { slug, projectId, pageKey: pageKeySegments } = await params;
  const pageKey = pageKeySegments.map((segment) => decodeURIComponent(segment)).join("/");
  const basePath = `/w/${slug}/p/${projectId}`;
  const path = `${basePath}/studio/${pageKey}`;

  // El proxy solo comprueba la cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership) notFound();

  const project = await getProjectById(projectId);
  if (!project || project.workspaceId !== membership.workspace.id) notFound();

  // --- artefacto page.composition de esta página (keyed por path, §8.1) -----
  const projectArtifacts = await getProjectArtifacts(projectId);
  const compositionItem = projectArtifacts.find(
    (item) => item.artifact.type === "page.composition" && item.artifact.key === pageKey,
  );
  // Sin artefacto para esta key: el sitemap no incluye la página (o falta el
  // sync de composiciones). La lista de páginas del Studio es la entrada.
  if (!compositionItem) notFound();

  let history;
  try {
    history = await getArtifactWithHistory(compositionItem.artifact.id);
  } catch (error) {
    if (isArtifactDomainError(error) && error.code === "ARTIFACT_NOT_FOUND") notFound();
    throw error;
  }
  const { artifact } = history;

  // --- contexto aprobado del proyecto ---------------------------------------
  const byType = (type: string) =>
    projectArtifacts.find((item) => item.artifact.type === type);
  const cmsItem = byType("cms.collections");
  const tokensItem = byType("design.tokens");
  const sitemapItem = byType("spec.sitemap");

  const [cmsCollections, designTokens, sitemap, diff, outdatedTask, rejectionFeedback] =
    await Promise.all([
      loadApprovedPayload<CmsCollectionsPayload>(
        cmsItem,
        safeParse<CmsCollectionsPayload>(cmsCollectionsPayloadSchema),
      ),
      loadApprovedPayload<DesignTokensPayload>(
        tokensItem,
        safeParse<DesignTokensPayload>(designTokensPayloadSchema),
      ),
      loadApprovedPayload<SpecSitemapPayload>(
        sitemapItem,
        safeParse<SpecSitemapPayload>(specSitemapPayloadSchema),
      ),
      computeDiff(artifact.id),
      artifact.outdated
        ? getOpenOutdatedTask(projectId, artifact.id)
        : Promise.resolve(null),
      artifact.rejected ? getLatestRejectionFeedback(artifact.id) : Promise.resolve(null),
    ]);

  // --- data inicial del canvas: draft ?? última aprobada ?? Data vacío ------
  const sealedPayload =
    history.versions.find((version) => version.version === artifact.currentVersion)?.payload ??
    null;
  const rawInitial = artifact.draftPayload ?? sealedPayload;
  const parsedInitial = rawInitial != null ? pageCompositionPayloadSchema.safeParse(rawInitial) : null;
  const initialData: PageCompositionPayload = parsedInitial?.success
    ? parsedInitial.data
    : emptyPageCompositionPayload();
  /** Contenido persistido que NO es Data v2 (p.ej. legado 1.0 migrado a la home). */
  const unreadableContent = rawInitial != null && !(parsedInitial?.success ?? false);

  // --- metadatos de pantalla -------------------------------------------------
  const flatPages = sitemap ? flattenSitemap(sitemap.pages) : [];
  const flatPage = flatPages.find((page) => page.pagePath === pageKey);
  const pagePath = flatPage?.path ?? `/${pageKey}`;
  const label = compositionItem.label;

  const nav = buildStudioNavDefaults(project.name, sitemap);

  // Dependencias upstream (§8.4) para el banner de outdated, con la versión
  // actual de cada una ("cms.collections v3: revisa bindings").
  const byId = new Map(projectArtifacts.map((item) => [item.artifact.id, item]));
  const upstream = compositionItem.dependsOnIds
    .map((id) => byId.get(id))
    .filter((item): item is ProjectArtifact => item != null);

  const canEdit = membership.role === "admin" || membership.role === "member";

  const artifactView: StudioArtifactView = {
    id: artifact.id,
    pageKey,
    label,
    status: artifact.status,
    outdated: artifact.outdated,
    rejected: artifact.rejected,
    currentVersion: artifact.currentVersion,
    lockedBy: artifact.lockedBy,
    hasDraft: artifact.draftPayload != null,
  };

  const artifactHref = `${basePath}/artifacts/${artifact.id}`;
  const cmsArtifactHref = cmsItem ? `${basePath}/artifacts/${cmsItem.artifact.id}` : null;

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      {/* Header denso (§11.4): identidad del artefacto + estado, sin robar canvas */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-2">
        <Link
          href={`${basePath}/studio`}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={12} aria-hidden />
          Studio
        </Link>
        <span className="text-faint" aria-hidden>
          /
        </span>
        <h1 className="text-sm font-semibold tracking-tight text-foreground">{label}</h1>
        <span className="font-mono text-[11px] text-muted">{pagePath}</span>
        <StatusPill
          status={artifact.status}
          outdated={artifact.outdated}
          rejected={artifact.rejected}
        />
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {artifact.currentVersion > 0 ? `v${artifact.currentVersion}` : "v0"}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <MonoId id={artifact.id} />
          <Link
            href={artifactHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Vista de artefacto
            <ArrowUpRight size={12} aria-hidden />
          </Link>
        </div>
      </header>

      {/* Banner ámbar §8.4: una dependencia cambió — marca, nunca regenera */}
      {artifact.outdated ? (
        <div className="border-b border-accent-warning/40 bg-accent-warning/10 px-4 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-accent-warning">
            <TriangleAlert size={13} aria-hidden />
            Desactualizada: una dependencia cambió. Revisa la composición (especialmente los
            bindings) y revalida o guarda una nueva versión.
          </p>
          {outdatedTask ? <p className="mt-0.5 text-xs text-muted">{outdatedTask.title}</p> : null}
          {upstream.length > 0 ? (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {upstream.map((item) => (
                <li key={item.artifact.id} className="text-xs text-muted">
                  <Link
                    href={`${basePath}/artifacts/${item.artifact.id}`}
                    className="text-foreground underline-offset-2 hover:underline"
                  >
                    {item.label}
                  </Link>{" "}
                  <span className="font-mono tabular-nums">v{item.artifact.currentVersion}</span>
                  {item.artifact.type === "cms.collections" ? (
                    <span className="text-faint"> · revisa bindings</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Banner rose: la última revisión fue rechazada (feedback del audit log) */}
      {artifact.rejected ? (
        <div className="border-b border-accent-danger/40 bg-accent-danger/10 px-4 py-2">
          <p className="text-xs font-medium text-accent-danger">
            La última revisión fue rechazada.
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {rejectionFeedback
              ? `Feedback: ${rejectionFeedback}`
              : "El feedback quedó registrado en la actividad del proyecto."}{" "}
            Corrige el borrador y vuelve a enviarlo a revisión.
          </p>
        </div>
      ) : null}

      {/* Banner: contenido persistido ilegible como Data v2 (legado 1.0) */}
      {unreadableContent ? (
        <div className="border-b border-accent-warning/40 bg-accent-warning/10 px-4 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-accent-warning">
            <TriangleAlert size={13} aria-hidden />
            El contenido guardado usa el formato antiguo (1.0) y no puede abrirse en el canvas.
          </p>
          <p className="mt-0.5 text-xs text-muted">
            El canvas parte vacío; el contenido legado sigue intacto en el historial del
            artefacto. Al guardar, el borrador pasará al formato nuevo (Data de Puck).
          </p>
        </div>
      ) : null}

      <StudioEditor
        artifact={artifactView}
        initialData={initialData}
        canEdit={canEdit}
        cmsCollections={cmsCollections}
        designTokens={designTokens}
        nav={nav}
        initialDiff={diff}
        versionNumbers={history.versions.map((version) => version.version)}
        pagePath={pagePath}
        siteUrl={(await resolveLiveSiteUrl(projectId))?.url ?? null}
        artifactHref={artifactHref}
        cmsArtifactHref={cmsArtifactHref}
      />
    </div>
  );
}
