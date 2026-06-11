/**
 * Smoke test of the agents runtime core against the local DB — NO real
 * network: `globalThis.fetch` is mocked for every provider call.
 *
 * Covers:
 * 1. Crypto: AES-256-GCM roundtrip, tamper/wrong-key failures, redaction.
 * 2. BYOK keys: addKey (provider-validated) + list WITHOUT values + soft delete.
 * 3. startRun with the MOCK provider + an inline fake skill → `proposed`
 *    with the target draft (provenance) and correct `inputArtifacts`.
 * 4. Run with an anthropic key the API rejects → `failed` AUTH_FAILED
 *    (no retry on 401; key flagged) — plus 529→200 retry → `proposed` + cost.
 * 5. Leak scan: the plaintext key appears nowhere (runs, keys, audit).
 *
 * Run with:  npm run db:migrate && npx tsx scripts/smoke-agents-runtime.ts
 * Cleans up after itself (deletes its own workspace; cascades take the rest).
 */
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { newId } from "../src/db/ids";
import {
  agentRuns,
  artifacts,
  auditLog,
  projects,
  users,
  workspaceLlmKeys,
  workspaceMembers,
  workspaces,
} from "../src/db/schema";
import {
  approve,
  computeDiff,
  ensureProjectArtifacts,
  saveDraft,
  submitForReview,
  type HumanActor,
} from "../src/modules/artifacts/service";
import {
  specStrategyPayloadSchema,
  type SpecStrategyPayload,
} from "../src/modules/artifacts/types/spec-strategy";
import {
  decryptApiKey,
  deriveMasterKey,
  encryptApiKey,
  redactApiKey,
  resolveMasterKey,
} from "../src/modules/agents/keys/crypto";
import { addKey, deleteKey, listKeys } from "../src/modules/agents/keys/service";
import {
  isAgentsDomainError,
  type SkillDefinition,
  type SkillPromptInput,
} from "../src/modules/agents/types";
import { recordRunDecision } from "../src/modules/agents/runtime/decisions";
import { MOCK_MODEL_ID } from "../src/modules/agents/runtime/providers/mock";
import { startRun, waitForRunSettled } from "../src/modules/agents/runtime/runner";

let passed = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`ASSERT FAIL: ${label}`);
  }
  passed += 1;
  console.log(`  ok - ${label}`);
}

async function expectAgentsError(
  fn: () => Promise<unknown>,
  code: string,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(
      isAgentsDomainError(error) && error.code === code,
      `${label} (code=${code})`,
    );
    return;
  }
  assert(false, label);
}

// ---------------------------------------------------------------------------
// fetch mock — no real network ever leaves this process
// ---------------------------------------------------------------------------

const VALID_ANTHROPIC_KEY = "sk-ant-smoke-valid-key-abcd";
const INVALID_ANTHROPIC_KEY = "sk-ant-smoke-invalid-key-zzzz";

const strategyFromApi: SpecStrategyPayload = {
  audiences: [
    {
      name: "Equipos de marketing B2B",
      description: "Buscan agencias con proceso claro.",
      needs: ["Entender la oferta rápido"],
    },
  ],
  positioning: "Acme Estudio como partner técnico-creativo de referencia.",
  valueProposition: "Sitios medibles entregados con un proceso transparente.",
  differentiators: ["Proceso transparente"],
  toneOfVoice: { attributes: ["experto", "cercano"], notes: "Sin jerga innecesaria." },
};

type MessagesBehavior = "auth-failed" | "overloaded-then-ok";
let messagesBehavior: MessagesBehavior = "auth-failed";
let messagesPostCount = 0;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const anthropicAuthError = {
  type: "error",
  error: { type: "authentication_error", message: "invalid x-api-key" },
  request_id: "req_smoke_auth",
};

const realFetch = globalThis.fetch;

function installFetchMock(): void {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.anthropic.com/v1/models") {
      const headers = new Headers(init?.headers);
      const key = headers.get("x-api-key");
      return key === VALID_ANTHROPIC_KEY
        ? jsonResponse(200, { data: [] })
        : jsonResponse(401, anthropicAuthError);
    }

    if (url === "https://api.anthropic.com/v1/messages") {
      messagesPostCount += 1;
      if (messagesBehavior === "auth-failed") {
        return jsonResponse(401, anthropicAuthError);
      }
      // overloaded-then-ok: first call 529, retry succeeds.
      if (messagesPostCount === 1) {
        return jsonResponse(529, {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
          request_id: "req_smoke_529",
        });
      }
      return jsonResponse(200, {
        content: [{ type: "text", text: JSON.stringify(strategyFromApi) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
        model: "claude-sonnet-4-6",
      });
    }

    throw new Error(`smoke: unexpected fetch to ${url} (real network is forbidden here)`);
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Inline fake skill (the real 5 skills live in src/modules/agents/skills/)
// ---------------------------------------------------------------------------

function buildStrategyProposal(input: SkillPromptInput): SpecStrategyPayload {
  const intake = input.context.artifacts.find((a) => a.type === "spec.intake");
  const clientName =
    intake && typeof intake.payload === "object" && intake.payload !== null
      ? ((intake.payload as { client?: { name?: string } }).client?.name ?? "el cliente")
      : "el cliente";
  // Deterministic: derived only from the context, no clock, no randomness.
  return {
    audiences: [
      {
        name: `Clientes potenciales de ${clientName}`,
        description: "Decisores que evalúan agencias por confianza y claridad.",
        needs: ["Entender la oferta rápido", "Ver resultados comparables"],
      },
    ],
    positioning: `${clientName} como referente claro de su categoría.`,
    valueProposition: "Resultados medibles con un proceso transparente.",
    differentiators: ["Proceso visible de punta a punta"],
    toneOfVoice: { attributes: ["cercano", "experto"], notes: "Directo, sin jerga." },
  };
}

const fakeSkill: SkillDefinition = {
  name: "smoke-fake-skill",
  version: "0.1.0",
  label: "Skill de prueba (smoke)",
  reads: [{ type: "spec.intake" }],
  writes: "spec.strategy",
  requiresApproval: true,
  buildPrompt: (input) => ({
    system: "Eres el asistente de Agency Workstation. Responde SOLO JSON.",
    user: `Propón la estrategia del proyecto ${input.context.project.name}. Leído: ${JSON.stringify(
      input.context.artifacts.map((a) => ({ type: a.type, version: a.version })),
    )}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { positioning: { type: "string" } },
      required: ["positioning"],
    },
    maxTokens: 8000,
  }),
  parseProposal: (json) => specStrategyPayloadSchema.parse(json),
  validate: (payload) => {
    const parsed = payload as SpecStrategyPayload;
    return [
      {
        key: "non-empty-positioning",
        label: "Posicionamiento no vacío",
        ok: parsed.positioning.trim().length > 0,
      },
      {
        key: "has-audience",
        label: "Al menos una audiencia definida",
        ok: parsed.audiences.length >= 1,
      },
    ];
  },
  buildMockProposal: buildStrategyProposal,
};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = getDb();

  // -------------------------------------------------------------------------
  console.log("\n# Crypto — AES-256-GCM roundtrip, tamper, redact");
  const keyA = deriveMasterKey("smoke-secret-a");
  const keyB = deriveMasterKey("smoke-secret-b");
  const plaintext = "sk-ant-roundtrip-0123456789";
  const encrypted = encryptApiKey(plaintext, keyA);
  assert(encrypted.startsWith("v1."), "el cifrado usa el formato v1.<iv>.<tag>.<data>");
  assert(!encrypted.includes(plaintext), "el ciphertext no contiene el plaintext");
  assert(decryptApiKey(encrypted, keyA) === plaintext, "roundtrip cifrar→descifrar");
  assert(
    encryptApiKey(plaintext, keyA) !== encrypted,
    "IV aleatorio: cifrar dos veces produce ciphertexts distintos",
  );
  await expectAgentsError(
    async () => decryptApiKey(encrypted, keyB),
    "DECRYPT_FAILED",
    "descifrar con otra clave maestra falla",
  );
  const parts = encrypted.split(".");
  const tamperedData = Buffer.from(parts[3], "base64");
  tamperedData[0] = tamperedData[0] ^ 0xff;
  const tampered = [parts[0], parts[1], parts[2], tamperedData.toString("base64")].join(".");
  await expectAgentsError(
    async () => decryptApiKey(tampered, keyA),
    "DECRYPT_FAILED",
    "el tag GCM detecta el ciphertext alterado",
  );
  await expectAgentsError(
    async () => decryptApiKey("not-a-ciphertext", keyA),
    "DECRYPT_FAILED",
    "formato no reconocido falla limpio",
  );
  assert(redactApiKey(plaintext) === "6789", "redact = últimos 4 caracteres");
  assert(resolveMasterKey({ LLM_KEYS_SECRET: "x" }).length === 32, "master key de LLM_KEYS_SECRET");
  assert(resolveMasterKey({ AUTH_SECRET: "y" }).length === 32, "fallback a AUTH_SECRET");
  await expectAgentsError(
    async () => resolveMasterKey({}),
    "MISSING_SECRET",
    "sin secretos configurados falla claro",
  );

  // -------------------------------------------------------------------------
  console.log("\n# Setup — workspace + admin + proyecto + intake aprobado");
  const workspaceId = newId.workspace();
  const adminId = newId.user();
  const projectId = newId.project();
  const stamp = Date.now();

  await db.insert(users).values({
    id: adminId,
    email: `smoke-agents-${stamp}@example.com`,
    passwordHash: "x",
    name: "Smoke Agents Admin",
  });
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `smoke-agents-${stamp}`,
    name: "Smoke Agents Workspace",
  });
  await db.insert(workspaceMembers).values({ workspaceId, userId: adminId, role: "admin" });
  await db.insert(projects).values({ id: projectId, workspaceId, name: "Proyecto Smoke Agents" });

  const admin: HumanActor = { id: adminId, role: "admin", workspaceId };

  const created = await ensureProjectArtifacts(projectId, admin);
  const intake = created.find((a) => a.type === "spec.intake");
  const strategy = created.find((a) => a.type === "spec.strategy");
  assert(intake != null && strategy != null, "grafo instanciado con intake y strategy");
  const intakeId = (intake as NonNullable<typeof intake>).id;
  const strategyId = (strategy as NonNullable<typeof strategy>).id;

  await saveDraft(
    intakeId,
    {
      objective: "Lanzar el nuevo sitio corporativo de Acme Estudio.",
      client: { name: "Acme Estudio", industry: "Servicios B2B" },
      scope: {
        inScope: ["Sitio corporativo de 5 páginas"],
        outOfScope: ["E-commerce"],
      },
      constraints: { technical: [], legal: [] },
      brandInputs: { hasLogo: true, hasStyleGuide: false },
      successCriteria: ["Aumentar leads un 20%"],
    },
    admin,
  );
  await submitForReview(intakeId, admin);
  const intakeApproval = await approve(intakeId, admin, "Intake validado (smoke)");
  assert(intakeApproval.version.version === 1, "intake aprobado como v1 (humano)");

  installFetchMock();

  try {
    // -----------------------------------------------------------------------
    console.log("\n# Keys — addKey mock + list SIN valor + soft delete");
    const mockKey = await addKey(
      { workspaceId, provider: "mock", label: "Mock demo", apiKey: "mock-key-12345678" },
      admin,
    );
    assert(mockKey.id.startsWith("key_"), "la key recibe id key_…");
    assert(mockKey.last4 === "5678", "last4 correcto");
    const listed = await listKeys(workspaceId, admin);
    assert(listed.length === 1, "listKeys devuelve la key del workspace");
    const listedJson = JSON.stringify(listed);
    assert(
      !listedJson.includes("mock-key-12345678") && !listedJson.includes("encryptedKey"),
      "listKeys no expone ni el valor ni el cifrado (solo id/label/last4)",
    );
    const client: HumanActor = { id: adminId, role: "client", workspaceId };
    await expectAgentsError(
      () => addKey({ workspaceId, provider: "mock", label: "x", apiKey: "abcd1234" }, client),
      "FORBIDDEN",
      "addKey exige rol admin",
    );
    await deleteKey(mockKey.id, admin);
    assert((await listKeys(workspaceId, admin)).length === 0, "deleteKey es soft-delete (sale del listado)");

    await expectAgentsError(
      () =>
        addKey(
          { workspaceId, provider: "anthropic", label: "Mala", apiKey: INVALID_ANTHROPIC_KEY },
          admin,
        ),
      "INVALID_KEY",
      "addKey valida contra el proveedor ANTES de guardar (401 → no se guarda)",
    );
    const anthropicKey = await addKey(
      { workspaceId, provider: "anthropic", label: "Anthropic prod", apiKey: VALID_ANTHROPIC_KEY },
      admin,
    );
    assert(anthropicKey.lastValidatedAt != null, "la key validada registra lastValidatedAt");

    // -----------------------------------------------------------------------
    console.log("\n# Run con MOCK — queued → running → proposed (draft + inputArtifacts)");
    const queued = await startRun(
      {
        projectId,
        skill: fakeSkill,
        provider: "mock",
        targetType: "spec.strategy",
      },
      admin,
    );
    assert(queued.status === "queued", "startRun devuelve la fila queued sin bloquear");
    assert(queued.skill === "smoke-fake-skill" && queued.skillVersion === "0.1.0", "skill y versión registradas");

    const proposed = await waitForRunSettled(queued.id);
    assert(proposed.status === "proposed", "el run termina en proposed");
    assert(proposed.modelId === MOCK_MODEL_ID, "modelId del mock determinista");
    assert(proposed.keyRef === null, "el mock no consume ninguna key (keyRef null)");
    assert(proposed.finishedAt != null, "finishedAt sellado");
    assert(
      Array.isArray(proposed.inputArtifacts) &&
        proposed.inputArtifacts.length === 1 &&
        proposed.inputArtifacts[0].type === "spec.intake" &&
        proposed.inputArtifacts[0].key === null &&
        proposed.inputArtifacts[0].version === 1 &&
        proposed.inputArtifacts[0].source === "approved",
      "inputArtifacts registra EXACTAMENTE lo leído: spec.intake v1 aprobado",
    );
    assert(
      (proposed.validations ?? []).length === 2 && (proposed.validations ?? []).every((v) => v.ok),
      "validaciones de la skill registradas y en verde",
    );
    assert(proposed.usage != null && proposed.usage.costUsd === 0, "usage con costUsd 0 (mock)");

    const strategyRows = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, strategyId))
      .limit(1);
    const strategyRow = strategyRows[0];
    assert(strategyRow.status === "draft", "la propuesta es un DRAFT — jamás approved (§19)");
    assert(strategyRow.proposedByRunId === queued.id, "provenance: artifacts.proposedByRunId = run id");
    assert(
      specStrategyPayloadSchema.safeParse(strategyRow.draftPayload).success,
      "el draft propuesto valida contra el schema Zod del tipo",
    );
    const diff = await computeDiff(strategyId);
    assert(diff.changes.length > 0 && diff.to.kind === "draft", "diff estructural disponible (propuesta vs nada)");

    const runAudit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "agent_run"), eq(auditLog.entityId, queued.id)));
    const auditActions = runAudit.map((row) => row.action).sort();
    assert(
      auditActions.includes("agent_run.queued") &&
        auditActions.includes("agent_run.started") &&
        auditActions.includes("agent_run.proposed"),
      "audit log: queued + started + proposed",
    );

    // Decisión HUMANA: aprueba vía artifacts y se refleja en el run.
    await submitForReview(strategyId, admin);
    const strategyApproval = await approve(strategyId, admin, "Propuesta del agente aprobada");
    const decided = await recordRunDecision(
      { runId: queued.id, decision: "approved", resultVersion: strategyApproval.version.version },
      admin,
    );
    assert(
      decided.status === "approved" && decided.decidedBy === adminId && decided.resultVersion === 1,
      "decisión humana registrada en el run (decidedBy/decidedAt/resultVersion)",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Run anthropic con key inválida — failed AUTH_FAILED (sin red real)");
    messagesBehavior = "auth-failed";
    messagesPostCount = 0;
    const authRun = await startRun(
      { projectId, skill: fakeSkill, provider: "anthropic", targetType: "spec.strategy" },
      admin,
    );
    const authSettled = await waitForRunSettled(authRun.id);
    assert(authSettled.status === "failed", "el run falla (no se propone nada)");
    assert(
      (authSettled.errorDetail ?? "").startsWith("AUTH_FAILED:"),
      "errorDetail diferenciado y legible: AUTH_FAILED",
    );
    assert(messagesPostCount === 1, "401 NO se reintenta (exactamente 1 POST)");
    assert(authSettled.keyRef === anthropicKey.id, "el run registra keyRef (id, nunca el valor)");
    const flaggedKeyRows = await db
      .select()
      .from(workspaceLlmKeys)
      .where(eq(workspaceLlmKeys.id, anthropicKey.id))
      .limit(1);
    assert(flaggedKeyRows[0].lastValidatedAt === null, "la key queda marcada tras el 401");
    const strategyAfterFail = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, strategyId))
      .limit(1);
    assert(
      strategyAfterFail[0].status === "approved" && strategyAfterFail[0].currentVersion === 1,
      "el artefacto objetivo queda intacto tras el fallo",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Run anthropic 529→200 — un retry, proposed, coste calculado");
    messagesBehavior = "overloaded-then-ok";
    messagesPostCount = 0;
    const retryRun = await startRun(
      { projectId, skill: fakeSkill, provider: "anthropic", targetType: "spec.strategy" },
      admin,
    );
    const retrySettled = await waitForRunSettled(retryRun.id);
    assert(retrySettled.status === "proposed", "529 se reintenta una vez y el run propone");
    assert(messagesPostCount === 2, "exactamente 1 retry (2 POSTs)");
    assert(retrySettled.modelId === "claude-sonnet-4-6", "modelId real registrado");
    assert(
      retrySettled.usage != null &&
        retrySettled.usage.inputTokens === 100 &&
        retrySettled.usage.outputTokens === 50 &&
        retrySettled.usage.costUsd === 0.00105,
      "coste: 100 in × $3/MTok + 50 out × $15/MTok = $0.00105",
    );
    assert(
      Array.isArray(retrySettled.inputArtifacts) && retrySettled.inputArtifacts.length === 2,
      "inputArtifacts del segundo run: intake v1 + strategy v1 aprobados",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Fuga de keys — el plaintext no aparece en NINGÚN registro");
    const allRuns = await db.select().from(agentRuns).where(eq(agentRuns.projectId, projectId));
    const allAudit = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId));
    const allKeys = await db
      .select()
      .from(workspaceLlmKeys)
      .where(eq(workspaceLlmKeys.workspaceId, workspaceId));
    const everything = JSON.stringify({ allRuns, allAudit }) + JSON.stringify(allKeys.map((k) => ({ ...k, encryptedKey: undefined })));
    assert(
      !everything.includes(VALID_ANTHROPIC_KEY) && !everything.includes(INVALID_ANTHROPIC_KEY),
      "ni runs, ni audit, ni metadatos de keys contienen el valor de la key",
    );
    assert(
      allKeys.every((k) => !k.encryptedKey.includes(VALID_ANTHROPIC_KEY)),
      "el valor cifrado en DB no contiene el plaintext",
    );
    assert(
      decryptApiKey(allKeys.find((k) => k.id === anthropicKey.id)!.encryptedKey, resolveMasterKey()) ===
        VALID_ANTHROPIC_KEY,
      "el cifrado en reposo descifra al valor original con la master key del entorno",
    );

    // -----------------------------------------------------------------------
    console.log("\n# Garantía §19 — ningún camino del runtime aprueba artefactos");
    const finalArtifacts = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.projectId, projectId), isNull(artifacts.deletedAt)));
    const strategyFinal = finalArtifacts.find((a) => a.id === strategyId);
    assert(
      strategyFinal != null &&
        strategyFinal.currentVersion === 1 &&
        strategyFinal.status === "draft",
      "tras el run proposed, la nueva versión sigue siendo un draft pendiente de humano",
    );
  } finally {
    globalThis.fetch = realFetch;
    // Cleanup: workspace cascade takes projects/artifacts/runs/keys/audit.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, adminId));
  }

  console.log(`\nSMOKE OK — ${passed} asserts en verde.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSMOKE FAILED:", error);
    process.exit(1);
  });
