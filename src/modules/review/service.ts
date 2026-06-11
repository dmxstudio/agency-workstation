import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, like } from "drizzle-orm";

import { getDb, type Db } from "@/db/client";
import { newId } from "@/db/ids";
import {
  artifacts,
  artifactVersions,
  clientApprovals,
  projects,
  reviewComments,
  reviewRequests,
  tasks,
  users,
  type Artifact,
  type ArtifactVersion,
  type ClientApproval,
  type Project,
  type ReviewComment,
  type ReviewRequest,
  type WorkspaceRole,
} from "@/db/schema";
import {
  approve,
  flattenSitemap,
  getProjectArtifacts,
  pageCompositionDefinition,
  pageCompositionPayloadSchema,
  releasePayloadSchema,
  saveDraft,
  specSitemapPayloadSchema,
  submitForReview,
  validateCompositionBindings,
  type BindingConflict,
  type CmsCollectionsPayload,
  type ProjectArtifact,
  type ReleaseChecklistItem,
  type ReleasePayload,
} from "@/modules/artifacts";
import {
  getGenerationRequirements,
  getGenerations,
  getProjectRepoDir,
  gitTag,
  hasManifest,
} from "@/modules/generator";
import { logAudit } from "@/modules/platform-core/audit";

import { ReviewDomainError } from "./errors";

/**
 * Review & Release domain service (§7.7, §7.8, §8.5, §12.2).
 *
 * Hard guarantees, by construction:
 * - A RELEASE is an immutable version of the singleton `release` artifact,
 *   sealed through the artifacts service cycle (saveDraft → submitForReview →
 *   approve): origin `human`, audit log, version immutability — all inherited.
 *   `createRelease` additionally requires the §7.8 checklist all-green and a
 *   human with role admin|member (no deploy path exists without it, §13).
 * - CLIENT approvals are a DISTINCT type (§8.5): rows in `client_approvals`
 *   anchored to a review round + release version. They NEVER transition
 *   internal artifacts — there is no code path from here to `approve()` that
 *   a token could reach.
 * - Clients access through a TOKEN LINK (no account, R8): every public entry
 *   point validates the token against the DB; client identity is the link
 *   label + the name they type.
 * - An open client comment derives a task (§12.2, dedupeKey per comment);
 *   resolving the comment closes it. Every mutation writes an audit entry.
 */

// ---------------------------------------------------------------------------
// Actor (same shape as the artifacts/generator modules: a human session user)
// ---------------------------------------------------------------------------

export interface HumanActor {
  id: string; // usr_
  role: WorkspaceRole;
  workspaceId: string;
}

const EDITOR_ROLES: readonly WorkspaceRole[] = ["admin", "member"];

function assertEditor(actor: HumanActor, action: string): void {
  if (!EDITOR_ROLES.includes(actor.role)) {
    throw new ReviewDomainError(
      "FORBIDDEN",
      `No tienes permisos para ${action}: requiere rol admin o member.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function loadProject(db: Db, projectId: string): Promise<Project> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  const project = rows[0];
  if (!project) {
    throw new ReviewDomainError("PROJECT_NOT_FOUND", "El proyecto no existe.");
  }
  return project;
}

function assertSameWorkspace(project: Project, actor: HumanActor): void {
  if (project.workspaceId !== actor.workspaceId) {
    throw new ReviewDomainError(
      "FORBIDDEN",
      "El proyecto no pertenece a tu workspace activo.",
    );
  }
}

/** Sealed = approved (or locked) with at least one immutable version. */
function isSealed(artifact: Artifact | undefined | null): artifact is Artifact {
  if (!artifact) return false;
  return (
    (artifact.status === "approved" || artifact.status === "locked") &&
    artifact.currentVersion > 0
  );
}

function singleton(items: ProjectArtifact[], type: string): ProjectArtifact | undefined {
  return items.find((item) => item.artifact.type === type && item.artifact.key == null);
}

/** Loads the payload of a sealed (immutable) artifact version. */
async function loadSealedPayload(
  db: Db,
  artifactId: string,
  version: number,
): Promise<unknown> {
  const rows = await db
    .select({ payload: artifactVersions.payload })
    .from(artifactVersions)
    .where(
      and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.version, version)),
    )
    .limit(1);
  if (!rows[0]) {
    throw new ReviewDomainError(
      "RELEASE_NOT_FOUND",
      `No existe la versión sellada v${version} del artefacto.`,
    );
  }
  return rows[0].payload;
}

/** Release artifact row (singleton `release`) of a project, or throws. */
async function loadReleaseArtifact(db: Db, projectId: string): Promise<Artifact> {
  const rows = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.projectId, projectId),
        eq(artifacts.type, "release"),
        isNull(artifacts.key),
        isNull(artifacts.deletedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new ReviewDomainError(
      "RELEASE_NOT_FOUND",
      "El proyecto no tiene artefacto release; instancia el grafo de artefactos primero.",
    );
  }
  return rows[0];
}

/** Sealed release payload (schema 2.0) for a concrete release version. */
async function loadReleasePayload(
  db: Db,
  projectId: string,
  releaseVersion: number,
): Promise<{ artifact: Artifact; payload: ReleasePayload }> {
  const artifact = await loadReleaseArtifact(db, projectId);
  const raw = await loadSealedPayload(db, artifact.id, releaseVersion);
  const parsed = releasePayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReviewDomainError(
      "INVALID_STATE",
      `La versión v${releaseVersion} del release no cumple el schema actual (¿release legado?).`,
    );
  }
  return { artifact, payload: parsed.data };
}

// --- derived tasks (§12.2) — same semantics as the artifacts module ---------

const clientCommentTaskKey = (commentId: string) => `client-comment:${commentId}`;

interface DerivedTaskInput {
  projectId: string;
  title: string;
  artifactId: string | null;
  dedupeKey: string;
}

async function openDerivedTask(db: Db, input: DerivedTaskInput): Promise<void> {
  const existing = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, input.projectId),
        eq(tasks.dedupeKey, input.dedupeKey),
        isNull(tasks.deletedAt),
      ),
    )
    .limit(1);
  const row = existing[0];
  if (row) {
    if (row.status !== "open") {
      await db
        .update(tasks)
        .set({ status: "open", title: input.title, updatedAt: new Date() })
        .where(eq(tasks.id, row.id));
    }
    return;
  }
  await db.insert(tasks).values({
    id: newId.task(),
    projectId: input.projectId,
    kind: "derived",
    title: input.title,
    status: "open",
    assigneeId: null,
    artifactId: input.artifactId,
    dedupeKey: input.dedupeKey,
  });
}

async function closeDerivedTask(db: Db, projectId: string, dedupeKey: string): Promise<void> {
  await db
    .update(tasks)
    .set({ status: "done", updatedAt: new Date() })
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.dedupeKey, dedupeKey),
        eq(tasks.status, "open"),
        isNull(tasks.deletedAt),
      ),
    );
}

// ---------------------------------------------------------------------------
// runReleaseChecklist (§7.8)
// ---------------------------------------------------------------------------

/** Stable keys of the §7.8 release checklist, in evaluation order. */
export const RELEASE_CHECKLIST_KEYS = [
  "generator-inputs-approved",
  "compositions-approved",
  "bindings-valid",
  "generation-up-to-date",
  "no-pending-outdated",
] as const;

export type ReleaseChecklistKey = (typeof RELEASE_CHECKLIST_KEYS)[number];

/**
 * Automatic validations of the release checklist (§7.8). Pure READ — it never
 * mutates anything; `createRelease` requires every item `ok` plus the human
 * confirmation (role admin|member).
 *
 * Deliberately NOT included: the production build of the generated repo —
 * that is validated by the DeployProvider when it builds the release.
 */
export async function runReleaseChecklist(
  projectId: string,
): Promise<ReleaseChecklistItem[]> {
  const db = getDb();
  await loadProject(db, projectId);
  const items = await getProjectArtifacts(projectId);
  const requirements = await getGenerationRequirements(projectId);
  const checklist: ReleaseChecklistItem[] = [];

  // 1. Required generator inputs approved (spec.sitemap, cms.collections,
  //    design.tokens — the same gate the generator enforces).
  const missingInputs = requirements.filter((req) => req.required && !req.ok);
  checklist.push({
    key: "generator-inputs-approved",
    label: "Artefactos base del generador aprobados (sitemap, CMS y tokens)",
    ok: missingInputs.length === 0,
    detail:
      missingInputs.length > 0
        ? `Sin aprobar: ${missingInputs.map((req) => req.label).join(", ")}.`
        : null,
  });

  // 2. Every page of the APPROVED sitemap has an approved composition.
  const sitemapItem = singleton(items, "spec.sitemap");
  const compositionsByKey = new Map(
    items
      .filter(
        (item) =>
          item.artifact.type === pageCompositionDefinition.type && item.artifact.key != null,
      )
      .map((item) => [item.artifact.key as string, item]),
  );
  if (!sitemapItem || !isSealed(sitemapItem.artifact)) {
    checklist.push({
      key: "compositions-approved",
      label: "Todas las composiciones del sitemap aprobadas",
      ok: false,
      detail: "El sitemap no está aprobado; no hay páginas que validar.",
    });
  } else {
    const sitemapPayload = specSitemapPayloadSchema.parse(
      await loadSealedPayload(db, sitemapItem.artifact.id, sitemapItem.artifact.currentVersion),
    );
    const flatPages = flattenSitemap(sitemapPayload.pages);
    const pending = flatPages.filter(
      (page) => !isSealed(compositionsByKey.get(page.pagePath)?.artifact ?? null),
    );
    checklist.push({
      key: "compositions-approved",
      label: "Todas las composiciones del sitemap aprobadas",
      ok: pending.length === 0,
      detail:
        pending.length > 0
          ? `Sin aprobar: ${pending.map((page) => page.pagePath).join(", ")}.`
          : null,
    });
  }

  // 3. Zero broken CMS bindings across the approved compositions.
  const cmsItem = singleton(items, "cms.collections");
  if (!cmsItem || !isSealed(cmsItem.artifact)) {
    checklist.push({
      key: "bindings-valid",
      label: "Sin bindings CMS rotos en las composiciones",
      ok: false,
      detail: "El modelo CMS no está aprobado; no se pueden validar los bindings.",
    });
  } else {
    const collections = (await loadSealedPayload(
      db,
      cmsItem.artifact.id,
      cmsItem.artifact.currentVersion,
    )) as CmsCollectionsPayload;
    const conflicts: BindingConflict[] = [];
    for (const [key, item] of compositionsByKey) {
      if (!isSealed(item.artifact)) continue;
      // Legacy-schema compositions are covered by their own outdated task (item 5).
      if (item.artifact.schemaVersion !== pageCompositionDefinition.schemaVersion) continue;
      const composition = pageCompositionPayloadSchema.parse(
        await loadSealedPayload(db, item.artifact.id, item.artifact.currentVersion),
      );
      conflicts.push(...validateCompositionBindings(composition, collections, key));
    }
    checklist.push({
      key: "bindings-valid",
      label: "Sin bindings CMS rotos en las composiciones",
      ok: conflicts.length === 0,
      detail:
        conflicts.length > 0
          ? `${conflicts.length} binding(s) rotos: ${conflicts
              .map((c) => `${c.page} › ${c.sectionId} › ${c.prop} (${c.binding})`)
              .join("; ")}.`
          : null,
    });
  }

  // 4. Generation up to date: the repo exists and the LAST run ended clean.
  const repoDir = getProjectRepoDir(projectId);
  if (!hasManifest(repoDir)) {
    checklist.push({
      key: "generation-up-to-date",
      label: "Proyecto generado y sin conflictos en la última generación",
      ok: false,
      detail: "El proyecto aún no fue generado; ejecuta la generación inicial.",
    });
  } else {
    const [last] = await getGenerations(projectId, 1);
    const lastStatus = last?.generation.status ?? "success";
    checklist.push({
      key: "generation-up-to-date",
      label: "Proyecto generado y sin conflictos en la última generación",
      ok: lastStatus === "success",
      detail:
        lastStatus === "success"
          ? null
          : `La última generación terminó con estado «${lastStatus}»; resuélvelo y regenera.`,
    });
  }

  // 5. No open re-validation (outdated) tasks — EXCEPT the release artifact's
  //    own one: "release outdated" means newer inputs exist, which is exactly
  //    what creating this release resolves.
  const releaseItem = singleton(items, "release");
  const openOutdated = await db
    .select({ title: tasks.title, dedupeKey: tasks.dedupeKey })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.kind, "derived"),
        eq(tasks.status, "open"),
        like(tasks.dedupeKey, "outdated:%"),
        isNull(tasks.deletedAt),
      ),
    );
  const blocking = openOutdated.filter(
    (task) =>
      releaseItem == null || task.dedupeKey !== `outdated:${releaseItem.artifact.id}`,
  );
  checklist.push({
    key: "no-pending-outdated",
    label: "Sin re-validaciones pendientes (artefactos outdated)",
    ok: blocking.length === 0,
    detail:
      blocking.length > 0
        ? `Tareas abiertas: ${blocking.map((task) => task.title).join("; ")}.`
        : null,
  });

  return checklist;
}

// ---------------------------------------------------------------------------
// createRelease (§7.8)
// ---------------------------------------------------------------------------

export interface CreateReleaseResult {
  artifact: Artifact;
  /** The immutable version that IS the release. */
  version: ArtifactVersion;
  payload: ReleasePayload;
  checklist: ReleaseChecklistItem[];
  gitTag: string;
  /** Commit of the generated repo the tag points at. */
  taggedCommit: string;
}

/**
 * Creates release N: checklist §7.8 all-green + explicit confirmation by a
 * human with role admin|member (the call itself is the confirmation). Seals
 * the snapshot as an immutable version of the `release` artifact THROUGH the
 * artifacts service (saveDraft → submitForReview → approve: Zod on write,
 * origin human, approval row, audit) and tags the generated repo `release-N`.
 *
 * Not transactional across modules by design: if it fails midway the release
 * artifact is left in `draft`/`in_review`, visible and resolvable from the
 * Cockpit — nothing is ever half-sealed (versions are atomic inserts).
 */
export async function createRelease(
  projectId: string,
  notes: string,
  actor: HumanActor,
): Promise<CreateReleaseResult> {
  assertEditor(actor, "crear un release");
  const db = getDb();
  const project = await loadProject(db, projectId);
  assertSameWorkspace(project, actor);

  const checklist = await runReleaseChecklist(projectId);
  const failing = checklist.filter((item) => !item.ok);
  if (failing.length > 0) {
    throw new ReviewDomainError(
      "CHECKLIST_NOT_PASSED",
      `El checklist de release no está en verde: ${failing
        .map((item) => item.label)
        .join("; ")}.`,
      { checklist },
    );
  }

  // --- snapshot of sealed input versions ------------------------------------
  const items = await getProjectArtifacts(projectId);
  const sitemapItem = singleton(items, "spec.sitemap")!;
  const cmsItem = singleton(items, "cms.collections")!;
  const tokensItem = singleton(items, "design.tokens")!;
  const contentItem = singleton(items, "content.page");
  const releaseArtifact = await loadReleaseArtifact(db, projectId);

  const sitemapPayload = specSitemapPayloadSchema.parse(
    await loadSealedPayload(db, sitemapItem.artifact.id, sitemapItem.artifact.currentVersion),
  );
  const compositionsByKey = new Map(
    items
      .filter(
        (item) =>
          item.artifact.type === pageCompositionDefinition.type && item.artifact.key != null,
      )
      .map((item) => [item.artifact.key as string, item]),
  );
  const compositions: Record<string, number> = {};
  for (const page of flattenSitemap(sitemapPayload.pages)) {
    const item = compositionsByKey.get(page.pagePath);
    // Guaranteed by the checklist; defensive guard against races.
    if (!item || !isSealed(item.artifact)) {
      throw new ReviewDomainError(
        "INVALID_STATE",
        `La composición de «${page.pagePath}» dejó de estar aprobada durante la creación del release.`,
      );
    }
    compositions[page.pagePath] = item.artifact.currentVersion;
  }

  const releaseNumber = releaseArtifact.currentVersion + 1;
  const tagName = `release-${releaseNumber}`;
  const payload: ReleasePayload = {
    releaseNumber,
    gitTag: tagName,
    versions: {
      sitemap: sitemapItem.artifact.currentVersion,
      cms: cmsItem.artifact.currentVersion,
      content: contentItem && isSealed(contentItem.artifact)
        ? contentItem.artifact.currentVersion
        : 0,
      tokens: tokensItem.artifact.currentVersion,
      compositions,
    },
    checklist,
    notes: notes.trim(),
  };

  // --- seal through the artifacts service (immutable version, audit) --------
  await saveDraft(releaseArtifact.id, payload, actor);
  await submitForReview(releaseArtifact.id, actor);
  const sealed = await approve(
    releaseArtifact.id,
    actor,
    `Release v${releaseNumber} (${tagName}) — checklist §7.8 confirmado`,
  );
  if (sealed.version.version !== releaseNumber) {
    throw new ReviewDomainError(
      "INVALID_STATE",
      `Conflicto de concurrencia: el release se selló como v${sealed.version.version}, no v${releaseNumber}.`,
    );
  }

  // --- git tag on the generated repo (exists: checklist item 4) -------------
  const taggedCommit = await gitTag(getProjectRepoDir(projectId), tagName);

  await logAudit({
    workspaceId: project.workspaceId,
    projectId,
    actorId: actor.id,
    action: "release.created",
    entityType: "release",
    entityId: sealed.version.id,
    detail: {
      releaseNumber,
      releaseVersion: sealed.version.version,
      gitTag: tagName,
      taggedCommit,
      versions: payload.versions,
    },
  });

  return {
    artifact: sealed.artifact,
    version: sealed.version,
    payload,
    checklist,
    gitTag: tagName,
    taggedCommit,
  };
}

// ---------------------------------------------------------------------------
// Review rounds (§7.7)
// ---------------------------------------------------------------------------

/** URL-safe random client token (32 chars, link auth — R8). */
function newReviewToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Opens a review round over a SEALED release version and mints its client
 * token. The label identifies the link/round (it is also the client-side
 * identity anchor, R8).
 */
export async function createReviewRequest(
  projectId: string,
  releaseVersion: number,
  label: string,
  actor: HumanActor,
): Promise<ReviewRequest> {
  assertEditor(actor, "crear rondas de revisión");
  const trimmedLabel = label.trim();
  if (trimmedLabel === "") {
    throw new ReviewDomainError(
      "VALIDATION_FAILED",
      "La ronda de revisión necesita una etiqueta (p.ej. «Cliente Acme — ronda 1»).",
    );
  }
  const db = getDb();
  const project = await loadProject(db, projectId);
  assertSameWorkspace(project, actor);
  // Validates the release version exists and is readable under schema 2.0.
  await loadReleasePayload(db, projectId, releaseVersion);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(reviewRequests)
      .values({
        id: newId.reviewRequest(),
        projectId,
        releaseVersion,
        token: newReviewToken(),
        label: trimmedLabel,
        status: "open",
        createdBy: actor.id,
      })
      .returning();
    const request = inserted[0];

    await logAudit(
      {
        workspaceId: project.workspaceId,
        projectId,
        actorId: actor.id,
        action: "review.request_created",
        entityType: "review_request",
        entityId: request.id,
        detail: { releaseVersion, label: trimmedLabel },
      },
      tx,
    );

    return request;
  });
}

export interface ReviewRequestSummary {
  /** Full row — includes the token (internal surface needs it for the link). */
  request: ReviewRequest;
  commentCount: number;
  openCommentCount: number;
  approvalCount: number;
}

/** Review rounds of a project with comment/approval counters, newest first. */
export async function listReviewRequests(projectId: string): Promise<ReviewRequestSummary[]> {
  const db = getDb();
  const requests = await db
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.projectId, projectId))
    .orderBy(desc(reviewRequests.createdAt));
  if (requests.length === 0) return [];

  const ids = requests.map((request) => request.id);
  const [commentRows, approvalRows] = await Promise.all([
    db
      .select({ requestId: reviewComments.requestId, status: reviewComments.status })
      .from(reviewComments)
      .where(inArray(reviewComments.requestId, ids)),
    db
      .select({ requestId: clientApprovals.requestId })
      .from(clientApprovals)
      .where(inArray(clientApprovals.requestId, ids)),
  ]);

  return requests.map((request) => ({
    request,
    commentCount: commentRows.filter((row) => row.requestId === request.id).length,
    openCommentCount: commentRows.filter(
      (row) => row.requestId === request.id && row.status === "open",
    ).length,
    approvalCount: approvalRows.filter((row) => row.requestId === request.id).length,
  }));
}

// ---------------------------------------------------------------------------
// Public client surface (token-validated; NO session)
// ---------------------------------------------------------------------------

interface RequestContext {
  request: ReviewRequest;
  project: Project;
}

/** Resolves a token against the DB. The token is the WHOLE credential. */
async function loadRequestByToken(db: Db, token: string): Promise<RequestContext> {
  const trimmed = token.trim();
  if (trimmed === "") {
    throw new ReviewDomainError("INVALID_TOKEN", "El enlace de revisión no es válido.");
  }
  const rows = await db
    .select({ request: reviewRequests, project: projects })
    .from(reviewRequests)
    .innerJoin(projects, eq(reviewRequests.projectId, projects.id))
    .where(and(eq(reviewRequests.token, trimmed), isNull(projects.deletedAt)))
    .limit(1);
  if (!rows[0]) {
    throw new ReviewDomainError("INVALID_TOKEN", "El enlace de revisión no es válido.");
  }
  return rows[0];
}

function assertOpenRound(request: ReviewRequest): void {
  if (request.status !== "open") {
    throw new ReviewDomainError(
      "INVALID_STATE",
      "Esta ronda de revisión está cerrada; pide a la agencia un nuevo enlace.",
    );
  }
}

export interface ReviewPage {
  /** Instance key of the page (`home`, `legal/terms`). */
  pageKey: string;
  /** URL path inside the deployed site (iframe target), e.g. `/legal/terms`. */
  path: string;
  title: string;
  /** Sealed `page.composition` version included in the release. */
  compositionVersion: number;
}

/** Everything the client review surface shows. NEVER exposes internal artifacts. */
export interface ReviewSurface {
  request: {
    id: string;
    label: string;
    status: ReviewRequest["status"];
    releaseVersion: number;
    createdAt: Date;
    closedAt: Date | null;
  };
  project: { id: string; name: string };
  release: { releaseNumber: number; gitTag: string; notes: string };
  pages: ReviewPage[];
  comments: ReviewComment[];
  approvals: ClientApproval[];
}

/**
 * PUBLIC read (no session): the whole review round behind a token — release
 * pages (sealed composition versions), comment threads and client approvals.
 * Closed rounds stay readable; mutations require an open round.
 */
export async function getReviewByToken(token: string): Promise<ReviewSurface> {
  const db = getDb();
  const { request, project } = await loadRequestByToken(db, token);
  const { payload } = await loadReleasePayload(db, project.id, request.releaseVersion);

  // Page titles/paths come from the SAME sealed sitemap the release froze.
  const sitemapArtifactRows = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.projectId, project.id),
        eq(artifacts.type, "spec.sitemap"),
        isNull(artifacts.key),
        isNull(artifacts.deletedAt),
      ),
    )
    .limit(1);
  const flatByKey = new Map<string, { title: string; path: string }>();
  if (sitemapArtifactRows[0]) {
    const sitemapRaw = await loadSealedPayload(
      db,
      sitemapArtifactRows[0].id,
      payload.versions.sitemap,
    );
    const sitemap = specSitemapPayloadSchema.safeParse(sitemapRaw);
    if (sitemap.success) {
      for (const page of flattenSitemap(sitemap.data.pages)) {
        flatByKey.set(page.pagePath, { title: page.title, path: page.path });
      }
    }
  }

  const pages: ReviewPage[] = Object.entries(payload.versions.compositions)
    .map(([pageKey, compositionVersion]) => ({
      pageKey,
      path: flatByKey.get(pageKey)?.path ?? `/${pageKey}`,
      title: flatByKey.get(pageKey)?.title ?? pageKey,
      compositionVersion,
    }))
    .sort((a, b) => a.pageKey.localeCompare(b.pageKey));

  const [comments, approvals] = await Promise.all([
    db
      .select()
      .from(reviewComments)
      .where(eq(reviewComments.requestId, request.id))
      .orderBy(asc(reviewComments.createdAt), asc(reviewComments.id)),
    db
      .select()
      .from(clientApprovals)
      .where(eq(clientApprovals.requestId, request.id))
      .orderBy(asc(clientApprovals.createdAt), asc(clientApprovals.id)),
  ]);

  return {
    request: {
      id: request.id,
      label: request.label,
      status: request.status,
      releaseVersion: request.releaseVersion,
      createdAt: request.createdAt,
      closedAt: request.closedAt,
    },
    project: { id: project.id, name: project.name },
    release: {
      releaseNumber: payload.releaseNumber,
      gitTag: payload.gitTag,
      notes: payload.notes,
    },
    pages,
    comments,
    approvals,
  };
}

// ---------------------------------------------------------------------------
// Comments (§7.7: anchored to page + section, threaded, open/resolved)
// ---------------------------------------------------------------------------

interface CommentTarget {
  pageKey: string;
  sectionId?: string | null;
  parentId?: string | null;
}

async function validateCommentTarget(
  db: Db,
  request: ReviewRequest,
  payload: ReleasePayload,
  target: CommentTarget,
): Promise<void> {
  if (!(target.pageKey in payload.versions.compositions)) {
    throw new ReviewDomainError(
      "VALIDATION_FAILED",
      `La página «${target.pageKey}» no forma parte de este release.`,
    );
  }
  if (target.parentId) {
    const parentRows = await db
      .select({ id: reviewComments.id, requestId: reviewComments.requestId })
      .from(reviewComments)
      .where(eq(reviewComments.id, target.parentId))
      .limit(1);
    if (!parentRows[0] || parentRows[0].requestId !== request.id) {
      throw new ReviewDomainError(
        "COMMENT_NOT_FOUND",
        "El comentario al que respondes no existe en esta ronda.",
      );
    }
  }
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new ReviewDomainError("VALIDATION_FAILED", message);
  }
  return trimmed;
}

export interface AddClientCommentInput extends CommentTarget {
  /** Name the client types — their identity, together with the link label (R8). */
  authorName: string;
  body: string;
}

/**
 * PUBLIC (token): adds a CLIENT comment to an open round and derives the
 * resolution task "Resolver comentario de cliente en <página>" (§12.2,
 * dedupeKey per comment — closed when the comment is resolved).
 */
export async function addClientComment(
  token: string,
  input: AddClientCommentInput,
): Promise<ReviewComment> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const { request, project } = await loadRequestByToken(tx, token);
    assertOpenRound(request);
    const { payload } = await loadReleasePayload(tx, project.id, request.releaseVersion);
    await validateCommentTarget(tx, request, payload, input);
    const authorName = requireText(input.authorName, "Escribe tu nombre para comentar.");
    const body = requireText(input.body, "El comentario no puede estar vacío.");

    const inserted = await tx
      .insert(reviewComments)
      .values({
        id: newId.reviewComment(),
        requestId: request.id,
        pageKey: input.pageKey,
        sectionId: input.sectionId ?? null,
        parentId: input.parentId ?? null,
        authorKind: "client",
        authorName,
        authorUserId: null,
        body,
        status: "open",
      })
      .returning();
    const comment = inserted[0];

    // §12.2: open client comment → derived resolution task for the team.
    const compositionRows = await tx
      .select({ id: artifacts.id, label: artifacts.label })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.projectId, project.id),
          eq(artifacts.type, pageCompositionDefinition.type),
          eq(artifacts.key, input.pageKey),
          isNull(artifacts.deletedAt),
        ),
      )
      .limit(1);
    const composition = compositionRows[0];
    const pageLabel = composition?.label ?? input.pageKey;
    await openDerivedTask(tx, {
      projectId: project.id,
      title: `Resolver comentario de cliente en «${pageLabel}» (ronda «${request.label}»)`,
      artifactId: composition?.id ?? null,
      dedupeKey: clientCommentTaskKey(comment.id),
    });

    await logAudit(
      {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: null, // the client is not a platform user (token link, R8)
        action: "review.comment_added",
        entityType: "review_comment",
        entityId: comment.id,
        detail: {
          requestId: request.id,
          pageKey: input.pageKey,
          sectionId: input.sectionId ?? null,
          parentId: input.parentId ?? null,
          authorKind: "client",
          authorName,
        },
      },
      tx,
    );

    return comment;
  });
}

export interface AddTeamCommentInput extends CommentTarget {
  body: string;
}

/**
 * INTERNAL (session + role): adds a TEAM comment/reply to an open round.
 * Team comments never derive tasks (§12.2 derives only from client comments).
 */
export async function addTeamComment(
  requestId: string,
  input: AddTeamCommentInput,
  actor: HumanActor,
): Promise<ReviewComment> {
  assertEditor(actor, "comentar en rondas de revisión");
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ request: reviewRequests, project: projects })
      .from(reviewRequests)
      .innerJoin(projects, eq(reviewRequests.projectId, projects.id))
      .where(and(eq(reviewRequests.id, requestId), isNull(projects.deletedAt)))
      .limit(1);
    if (!rows[0]) {
      throw new ReviewDomainError("REQUEST_NOT_FOUND", "La ronda de revisión no existe.");
    }
    const { request, project } = rows[0];
    assertSameWorkspace(project, actor);
    assertOpenRound(request);
    const { payload } = await loadReleasePayload(tx, project.id, request.releaseVersion);
    await validateCommentTarget(tx, request, payload, input);
    const body = requireText(input.body, "El comentario no puede estar vacío.");

    const userRows = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    const authorName = userRows[0]?.name ?? "Equipo";

    const inserted = await tx
      .insert(reviewComments)
      .values({
        id: newId.reviewComment(),
        requestId: request.id,
        pageKey: input.pageKey,
        sectionId: input.sectionId ?? null,
        parentId: input.parentId ?? null,
        authorKind: "team",
        authorName,
        authorUserId: actor.id,
        body,
        status: "open",
      })
      .returning();
    const comment = inserted[0];

    await logAudit(
      {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: actor.id,
        action: "review.comment_added",
        entityType: "review_comment",
        entityId: comment.id,
        detail: {
          requestId: request.id,
          pageKey: input.pageKey,
          sectionId: input.sectionId ?? null,
          parentId: input.parentId ?? null,
          authorKind: "team",
        },
      },
      tx,
    );

    return comment;
  });
}

/**
 * INTERNAL (session + role): marks a comment as resolved and closes its
 * derived task (the task reflects real state — it never lies, §12.2).
 */
export async function resolveComment(
  commentId: string,
  actor: HumanActor,
): Promise<ReviewComment> {
  assertEditor(actor, "resolver comentarios");
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ comment: reviewComments, request: reviewRequests, project: projects })
      .from(reviewComments)
      .innerJoin(reviewRequests, eq(reviewComments.requestId, reviewRequests.id))
      .innerJoin(projects, eq(reviewRequests.projectId, projects.id))
      .where(and(eq(reviewComments.id, commentId), isNull(projects.deletedAt)))
      .limit(1);
    if (!rows[0]) {
      throw new ReviewDomainError("COMMENT_NOT_FOUND", "El comentario no existe.");
    }
    const { comment, request, project } = rows[0];
    assertSameWorkspace(project, actor);
    if (comment.status !== "open") {
      throw new ReviewDomainError("INVALID_STATE", "El comentario ya está resuelto.");
    }

    const updated = await tx
      .update(reviewComments)
      .set({ status: "resolved", resolvedBy: actor.id })
      .where(eq(reviewComments.id, commentId))
      .returning();

    await closeDerivedTask(tx, project.id, clientCommentTaskKey(commentId));

    await logAudit(
      {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: actor.id,
        action: "review.comment_resolved",
        entityType: "review_comment",
        entityId: commentId,
        detail: {
          requestId: request.id,
          pageKey: comment.pageKey,
          authorKind: comment.authorKind,
        },
      },
      tx,
    );

    return updated[0];
  });
}

// ---------------------------------------------------------------------------
// Client approvals (§8.5 — a DISTINCT type; never touches internal artifacts)
// ---------------------------------------------------------------------------

export interface AddClientApprovalInput {
  /** Name the client types — the attributable identity of the approval (R8). */
  name: string;
  comment?: string | null;
  /** Page approved; omit/null for a GLOBAL approval of the round/release. */
  pageKey?: string | null;
}

/**
 * PUBLIC (token): records a client approval over the round's release version
 * (optionally scoped to one page). By construction this ONLY inserts into
 * `client_approvals` + audit — internal artifacts are out of reach (§8.5).
 */
export async function addClientApproval(
  token: string,
  input: AddClientApprovalInput,
): Promise<ClientApproval> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const { request, project } = await loadRequestByToken(tx, token);
    assertOpenRound(request);
    const { payload } = await loadReleasePayload(tx, project.id, request.releaseVersion);
    const approvedName = requireText(input.name, "Escribe tu nombre para aprobar.");
    const pageKey = input.pageKey ?? null;
    if (pageKey != null && !(pageKey in payload.versions.compositions)) {
      throw new ReviewDomainError(
        "VALIDATION_FAILED",
        `La página «${pageKey}» no forma parte de este release.`,
      );
    }

    const inserted = await tx
      .insert(clientApprovals)
      .values({
        id: newId.clientApproval(),
        requestId: request.id,
        releaseVersion: request.releaseVersion,
        pageKey,
        approvedName,
        comment: input.comment?.trim() || null,
      })
      .returning();
    const approval = inserted[0];

    await logAudit(
      {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: null, // client identity = link label + typed name (R8)
        action: "review.client_approved",
        entityType: "client_approval",
        entityId: approval.id,
        detail: {
          requestId: request.id,
          requestLabel: request.label,
          releaseVersion: request.releaseVersion,
          pageKey,
          approvedName,
        },
      },
      tx,
    );

    return approval;
  });
}

// ---------------------------------------------------------------------------
// closeReviewRequest
// ---------------------------------------------------------------------------

/**
 * INTERNAL (session + role): closes a round. The token stops accepting
 * mutations (reads stay available). Open comment tasks remain open — they
 * reflect real unresolved feedback (§12.2 tasks never lie).
 */
export async function closeReviewRequest(
  requestId: string,
  actor: HumanActor,
): Promise<ReviewRequest> {
  assertEditor(actor, "cerrar rondas de revisión");
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ request: reviewRequests, project: projects })
      .from(reviewRequests)
      .innerJoin(projects, eq(reviewRequests.projectId, projects.id))
      .where(and(eq(reviewRequests.id, requestId), isNull(projects.deletedAt)))
      .limit(1);
    if (!rows[0]) {
      throw new ReviewDomainError("REQUEST_NOT_FOUND", "La ronda de revisión no existe.");
    }
    const { request, project } = rows[0];
    assertSameWorkspace(project, actor);
    if (request.status !== "open") {
      throw new ReviewDomainError("INVALID_STATE", "La ronda ya está cerrada.");
    }

    const updated = await tx
      .update(reviewRequests)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(reviewRequests.id, requestId))
      .returning();

    await logAudit(
      {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: actor.id,
        action: "review.request_closed",
        entityType: "review_request",
        entityId: requestId,
        detail: { label: request.label, releaseVersion: request.releaseVersion },
      },
      tx,
    );

    return updated[0];
  });
}
