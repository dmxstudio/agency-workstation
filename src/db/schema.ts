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
// Agent runs (minimal placeholder — Agent Runtime is a later phase, §7.9)
// ---------------------------------------------------------------------------

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(), // run_
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Skill key (§9.3), e.g. "draft.strategy". */
    skill: text("skill").notNull(),
    /** Free-form for now; the agents module will own the state machine. */
    status: text("status").notNull().default("queued"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("agent_runs_project_id_idx").on(table.projectId)],
);

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

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  project: one(projects, {
    fields: [agentRuns.projectId],
    references: [projects.id],
  }),
  proposedVersions: many(artifactVersions),
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
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Generation = typeof generations.$inferSelect;
export type NewGeneration = typeof generations.$inferInsert;

export type WorkspaceRole = (typeof workspaceRoleEnum.enumValues)[number];
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type ArtifactStatus = (typeof artifactStatusEnum.enumValues)[number];
export type VersionOrigin = (typeof versionOriginEnum.enumValues)[number];
export type TaskKind = (typeof taskKindEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type GenerationKind = (typeof generationKindEnum.enumValues)[number];
export type GenerationStatus = (typeof generationStatusEnum.enumValues)[number];
