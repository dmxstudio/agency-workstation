import type {
  AgentRunInputArtifact,
  AgentRunUsage,
  AgentRunValidation,
  LlmProviderKind,
  WorkspaceRole,
} from "@/db/schema";
import type { ArtifactTypeKey } from "@/modules/artifacts/types/definition";

/**
 * Shared contracts of the agents module (§7.9, §9).
 *
 * Three contracts live here:
 * - {@link SkillDefinition} — the operational contract of a skill (§9.1).
 *   The 5 MVP skills (§9.3) implement it in `src/modules/agents/skills/`.
 * - {@link LlmProvider} — the ONE multi-provider interface (§16). Concrete
 *   providers live in `runtime/providers/` (anthropic | openai | mock).
 * - {@link ProjectContext} — what `getProjectContext` (§9.4) feeds to skills.
 *
 * Hard guarantee threaded through every type here: a run produces a PROPOSAL
 * (draft + validations + diff). Nothing in these contracts can transition an
 * artifact to `approved` — that path only exists for humans in the artifacts
 * module (§8.6, §13, §19).
 */

// ---------------------------------------------------------------------------
// Skill names (§9.3 — closed list, exactly these five)
// ---------------------------------------------------------------------------

export const AGENT_SKILL_NAMES = [
  "generate-spec-draft",
  "generate-cms-schema",
  "write-page-copy",
  "compose-page-draft",
  "revise-artifact",
] as const;

export type AgentSkillName = (typeof AGENT_SKILL_NAMES)[number];

// ---------------------------------------------------------------------------
// Project Context API shapes (§9.4)
// ---------------------------------------------------------------------------

/**
 * One read declared by a skill: an artifact type, optionally pinned to an
 * instance key (multi-instance types, e.g. `content.page` / `page.composition`).
 * Omitting `key` on a multi-instance type reads ALL its approved instances.
 */
export interface SkillContextRead {
  type: ArtifactTypeKey;
  key?: string;
}

/** One artifact included in the context, with the exact version read (§9.6). */
export interface ContextArtifact {
  artifactId: string;
  type: string;
  key: string | null;
  /** Sealed version the payload comes from; for a draft, its base version. */
  version: number;
  /**
   * `approved` = sealed payload of the current version. `draft` = the target
   * artifact's own mutable draft (only ever allowed for the run's target).
   */
  source: "approved" | "draft";
  payload: unknown;
}

/** Dependency edge between two project artifacts (from depends on to). */
export interface ContextDependencyEdge {
  fromArtifactId: string;
  fromType: string;
  fromKey: string | null;
  toArtifactId: string;
  toType: string;
  toKey: string | null;
}

/** §9.4 — designed as if it were public: clean resources, no internals. */
export interface ProjectContext {
  project: {
    id: string;
    workspaceId: string;
    name: string;
    /** Current Cockpit phase, e.g. "spec", "ia". */
    phase: string;
  };
  /** Only APPROVED (sealed) versions — plus the target's own draft if any. */
  artifacts: ContextArtifact[];
  dependencies: ContextDependencyEdge[];
  phase: string;
}

// ---------------------------------------------------------------------------
// Skill contract (§9.1)
// ---------------------------------------------------------------------------

/**
 * JSON Schema object for structured outputs. Provider constraints (June 2026):
 * every object MUST declare `additionalProperties: false`; `minLength` /
 * `maximum` are NOT supported.
 */
export type JsonSchema = Record<string, unknown>;

/** Everything a skill receives to build its prompt / proposal. */
export interface SkillPromptInput {
  context: ProjectContext;
  /** The artifact the proposal will be saved to (as its draft). */
  target: { artifactId: string; type: string; key: string | null };
  /** Free-form user directive (e.g. revise-artifact: "tono más premium"). */
  instruction: string | null;
}

/** What the runner sends to the provider: §16 `complete()` request parts. */
export interface SkillPrompt {
  system: string;
  user: string;
  /** JSON Schema the provider must satisfy (structured outputs). */
  schema: JsonSchema;
  /** ~8000 for skills; bounded by the skill's cost budget (§9.1). */
  maxTokens: number;
}

/**
 * Operational contract of a skill (§9.1). Implemented by the 5 MVP skills in
 * `src/modules/agents/skills/` and consumed by the runner. `startRun` takes
 * the resolved definition — resolving name → definition is the caller's job
 * (skills registry), which keeps runtime and skill catalog decoupled.
 */
export interface SkillDefinition {
  /** Skill name. The 5 MVP skills use {@link AgentSkillName} values. */
  name: string;
  /** Exact version recorded on every run (§9.1). */
  version: string;
  /** Human label (Spanish, UI language). */
  label: string;
  /** Declared reads — resolved through the Project Context API (§9.4). */
  reads: SkillContextRead[];
  /** Artifact type this skill writes (the run target must match). */
  writes: ArtifactTypeKey;
  /** Always true in MVP: every proposal awaits a human (§8.6). */
  requiresApproval: true;
  /** Builds the provider request from context + instruction. */
  buildPrompt(input: SkillPromptInput): SkillPrompt;
  /**
   * Parses the provider JSON into a payload VALID for the target artifact
   * type (Zod). MUST throw on invalid shape — the runner turns that into a
   * failed run, never into a stored invalid draft.
   */
  parseProposal(json: unknown, input: SkillPromptInput): unknown;
  /** Skill validations (§9.1) shown next to the diff; never block the proposal. */
  validate(payload: unknown, input: SkillPromptInput): AgentRunValidation[];
  /**
   * Deterministic, plausible, Spanish-content payload for the MOCK provider
   * (first-class for demo/e2e offline). No clock timestamps, no randomness:
   * same input ⇒ same output.
   */
  buildMockProposal(input: SkillPromptInput): unknown;
}

// ---------------------------------------------------------------------------
// LLM provider interface (§16 — one interface, N providers)
// ---------------------------------------------------------------------------

export interface LlmCompleteRequest {
  system: string;
  user: string;
  /** JSON Schema for structured output. */
  schema: JsonSchema;
  maxTokens: number;
}

export interface LlmCompleteResult {
  /** Parsed JSON satisfying the request schema. */
  json: unknown;
  usage: { inputTokens: number; outputTokens: number };
  /** Real model id used (e.g. "claude-sonnet-4-6", "mock-deterministic-1"). */
  modelId: string;
}

/**
 * The ONE provider interface. Implementations are created per run via their
 * factory; the decrypted API key lives ONLY inside the factory closure —
 * never on this interface, never on requests, never in errors or logs.
 */
export interface LlmProvider {
  readonly kind: LlmProviderKind;
  complete(req: LlmCompleteRequest): Promise<LlmCompleteResult>;
}

/** Typed provider failure (§16: explicit quota/auth/refusal handling). */
export type LlmErrorCode =
  | "AUTH_FAILED" // 401 — invalid key: the run fails and the key is flagged
  | "RATE_LIMITED" // 429 after retry
  | "OVERLOADED" // 529/5xx after retry
  | "REFUSED" // model refusal (stop_reason "refusal" / message.refusal)
  | "BAD_REQUEST" // 400 — no retry, report
  | "INVALID_RESPONSE" // non-JSON / truncated / schema-breaking output
  | "NETWORK"; // fetch-level failure

export class LlmProviderError extends Error {
  readonly code: LlmErrorCode;
  readonly providerKind: LlmProviderKind;
  readonly status?: number;
  readonly requestId?: string;

  constructor(
    code: LlmErrorCode,
    providerKind: LlmProviderKind,
    message: string,
    options: { status?: number; requestId?: string } = {},
  ) {
    super(message);
    this.name = "LlmProviderError";
    this.code = code;
    this.providerKind = providerKind;
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

export function isLlmProviderError(error: unknown): error is LlmProviderError {
  return error instanceof LlmProviderError;
}

// ---------------------------------------------------------------------------
// Agents domain errors
// ---------------------------------------------------------------------------

export type AgentsErrorCode =
  | "FORBIDDEN"
  | "PROJECT_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "KEY_NOT_FOUND"
  | "NO_KEY" // workspace has no key for the requested provider
  | "INVALID_KEY" // provider rejected the key during addKey validation
  | "PROVIDER_UNAVAILABLE" // could not reach the provider to validate
  | "MISSING_SECRET" // neither LLM_KEYS_SECRET nor AUTH_SECRET configured
  | "DECRYPT_FAILED"
  | "INVALID_STATE";

export class AgentsDomainError extends Error {
  readonly code: AgentsErrorCode;

  constructor(code: AgentsErrorCode, message: string) {
    super(message);
    this.name = "AgentsDomainError";
    this.code = code;
  }
}

export function isAgentsDomainError(error: unknown): error is AgentsDomainError {
  return error instanceof AgentsDomainError;
}

// ---------------------------------------------------------------------------
// Actors & re-exports
// ---------------------------------------------------------------------------

/**
 * A HUMAN actor (session user from the platform-core auth adapter). Same
 * shape as the artifacts module's `HumanActor` — runs are started by humans
 * with role, and only humans decide on proposals (§13, §19).
 */
export interface AgentActor {
  id: string; // usr_
  role: WorkspaceRole;
  workspaceId: string;
}

export type {
  AgentRunInputArtifact,
  AgentRunUsage,
  AgentRunValidation,
  LlmProviderKind,
};
