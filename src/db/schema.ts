import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Platform core + Artifact Model schema (spec §8, §16, §7.10).
 *
 * Conventions:
 * - All PKs are prefixed random IDs generated in app code via `src/db/ids.ts`
 *   (e.g. `usr_x7k2mq4dn9wp`) — never DB-generated.
 * - Soft-delete is universal where deletion is user-facing (`deletedAt`).
 * - Artifact versions are immutable: `artifact_versions.payload` is never
 *   updated after insert (enforced in the artifacts module, not the DB).
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const workspaceRoleEnum = pgEnum("workspace_role", [
  "admin",
  "member",
  "client",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "archived",
]);

/** §8.2 — `outdated`/`rejected` are cross-cutting flags, not statuses. */
export const artifactStatusEnum = pgEnum("artifact_status", [
  "empty",
  "draft",
  "in_review",
  "approved",
  "locked",
]);

/** §8.3 / §8.6 — origin of an immutable version snapshot. */
export const versionOriginEnum = pgEnum("version_origin", [
  "human",
  "agent_run",
]);

export const taskKindEnum = pgEnum("task_kind", ["derived", "manual"]);

export const taskStatusEnum = pgEnum("task_status", ["open", "done"]);

/** §7.3 — kind of generator run over the generated project repo. */
export const generationKindEnum = pgEnum("generation_kind", [
  "generate",
  "regenerate",
]);

/**
 * §18.2 — outcome of a generator run. `conflicts` means the run completed but
 * reported conflicts that require human resolution (never auto-resolved).
 */
export const generationStatusEnum = pgEnum("generation_status", [
  "success",
  "conflicts",
  "error",
]);

/** §7.7 — lifecycle of a client review round. */
export const reviewRequestStatusEnum = pgEnum("review_request_status", [
  "open",
  "closed",
]);

/**
 * §7.7 / §8.5 — who authored a review comment. `client` identities are the
 * link label + the name they type (token link, no account — R8); `team`
 * comments come from authenticated workspace users.
 */
export const reviewCommentAuthorKindEnum = pgEnum("review_comment_author_kind", [
  "client",
  "team",
]);

export const reviewCommentStatusEnum = pgEnum("review_comment_status", [
  "open",
  "resolved",
]);

/** §7.8 — local deploy slots (production http://localhost:4100, preview :4200). */
export const deploymentSlotEnum = pgEnum("deployment_slot", [
  "production",
  "preview",
]);

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "building",
  "running",
  "stopped",
  "failed",
]);

/**
 * §7.9 / §8.6 — lifecycle of an agent run. `proposed` = the run produced a
 * draft + validations + diff and WAITS for a human; `approved`/`rejected`
 * record the HUMAN decision (taken through the artifacts module — no code
 * path lets a run transition an artifact itself, §19).
 */
export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "running",
  "proposed",
  "approved",
  "rejected",
  "failed",
]);

/** §16 BYOK — supported LLM providers. `mock` is first-class (demo/e2e offline). */
export const llmProviderEnum = pgEnum("llm_provider", [
  "anthropic",
  "openai",
  "mock",
]);

// ---------------------------------------------------------------------------
// Platform core: users, sessions, workspaces, projects
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(), // usr_
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // ses_
    /** Hash of the session token; the raw token only lives in the cookie. */
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(), // ws_
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user_id_idx").on(table.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(), // prj_
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: projectStatusEnum("status").notNull().default("active"),
    /** Current phase of the Cockpit (§7.2/§8.5), e.g. "spec", "ia", "design". */
    currentPhase: text("current_phase").notNull().default("spec"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("projects_workspace_id_idx").on(table.workspaceId)],
);

// ---------------------------------------------------------------------------
// Artifact Model (§8)
// ---------------------------------------------------------------------------

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(), // art_
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Artifact type key, e.g. "spec.sitemap", "content.page.home". */
    type: text("type").notNull(),
    /**
     * Instance key for multi-instance types (§8.1 `page.*`): the page path
     * for `page.composition` (e.g. "servicios", "legal/terms"). NULL for
     * singleton types. Unique per (project, type) among non-deleted rows.
     */
    key: text("key"),
    /**
     * Human label for keyed instances (e.g. "Composición: Servicios").
     * NULL → the UI falls back to the type definition label.
     */
    label: text("label"),
    /** Version of the Zod payload schema this artifact conforms to. */
    schemaVersion: text("schema_version").notNull(),
    status: artifactStatusEnum("status").notNull().default("empty"),
    /** §8.2 — cross-cutting flags; may coexist with `approved`. */
    outdated: boolean("outdated").notNull().default(false),
    rejected: boolean("rejected").notNull().default(false),
    /** Highest immutable version; 0 = no approved version yet. */
    currentVersion: integer("current_version").notNull().default(0),
    /** Lock holder, e.g. "gate:phase.ia" or a user ID for manual locks. */
    lockedBy: text("locked_by"),
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Mutable working copy (§8.3); promoted to an immutable version on approval. */
    draftPayload: jsonb("draft_payload"),
    /**
     * Provenance of the CURRENT draft (§8.6): the agent run that proposed it,
     * or NULL when the draft is human-authored. When a human approves a draft
     * proposed by a run, the sealed version carries `origin: "agent_run"` +
     * `agentRunId` (§8.3) and this pointer is cleared.
     */
    proposedByRunId: text("proposed_by_run_id").references(
      (): AnyPgColumn => agentRuns.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("artifacts_project_id_idx").on(table.projectId),
    index("artifacts_project_id_type_idx").on(table.projectId, table.type),
    uniqueIndex("artifacts_project_id_type_key_unique")
      .on(table.projectId, table.type, table.key)
      .where(sql`${table.key} is not null and ${table.deletedAt} is null`),
  ],
);

export const artifactVersions = pgTable(
  "artifact_versions",
  {
    id: text("id").primaryKey(), // ver_
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** IMMUTABLE full snapshot of the payload (§8.3). Never updated. */
    payload: jsonb("payload").notNull(),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    origin: versionOriginEnum("origin").notNull(),
    agentRunId: text("agent_run_id").references(() => agentRuns.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("artifact_versions_artifact_id_version_unique").on(
      table.artifactId,
      table.version,
    ),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(), // apr_
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    /** Approval always targets a concrete immutable version (§8.5). */
    version: integer("version").notNull(),
    approvedBy: text("approved_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("approvals_artifact_id_version_idx").on(
      table.artifactId,
      table.version,
    ),
  ],
);

/**
 * Instantiated edges of the dependency graph (§8.4).
 * A row means: `fromArtifactId` DEPENDS ON `toArtifactId`
 * (from = downstream/dependent, to = upstream).
 * Propagating `outdated` after approving a new version of X:
 * `select fromArtifactId where toArtifactId = X`.
 */
export const artifactDependencies = pgTable(
  "artifact_dependencies",
  {
    fromArtifactId: text("from_artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    toArtifactId: text("to_artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.fromArtifactId, table.toArtifactId] }),
    index("artifact_dependencies_to_artifact_id_idx").on(table.toArtifactId),
  ],
);

// ---------------------------------------------------------------------------
// BYOK: workspace LLM keys (§7.9, §16) + Agent runs (§7.9, §9.6)
// ---------------------------------------------------------------------------

/**
 * Workspace-scoped LLM API keys (BYOK, §16). The key value is stored ONLY as
 * AES-256-GCM ciphertext (`src/modules/agents/keys/crypto.ts`); it is never
 * logged, never sent to the client (only id/label/last4) and never reaches
 * generated projects. Agent runs reference keys by id (`keyRef`), never by value.
 */
export const workspaceLlmKeys = pgTable(
  "workspace_llm_keys",
  {
    id: text("id").primaryKey(), // key_
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: llmProviderEnum("provider").notNull(),
    /** Human label, e.g. "Anthropic producción". */
    label: text("label").notNull(),
    /**
     * AES-256-GCM ciphertext (`v1.<iv>.<tag>.<data>`, base64 parts). Only the
     * agents runtime decrypts it; the keys service NEVER returns this field.
     */
    encryptedKey: text("encrypted_key").notNull(),
    /** Last 4 characters of the plaintext key — the only visible fragment. */
    last4: text("last4").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Last successful validation against the provider; NULL after an auth failure. */
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("workspace_llm_keys_workspace_id_idx").on(table.workspaceId)],
);

/**
 * Agent runs (§7.9): full audit of what a skill read, what it proposed, which
 * model/provider/key (by reference) it used, which validations ran and who
 * decided (§9.6). A run NEVER approves artifacts — it produces a proposal
 * (draft + validations + diff) and a human decides through the artifacts
 * module (§8.6, §13, §19).
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(), // run_
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Skill name (§9.3), e.g. "generate-spec-draft". */
    skill: text("skill").notNull(),
    /** Exact skill version the run executed (§9.1). */
    skillVersion: text("skill_version").notNull(),
    status: agentRunStatusEnum("status").notNull().default("queued"),
    /** Artifact the proposal targets (its draft is the proposal). */
    targetArtifactId: text("target_artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
    /** Denormalised target identity (survives artifact deletion). */
    targetType: text("target_type").notNull(),
    targetKey: text("target_key"),
    /** Free-form user instruction (e.g. revise-artifact: "tono más premium"). */
    instruction: text("instruction"),
    /** Exactly which sealed versions the skill read (§9.6). */
    inputArtifacts: jsonb("input_artifacts")
      .$type<AgentRunInputArtifact[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    provider: llmProviderEnum("provider").notNull(),
    /** Real model id used, e.g. "claude-sonnet-4-6" / "mock-deterministic-1". */
    modelId: text("model_id"),
    /** BYOK key used, BY REFERENCE — never the value (§16). NULL for mock. */
    keyRef: text("key_ref").references(() => workspaceLlmKeys.id, {
      onDelete: "set null",
    }),
    /** Skill validation results shown next to the proposal diff (§8.6). */
    validations: jsonb("validations").$type<AgentRunValidation[]>(),
    usage: jsonb("usage").$type<AgentRunUsage>(),
    /** Human-readable failure detail (Spanish), prefixed with the error code. */
    errorDetail: text("error_detail"),
    /** Human (admin|member) who started the run. */
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Human who decided on the proposal (approve/reject via artifacts). */
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Sealed artifact version that resulted from an approved proposal. */
    resultVersion: integer("result_version"),
    /** Human feedback attached when the proposal was rejected (§8.2/§8.6). */
    feedback: text("feedback"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_runs_project_id_idx").on(table.projectId),
    index("agent_runs_workspace_id_created_at_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("agent_runs_target_artifact_id_idx").on(table.targetArtifactId),
  ],
);

/** One context read recorded on the run: `{type, key, version, source}` (§9.6). */
export type AgentRunInputArtifact = {
  type: string;
  key: string | null;
  /** Sealed version read; for `source:"draft"` the base version under the draft. */
  version: number;
  source: "approved" | "draft";
};

/** One skill validation result (§9.1 `validations`). */
export type AgentRunValidation = {
  key: string;
  /** Human label (Spanish). */
  label: string;
  ok: boolean;
  detail?: string;
};

/** Token usage + computed cost of the provider call. */
export type AgentRunUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

// ---------------------------------------------------------------------------
// Audit log (§9.6, restricción "audit log en toda mutación")
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(), // evt_
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    /** Null when the actor is the system (e.g. derived-task generation). */
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Verb, e.g. "artifact.approved", "artifact.unlocked", "task.created". */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_log_workspace_id_created_at_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
  ],
);

// ---------------------------------------------------------------------------
// Tasks (§7.10, §12.2): derived ("revisar X") + manual
// ---------------------------------------------------------------------------

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(), // tsk_
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: taskKindEnum("kind").notNull(),
    title: text("title").notNull(),
    status: taskStatusEnum("status").notNull().default("open"),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    artifactId: text("artifact_id").references(() => artifacts.id, {
      onDelete: "cascade",
    }),
    /**
     * For derived tasks: stable key (e.g. "outdated:art_x:rereview") so the
     * same propagation event never creates duplicate open tasks.
     */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("tasks_project_id_idx").on(table.projectId),
    index("tasks_assignee_id_idx").on(table.assigneeId),
    uniqueIndex("tasks_project_id_dedupe_key_unique")
      .on(table.projectId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null and ${table.deletedAt} is null`),
  ],
);

// ---------------------------------------------------------------------------
// Generations (§7.3, §18.2): runs of the project generator over the per-project
// git repo (.data/projects/<projectId>/). The summary is the structured result
// the UI renders (written/created/preserved/skipped/conflicts).
// ---------------------------------------------------------------------------

export const generations = pgTable(
  "generations",
  {
    id: text("id").primaryKey(), // gen_
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: generationKindEnum("kind").notNull(),
    status: generationStatusEnum("status").notNull(),
    /**
     * Structured run result:
     * `{ written: string[], created: string[], preserved: string[],
     *    skipped: string[], deletedOrphans: string[], conflicts: Conflict[] }`
     * (typed/validated in `src/modules/generator`).
     */
    summary: jsonb("summary").notNull(),
    /** Human-readable error when `status = "error"`. */
    error: text("error"),
    /** Always a human session user — generation is a human-triggered mutation. */
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("generations_project_id_created_at_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Client review (§7.7, §8.5): review rounds over a sealed RELEASE version.
// Client approvals are a DISTINCT type from internal approvals — they approve
// page/release versions through a token link and NEVER transition internal
// artifacts.
// ---------------------------------------------------------------------------

export const reviewRequests = pgTable(
  "review_requests",
  {
    id: text("id").primaryKey(), // rev_
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Sealed version of the project's `release` artifact this round reviews. */
    releaseVersion: integer("release_version").notNull(),
    /**
     * URL-safe random token — the WHOLE client credential (link auth, no
     * account, R8). Public access always validates this value against the DB.
     */
    token: text("token").notNull(),
    /** Human label of the link/round, e.g. "Cliente Acme — ronda 1". */
    label: text("label").notNull(),
    status: reviewRequestStatusEnum("status").notNull().default("open"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("review_requests_token_unique").on(table.token),
    index("review_requests_project_id_idx").on(table.projectId),
  ],
);

export const reviewComments = pgTable(
  "review_comments",
  {
    id: text("id").primaryKey(), // cmt_
    requestId: text("request_id")
      .notNull()
      .references(() => reviewRequests.id, { onDelete: "cascade" }),
    /** Page key of the release (`page.composition` instance key, e.g. "home"). */
    pageKey: text("page_key").notNull(),
    /** Optional anchor: stable block/section id inside the page composition. */
    sectionId: text("section_id"),
    /** Threading: parent comment of a reply (same request). */
    parentId: text("parent_id").references((): AnyPgColumn => reviewComments.id, {
      onDelete: "cascade",
    }),
    authorKind: reviewCommentAuthorKindEnum("author_kind").notNull(),
    /** Display name: typed by the client, or the team user's name. */
    authorName: text("author_name").notNull(),
    /** Session user behind a `team` comment; always NULL for `client`. */
    authorUserId: text("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    status: reviewCommentStatusEnum("status").notNull().default("open"),
    /** Team member who resolved it (resolution is team-only). */
    resolvedBy: text("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("review_comments_request_id_idx").on(table.requestId),
    index("review_comments_parent_id_idx").on(table.parentId),
  ],
);

export const clientApprovals = pgTable(
  "client_approvals",
  {
    id: text("id").primaryKey(), // capr_
    requestId: text("request_id")
      .notNull()
      .references(() => reviewRequests.id, { onDelete: "cascade" }),
    /** Denormalised from the request: the approval targets THIS release version. */
    releaseVersion: integer("release_version").notNull(),
    /** Page approved; NULL = global approval of the whole round/release. */
    pageKey: text("page_key"),
    /** Name the client typed — their identity is link label + typed name (R8). */
    approvedName: text("approved_name").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("client_approvals_request_id_idx").on(table.requestId)],
);

// ---------------------------------------------------------------------------
// Deployments (§7.8): immutable release builds served on local slots behind
// the DeployProvider interface (Vercel will land behind the SAME interface).
// ---------------------------------------------------------------------------

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(), // dep_
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Sealed version of the `release` artifact this deployment serves. */
    releaseVersion: integer("release_version").notNull(),
    slot: deploymentSlotEnum("slot").notNull(),
    status: deploymentStatusEnum("status").notNull().default("building"),
    /** Public URL of the slot, e.g. http://localhost:4100. */
    url: text("url").notNull(),
    /**
     * Provider detail (local provider: `{ pid, port, buildDir, error }`).
     * Shape is owned/validated by the deploy module.
     */
    detail: jsonb("detail"),
    /** Always a human with role — no deploy without confirmed checklist (§13). */
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("deployments_project_id_slot_idx").on(table.projectId, table.slot),
    index("deployments_project_id_created_at_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for the drizzle relational query API)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  memberships: many(workspaceMembers),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  projects: many(projects),
  llmKeys: many(workspaceLlmKeys),
  agentRuns: many(agentRuns),
}));

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
    }),
    user: one(users, {
      fields: [workspaceMembers.userId],
      references: [users.id],
    }),
  }),
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  artifacts: many(artifacts),
  tasks: many(tasks),
  agentRuns: many(agentRuns),
  generations: many(generations),
  reviewRequests: many(reviewRequests),
  deployments: many(deployments),
}));

export const reviewRequestsRelations = relations(reviewRequests, ({ one, many }) => ({
  project: one(projects, {
    fields: [reviewRequests.projectId],
    references: [projects.id],
  }),
  creator: one(users, {
    fields: [reviewRequests.createdBy],
    references: [users.id],
  }),
  comments: many(reviewComments),
  clientApprovals: many(clientApprovals),
}));

export const reviewCommentsRelations = relations(reviewComments, ({ one, many }) => ({
  request: one(reviewRequests, {
    fields: [reviewComments.requestId],
    references: [reviewRequests.id],
  }),
  parent: one(reviewComments, {
    fields: [reviewComments.parentId],
    references: [reviewComments.id],
    relationName: "commentThread",
  }),
  replies: many(reviewComments, { relationName: "commentThread" }),
  author: one(users, {
    fields: [reviewComments.authorUserId],
    references: [users.id],
    relationName: "reviewCommentAuthor",
  }),
  resolver: one(users, {
    fields: [reviewComments.resolvedBy],
    references: [users.id],
    relationName: "reviewCommentResolver",
  }),
}));

export const clientApprovalsRelations = relations(clientApprovals, ({ one }) => ({
  request: one(reviewRequests, {
    fields: [clientApprovals.requestId],
    references: [reviewRequests.id],
  }),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  project: one(projects, {
    fields: [deployments.projectId],
    references: [projects.id],
  }),
  actor: one(users, { fields: [deployments.actorId], references: [users.id] }),
}));

export const generationsRelations = relations(generations, ({ one }) => ({
  project: one(projects, {
    fields: [generations.projectId],
    references: [projects.id],
  }),
  actor: one(users, { fields: [generations.actorId], references: [users.id] }),
}));

export const artifactsRelations = relations(artifacts, ({ one, many }) => ({
  project: one(projects, {
    fields: [artifacts.projectId],
    references: [projects.id],
  }),
  owner: one(users, { fields: [artifacts.ownerId], references: [users.id] }),
  versions: many(artifactVersions),
  approvals: many(approvals),
  dependsOn: many(artifactDependencies, { relationName: "dependsOn" }),
  dependents: many(artifactDependencies, { relationName: "dependents" }),
  /** Agent run that proposed the CURRENT draft (§8.6); null if human-authored. */
  proposedByRun: one(agentRuns, {
    fields: [artifacts.proposedByRunId],
    references: [agentRuns.id],
    relationName: "agentRunProposedDrafts",
  }),
  targetedByRuns: many(agentRuns, { relationName: "agentRunTarget" }),
}));

export const artifactVersionsRelations = relations(
  artifactVersions,
  ({ one }) => ({
    artifact: one(artifacts, {
      fields: [artifactVersions.artifactId],
      references: [artifacts.id],
    }),
    author: one(users, {
      fields: [artifactVersions.authorId],
      references: [users.id],
    }),
    agentRun: one(agentRuns, {
      fields: [artifactVersions.agentRunId],
      references: [agentRuns.id],
    }),
  }),
);

export const approvalsRelations = relations(approvals, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [approvals.artifactId],
    references: [artifacts.id],
  }),
  approver: one(users, {
    fields: [approvals.approvedBy],
    references: [users.id],
  }),
}));

export const artifactDependenciesRelations = relations(
  artifactDependencies,
  ({ one }) => ({
    /** The dependent (downstream) artifact. */
    from: one(artifacts, {
      fields: [artifactDependencies.fromArtifactId],
      references: [artifacts.id],
      relationName: "dependsOn",
    }),
    /** The dependency (upstream) artifact. */
    to: one(artifacts, {
      fields: [artifactDependencies.toArtifactId],
      references: [artifacts.id],
      relationName: "dependents",
    }),
  }),
);

export const workspaceLlmKeysRelations = relations(
  workspaceLlmKeys,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [workspaceLlmKeys.workspaceId],
      references: [workspaces.id],
    }),
    creator: one(users, {
      fields: [workspaceLlmKeys.createdBy],
      references: [users.id],
    }),
    runs: many(agentRuns),
  }),
);

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [agentRuns.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [agentRuns.projectId],
    references: [projects.id],
  }),
  targetArtifact: one(artifacts, {
    fields: [agentRuns.targetArtifactId],
    references: [artifacts.id],
    relationName: "agentRunTarget",
  }),
  key: one(workspaceLlmKeys, {
    fields: [agentRuns.keyRef],
    references: [workspaceLlmKeys.id],
  }),
  creator: one(users, {
    fields: [agentRuns.createdBy],
    references: [users.id],
    relationName: "agentRunCreator",
  }),
  decider: one(users, {
    fields: [agentRuns.decidedBy],
    references: [users.id],
    relationName: "agentRunDecider",
  }),
  proposedVersions: many(artifactVersions),
  proposedDrafts: many(artifacts, { relationName: "agentRunProposedDrafts" }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  artifact: one(artifacts, {
    fields: [tasks.artifactId],
    references: [artifacts.id],
  }),
}));

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type ArtifactVersion = typeof artifactVersions.$inferSelect;
export type NewArtifactVersion = typeof artifactVersions.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
export type ArtifactDependency = typeof artifactDependencies.$inferSelect;
export type NewArtifactDependency = typeof artifactDependencies.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type WorkspaceLlmKey = typeof workspaceLlmKeys.$inferSelect;
export type NewWorkspaceLlmKey = typeof workspaceLlmKeys.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Generation = typeof generations.$inferSelect;
export type NewGeneration = typeof generations.$inferInsert;
export type ReviewRequest = typeof reviewRequests.$inferSelect;
export type NewReviewRequest = typeof reviewRequests.$inferInsert;
export type ReviewComment = typeof reviewComments.$inferSelect;
export type NewReviewComment = typeof reviewComments.$inferInsert;
export type ClientApproval = typeof clientApprovals.$inferSelect;
export type NewClientApproval = typeof clientApprovals.$inferInsert;
export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;

export type WorkspaceRole = (typeof workspaceRoleEnum.enumValues)[number];
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type ArtifactStatus = (typeof artifactStatusEnum.enumValues)[number];
export type VersionOrigin = (typeof versionOriginEnum.enumValues)[number];
export type TaskKind = (typeof taskKindEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type GenerationKind = (typeof generationKindEnum.enumValues)[number];
export type GenerationStatus = (typeof generationStatusEnum.enumValues)[number];
export type ReviewRequestStatus = (typeof reviewRequestStatusEnum.enumValues)[number];
export type ReviewCommentAuthorKind =
  (typeof reviewCommentAuthorKindEnum.enumValues)[number];
export type ReviewCommentStatus = (typeof reviewCommentStatusEnum.enumValues)[number];
export type DeploymentSlot = (typeof deploymentSlotEnum.enumValues)[number];
export type DeploymentStatus = (typeof deploymentStatusEnum.enumValues)[number];
export type AgentRunStatus = (typeof agentRunStatusEnum.enumValues)[number];
export type LlmProviderKind = (typeof llmProviderEnum.enumValues)[number];
