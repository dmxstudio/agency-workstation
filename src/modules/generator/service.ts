import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb, type Db } from "@/db/client";
import {
  artifactVersions,
  generations,
  projects,
  users,
  type Generation,
  type GenerationKind,
  type GenerationStatus,
  type Project,
  type WorkspaceRole,
} from "@/db/schema";
import {
  getArtifactType,
  getProjectArtifacts,
  pageCompositionDefinition,
  type ArtifactTypeKey,
  type ProjectArtifact,
} from "@/modules/artifacts";
import { logAudit } from "@/modules/platform-core/audit";

import type { Conflict } from "./conflicts";
import {
  engineGenerate,
  engineRegenerate,
  hasManifest,
  type EngineRegenerateResult,
} from "./engine";
import { GeneratorDomainError } from "./errors";
import { gitCommit, gitInit, gitStageAll, gitStagePaths } from "./git";
import { newGenerationId } from "./ids";
import { MANIFEST_FILENAME } from "./ownership";
import { getProjectRepoDir, getTemplateDir } from "./paths";
import type { GeneratorInput } from "./render";

/**
 * Generator domain service (§7.3, §18.2) — from approved artifacts to a local
 * git repository per project (`.data/projects/<projectId>/`).
 *
 * Hard guarantees, by construction:
 * - INPUT is always the latest APPROVED (sealed, immutable) version of each
 *   artifact — never drafts. Generation requires `cms.collections`,
 *   `spec.sitemap` and `design.tokens` approved; `content.page` and
 *   `page.composition` enrich the output when approved.
 * - Regeneration only touches codegen-owned files; conflicts are reported,
 *   never auto-resolved; human files are never written (§18.2).
 * - The platform writes through git commits with descriptive messages (§16);
 *   regeneration stages ONLY the paths it wrote, so concurrent human edits in
 *   the working tree are never swept into a platform commit.
 * - Every generation inserts a `generations` row and an audit log entry.
 * - The generator NEVER runs `npm install` in generated projects: generation
 *   must take seconds; installing dependencies is the user's step (the UI
 *   explains this).
 */

// ---------------------------------------------------------------------------
// Actor (same shape as the artifacts module: a human session user)
// ---------------------------------------------------------------------------

export interface HumanActor {
  id: string; // usr_
  role: WorkspaceRole;
  workspaceId: string;
}

const EDITOR_ROLES: readonly WorkspaceRole[] = ["admin", "member"];

function assertEditor(actor: HumanActor, action: string): void {
  if (!EDITOR_ROLES.includes(actor.role)) {
    throw new GeneratorDomainError(
      "FORBIDDEN",
      `No tienes permisos para ${action}: requiere rol admin o member.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Requirements (§7.3): which artifacts gate generation
// ---------------------------------------------------------------------------

/** Artifacts the generator consumes. `required: true` ones gate generation. */
export const GENERATION_INPUT_TYPES: readonly {
  type: ArtifactTypeKey;
  required: boolean;
}[] = [
  { type: "spec.sitemap", required: true },
  { type: "cms.collections", required: true },
  { type: "design.tokens", required: true },
  { type: "content.page", required: false },
  { type: "page.composition", required: false },
];

export interface GenerationRequirement {
  type: ArtifactTypeKey;
  label: string;
  /** Artifact status (`empty | draft | in_review | approved | locked`). */
  status: string;
  /** Pending re-validation flag (§8.2); does not block generation by itself. */
  outdated: boolean;
  /** Whether generation is blocked until this artifact is approved. */
  required: boolean;
  /** Approved (or locked) with at least one sealed version. */
  ok: boolean;
  artifactId: string | null;
  currentVersion: number;
}

function isApproved(item: ProjectArtifact | undefined): boolean {
  if (!item) return false;
  const { status, currentVersion } = item.artifact;
  return (status === "approved" || status === "locked") && currentVersion > 0;
}

function buildRequirements(items: ProjectArtifact[]): GenerationRequirement[] {
  const byType = new Map<string, ProjectArtifact[]>();
  for (const item of items) {
    const list = byType.get(item.artifact.type) ?? [];
    list.push(item);
    byType.set(item.artifact.type, list);
  }

  return GENERATION_INPUT_TYPES.map(({ type, required }) => {
    const definition = getArtifactType(type);
    const instances = byType.get(type) ?? [];

    if (definition.multiInstance) {
      // page.composition: aggregate over the keyed per-page instances.
      const approvedCount = instances.filter((item) => isApproved(item)).length;
      const status =
        instances.length === 0
          ? "empty"
          : approvedCount === instances.length
            ? "approved"
            : instances.some((item) => item.artifact.status === "in_review")
              ? "in_review"
              : "draft";
      return {
        type,
        label:
          instances.length === 0
            ? `${definition.label}s (sin sincronizar del sitemap)`
            : `${definition.label}s (${approvedCount}/${instances.length} aprobadas)`,
        status,
        outdated: instances.some((item) => item.artifact.outdated),
        required,
        // Optional input: any approved composition already enriches the seed.
        ok: approvedCount > 0,
        artifactId: null,
        currentVersion: 0,
      };
    }

    const item = instances[0];
    return {
      type,
      label: item?.label ?? definition.label,
      status: item?.artifact.status ?? "empty",
      outdated: item?.artifact.outdated ?? false,
      required,
      ok: isApproved(item),
      artifactId: item?.artifact.id ?? null,
      currentVersion: item?.artifact.currentVersion ?? 0,
    };
  });
}

/**
 * State of the artifacts the generator consumes, for the UI checklist:
 * generation unlocks when every `required` entry is `ok`.
 */
export async function getGenerationRequirements(
  projectId: string,
): Promise<GenerationRequirement[]> {
  const items = await getProjectArtifacts(projectId);
  return buildRequirements(items);
}

// ---------------------------------------------------------------------------
// Input loading: latest APPROVED payloads, validated by their Zod schema
// ---------------------------------------------------------------------------

async function loadProject(db: Db, projectId: string, actor: HumanActor): Promise<Project> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  const project = rows[0];
  if (!project) {
    throw new GeneratorDomainError("PROJECT_NOT_FOUND", "El proyecto no existe.");
  }
  if (project.workspaceId !== actor.workspaceId) {
    throw new GeneratorDomainError(
      "FORBIDDEN",
      "El proyecto no pertenece a tu workspace activo.",
    );
  }
  return project;
}

/** Loads the sealed payload of the artifact's current version, Zod-validated. */
async function loadApprovedPayload<T>(db: Db, item: ProjectArtifact): Promise<T> {
  const rows = await db
    .select({ payload: artifactVersions.payload })
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifactId, item.artifact.id),
        eq(artifactVersions.version, item.artifact.currentVersion),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new GeneratorDomainError(
      "REQUIREMENTS_NOT_MET",
      `No existe la versión sellada v${item.artifact.currentVersion} de «${item.label}».`,
    );
  }
  // Same rule as the platform: payloads are schema-validated at the boundary.
  return getArtifactType(item.artifact.type).payloadSchema.parse(rows[0].payload) as T;
}

interface LoadedInput {
  input: GeneratorInput;
  /** Sealed version per singleton input type actually consumed. */
  inputVersions: Partial<Record<ArtifactTypeKey, number>>;
  /** Sealed version per consumed `page.composition` instance, keyed by page. */
  compositionVersions: Record<string, number>;
  requirements: GenerationRequirement[];
}

async function loadGeneratorInput(
  db: Db,
  project: Project,
): Promise<LoadedInput> {
  const items = await getProjectArtifacts(project.id);
  const requirements = buildRequirements(items);

  const missing = requirements.filter((req) => req.required && !req.ok);
  if (missing.length > 0) {
    throw new GeneratorDomainError(
      "REQUIREMENTS_NOT_MET",
      `Faltan artefactos aprobados para generar: ${missing.map((req) => req.label).join(", ")}.`,
      { missing: missing.map((req) => req.type) },
    );
  }

  const byType = new Map(
    items.filter((item) => item.artifact.key == null).map((item) => [item.artifact.type, item]),
  );
  const inputVersions: Partial<Record<ArtifactTypeKey, number>> = {};

  const pick = (type: ArtifactTypeKey): ProjectArtifact => {
    const item = byType.get(type);
    if (!item) {
      throw new GeneratorDomainError(
        "REQUIREMENTS_NOT_MET",
        `El proyecto no tiene instanciado el artefacto «${type}».`,
      );
    }
    inputVersions[type] = item.artifact.currentVersion;
    return item;
  };

  const sitemap = await loadApprovedPayload<GeneratorInput["sitemap"]>(db, pick("spec.sitemap"));
  const collections = await loadApprovedPayload<GeneratorInput["collections"]>(
    db,
    pick("cms.collections"),
  );
  const tokens = await loadApprovedPayload<GeneratorInput["tokens"]>(db, pick("design.tokens"));

  const contentItem = byType.get("content.page");
  const content = isApproved(contentItem)
    ? await loadApprovedPayload<NonNullable<GeneratorInput["content"]>>(db, pick("content.page"))
    : null;

  // Per-page compositions: APPROVED keyed instances only. Instances sealed
  // under the legacy 1.0 schema are skipped (their pages fall back to the
  // content.page scaffold) — the migration task asks a human to re-author
  // them; the generator never converts payloads on its own.
  const compositions: GeneratorInput["compositions"] = {};
  const compositionVersions: Record<string, number> = {};
  const compositionItems = items
    .filter(
      (item) =>
        item.artifact.type === pageCompositionDefinition.type && item.artifact.key != null,
    )
    .sort((a, b) => (a.artifact.key ?? "").localeCompare(b.artifact.key ?? ""));
  for (const item of compositionItems) {
    if (!isApproved(item)) continue;
    if (item.artifact.schemaVersion !== pageCompositionDefinition.schemaVersion) continue;
    const key = item.artifact.key as string;
    compositions[key] = await loadApprovedPayload<GeneratorInput["compositions"][string]>(
      db,
      item,
    );
    compositionVersions[key] = item.artifact.currentVersion;
  }

  return {
    input: { projectName: project.name, sitemap, collections, tokens, content, compositions },
    inputVersions,
    compositionVersions,
    requirements,
  };
}

// ---------------------------------------------------------------------------
// Generation records
// ---------------------------------------------------------------------------

/** Structured result persisted in `generations.summary` (jsonb). */
export interface GenerationSummary {
  written: string[];
  created: string[];
  preserved: string[];
  skipped: string[];
  deletedOrphans: string[];
  conflicts: Conflict[];
  /** Sealed artifact version per singleton input type consumed by this run. */
  inputVersions: Partial<Record<ArtifactTypeKey, number>>;
  /**
   * Sealed version per consumed `page.composition` instance, keyed by page
   * path. Absent/empty when no per-page composition was approved (runs
   * recorded before the multi-composition model also lack it).
   */
  compositionVersions?: Record<string, number>;
  /** Commit hash created by this run; null when nothing changed. */
  commit: string | null;
}

export interface GenerationResult {
  generation: Generation;
  summary: GenerationSummary;
  repoDir: string;
}

function emptySummary(
  inputVersions: Partial<Record<ArtifactTypeKey, number>> = {},
  compositionVersions: Record<string, number> = {},
): GenerationSummary {
  return {
    written: [],
    created: [],
    preserved: [],
    skipped: [],
    deletedOrphans: [],
    conflicts: [],
    inputVersions,
    compositionVersions,
    commit: null,
  };
}

async function recordGeneration(
  db: Db,
  project: Project,
  actor: HumanActor,
  kind: GenerationKind,
  status: GenerationStatus,
  summary: GenerationSummary,
  error: string | null,
): Promise<Generation> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(generations)
      .values({
        id: newGenerationId(),
        projectId: project.id,
        kind,
        status,
        summary,
        error,
        actorId: actor.id,
      })
      .returning();
    const generation = inserted[0];

    // Restricción §19: audit log en toda mutación (platform-core helper).
    await logAudit(
      {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: actor.id,
        action: kind === "generate" ? "project.generated" : "project.regenerated",
        entityType: "generation",
        entityId: generation.id,
        detail: {
          status,
          written: summary.written.length,
          created: summary.created.length,
          preserved: summary.preserved.length,
          skipped: summary.skipped.length,
          deletedOrphans: summary.deletedOrphans.length,
          conflicts: summary.conflicts.map((conflict) => conflict.kind),
          inputVersions: summary.inputVersions,
          commit: summary.commit,
          error,
        },
      },
      tx,
    );

    return generation;
  });
}

function describeInputVersions(
  inputVersions: Partial<Record<ArtifactTypeKey, number>>,
  compositionVersions: Record<string, number> = {},
): string {
  return [
    ...Object.entries(inputVersions).map(([type, version]) => `${type} v${version}`),
    ...Object.entries(compositionVersions).map(
      ([key, version]) => `page.composition[${key}] v${version}`,
    ),
  ].join(", ");
}

// ---------------------------------------------------------------------------
// generateProject
// ---------------------------------------------------------------------------

/**
 * Initial generation: template copy + codegen from approved artifacts +
 * ownership manifest + `git init` + initial commit. Takes seconds: it never
 * installs dependencies in the generated project.
 */
export async function generateProject(
  projectId: string,
  actor: HumanActor,
): Promise<GenerationResult> {
  assertEditor(actor, "generar el proyecto");
  const db = getDb();
  const project = await loadProject(db, projectId, actor);
  const { input, inputVersions, compositionVersions } = await loadGeneratorInput(db, project);

  const repoDir = getProjectRepoDir(projectId);
  if (hasManifest(repoDir)) {
    throw new GeneratorDomainError(
      "ALREADY_GENERATED",
      "El proyecto ya fue generado; usa la regeneración para aplicar cambios de spec.",
    );
  }

  try {
    const result = engineGenerate(input, repoDir, getTemplateDir());

    await gitInit(repoDir);
    await gitStageAll(repoDir);
    const commit = await gitCommit(
      repoDir,
      `generate: initial project from approved artifacts (${describeInputVersions(inputVersions, compositionVersions)})`,
    );

    const summary: GenerationSummary = {
      ...emptySummary(inputVersions, compositionVersions),
      created: [...result.codegenFiles, ...result.humanFiles, MANIFEST_FILENAME].sort(),
      conflicts: result.conflicts,
      commit,
    };
    const status: GenerationStatus = result.conflicts.length > 0 ? "conflicts" : "success";
    const generation = await recordGeneration(db, project, actor, "generate", status, summary, null);
    return { generation, summary, repoDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordGeneration(
      db,
      project,
      actor,
      "generate",
      "error",
      emptySummary(inputVersions, compositionVersions),
      message,
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// regenerateProject
// ---------------------------------------------------------------------------

/**
 * Partial regeneration (§18.2): re-renders the codegen set from the CURRENT
 * approved artifacts and reconciles it against disk + manifest. Only codegen
 * files are touched; conflicts are reported, never resolved; idempotent.
 * Commits only when something actually changed, staging ONLY its own paths.
 */
export async function regenerateProject(
  projectId: string,
  actor: HumanActor,
): Promise<GenerationResult> {
  assertEditor(actor, "regenerar el proyecto");
  const db = getDb();
  const project = await loadProject(db, projectId, actor);
  const { input, inputVersions, compositionVersions } = await loadGeneratorInput(db, project);

  const repoDir = getProjectRepoDir(projectId);
  if (!hasManifest(repoDir)) {
    throw new GeneratorDomainError(
      "NOT_GENERATED",
      "El proyecto aún no fue generado; ejecuta la generación inicial primero.",
    );
  }

  try {
    const result = engineRegenerate(input, repoDir);

    const commit = await commitRegeneration(repoDir, result, inputVersions, compositionVersions);

    const summary: GenerationSummary = {
      written: result.written,
      created: result.created,
      preserved: result.preserved,
      skipped: result.skipped,
      deletedOrphans: result.deletedOrphans,
      conflicts: result.conflicts,
      inputVersions,
      compositionVersions,
      commit,
    };
    const status: GenerationStatus = result.conflicts.length > 0 ? "conflicts" : "success";
    const generation = await recordGeneration(
      db,
      project,
      actor,
      "regenerate",
      status,
      summary,
      null,
    );
    return { generation, summary, repoDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordGeneration(
      db,
      project,
      actor,
      "regenerate",
      "error",
      emptySummary(inputVersions, compositionVersions),
      message,
    );
    throw error;
  }
}

/** Commit "regenerate: …" ONLY if the run changed files; stages own paths only. */
async function commitRegeneration(
  repoDir: string,
  result: EngineRegenerateResult,
  inputVersions: Partial<Record<ArtifactTypeKey, number>>,
  compositionVersions: Record<string, number>,
): Promise<string | null> {
  const changedPaths = [...result.written, ...result.created, ...result.deletedOrphans];
  if (changedPaths.length === 0) return null;

  await gitStagePaths(repoDir, [...changedPaths, MANIFEST_FILENAME]);

  const parts = [
    `${result.written.length} rewritten`,
    `${result.created.length} created`,
    `${result.deletedOrphans.length} orphans deleted`,
  ];
  if (result.conflicts.length > 0) {
    parts.push(`${result.conflicts.length} conflicts reported (not applied)`);
  }
  return gitCommit(
    repoDir,
    `regenerate: ${describeInputVersions(inputVersions, compositionVersions)} — ${parts.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// getGenerations
// ---------------------------------------------------------------------------

export interface GenerationWithActor {
  generation: Generation;
  /** Resolved display name of the human who ran it; null if user deleted. */
  actorName: string | null;
}

/** Generation history of a project, newest first. */
export async function getGenerations(
  projectId: string,
  limit = 50,
): Promise<GenerationWithActor[]> {
  const db = getDb();
  const rows = await db
    .select({ generation: generations, actorName: users.name })
    .from(generations)
    .leftJoin(users, eq(generations.actorId, users.id))
    .where(eq(generations.projectId, projectId))
    .orderBy(desc(generations.createdAt))
    .limit(limit);
  return rows.map(({ generation, actorName }) => ({ generation, actorName }));
}
