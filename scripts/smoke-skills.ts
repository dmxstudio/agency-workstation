/**
 * Smoke test de las 5 skills (§9.3) + provenance agent_run en artifacts
 * (§8.3/§8.6) contra la DB local, SIN red: el proveedor de cada propuesta es
 * el mock determinista de la skill (`buildMockProposal`).
 *
 * Cubre, por CADA skill (vía `bindSkillForRun` + Project Context API real):
 *   contexto → buildPrompt (schema apto para structured outputs: sin
 *   minLength/maximum/pattern, additionalProperties:false) → buildMockProposal
 *   determinista → parseProposal (Zod del tipo) → TODAS las validaciones en
 *   verde; para compose: el Data usa SOLO nombres del registry real del Studio.
 *
 * Y la provenance (§19 — innegociable):
 *   - saveProposalDraft + submit + approve HUMANO → versión sellada con
 *     origin "agent_run" + agentRunId; el run queda approved + resultVersion
 *     + decidedBy; el puntero proposedByRunId se limpia.
 *   - reject sobre draft propuesto → run rejected + feedback + decidedBy.
 *   - un saveDraft HUMANO limpia proposedByRunId (la propuesta deja de ser
 *     del run; al sellar, origin "human").
 *   - assert ESTÁTICO: ningún archivo de src/modules/agents importa
 *     approve/reject de artifacts ni sus server actions.
 *
 * Run with:  npm run db:migrate && npx tsx scripts/smoke-skills.ts
 * (PGlite es de un solo proceso: parar el dev server antes.)
 * Se limpia solo: borra su workspace y cascada.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

import { and, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { newId } from "../src/db/ids";
import {
  agentRuns,
  artifacts,
  users,
  projects,
  workspaceMembers,
  workspaces,
  type Artifact,
} from "../src/db/schema";
import { diffPayloads } from "../src/modules/artifacts/diff";
import { isArtifactDomainError } from "../src/modules/artifacts/errors";
import {
  approve,
  computeDiff,
  ensureProjectArtifacts,
  reject,
  saveDraft,
  saveProposalDraft,
  submitForReview,
  syncCompositionArtifacts,
  type HumanActor,
} from "../src/modules/artifacts/service";
import type { SpecIntakePayload } from "../src/modules/artifacts/types/spec-intake";
import type { SpecSitemapPayload } from "../src/modules/artifacts/types/spec-sitemap";
import type { SpecStrategyPayload } from "../src/modules/artifacts/types/spec-strategy";
import type { PageCompositionPayload } from "../src/modules/artifacts/types/page-composition";
import { getProjectContext } from "../src/modules/agents/context";
import { AGENT_SKILL_NAMES, type SkillPromptInput } from "../src/modules/agents/types";
import {
  COMPOSABLE_COMPONENTS,
  REGISTRY_COMPONENT_NAMES,
  SKILL_NAMES,
  bindSkillForRun,
  findProviderSchemaViolations,
  getSkill,
  type BoundSkill,
} from "../src/modules/agents/skills";
import { createPuckConfig } from "../src/modules/studio/registry";

let passed = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`ASSERT FAIL: ${label}`);
  }
  passed += 1;
  console.log(`  ok - ${label}`);
}

// ---------------------------------------------------------------------------
// Assert ESTÁTICO §19: el módulo agents no importa decisiones de artifacts
// ---------------------------------------------------------------------------

const FORBIDDEN_ARTIFACT_IMPORTS = new Set(["approve", "reject"]);

function listAgentsSourceFiles(): string[] {
  const base = path.join(root, "src", "modules", "agents");
  return readdirSync(base, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => path.join(base, file));
}

function assertAgentsNeverImportApprove(): void {
  const offenders: string[] = [];
  for (const file of listAgentsSourceFiles()) {
    const source = readFileSync(file, "utf8");
    const rel = path.relative(root, file);

    // (a) Imports nombrados desde cualquier ruta de artifacts.
    const namedImport = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
    for (const match of source.matchAll(namedImport)) {
      const [, names, sourcePath] = match;
      if (!sourcePath.includes("artifacts")) continue;
      for (const raw of names.split(",")) {
        const name = raw.replace(/\btype\b/g, "").split(/\s+as\s+/)[0].trim();
        if (FORBIDDEN_ARTIFACT_IMPORTS.has(name)) {
          offenders.push(`${rel}: import nombrado prohibido \`${name}\` de ${sourcePath}`);
        }
      }
    }

    // (b) Las server actions de artifacts no se importan JAMÁS desde agents.
    if (/from\s+["'][^"']*artifacts\/actions["']/.test(source)) {
      offenders.push(`${rel}: import de las server actions de artifacts`);
    }

    // (c) Namespace imports de artifacts: prohibido alcanzar approve/reject.
    const nsImport = /import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']*artifacts[^"']*)["']/g;
    for (const match of source.matchAll(nsImport)) {
      const ns = match[1];
      const reach = new RegExp(
        `${ns}\\s*\\.\\s*(approve|reject)\\b|${ns}[^\\n]*\\[\\s*["'](approve|reject)["']\\s*\\]`,
      );
      if (reach.test(source)) {
        offenders.push(`${rel}: acceso a approve/reject vía namespace \`${ns}\``);
      }
    }
  }
  assert(
    offenders.length === 0,
    `§19 estático: ningún archivo de agents importa/alcanza approve|reject de artifacts${
      offenders.length > 0 ? ` — ${offenders.join("; ")}` : ""
    }`,
  );
}

// ---------------------------------------------------------------------------
// Fixture de intake (determinista; menciona proyectos/blog/carreras para
// ejercitar las ramas de los mocks)
// ---------------------------------------------------------------------------

const intakeFixture: SpecIntakePayload = {
  objective:
    "Renovar la presencia digital de Acme Industrial con un sitio corporativo que genere solicitudes de presupuesto cualificadas.",
  client: {
    name: "Acme Industrial S.A.",
    industry: "Fabricación de maquinaria de envasado",
    website: "https://www.acme-industrial.example",
  },
  scope: {
    inScope: [
      "Sitio corporativo con páginas de servicios y proyectos destacados",
      "Blog corporativo editable desde el CMS",
      "Página de carreras con vacantes gestionadas desde el CMS",
    ],
    outOfScope: ["E-commerce y pagos online"],
  },
  constraints: { technical: [], legal: [] },
  brandInputs: { hasLogo: true, hasStyleGuide: false },
  successCriteria: [
    "20 solicitudes de presupuesto al mes a los 3 meses del lanzamiento",
    "Carga inferior a 2 segundos en móvil",
  ],
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = getDb();

  console.log("\n# Asserts estáticos (sin DB)");
  assertAgentsNeverImportApprove();
  assert(
    JSON.stringify([...SKILL_NAMES]) === JSON.stringify([...AGENT_SKILL_NAMES]),
    "skills/SKILL_NAMES y agents/AGENT_SKILL_NAMES son la MISMA lista cerrada (§9.3)",
  );

  // --- catálogo estático del registry vs. registry real del Studio ---------
  const puckComponents = createPuckConfig().components as Record<
    string,
    { defaultProps?: Record<string, unknown> }
  >;
  const realNames = Object.keys(puckComponents).sort();
  assert(
    JSON.stringify([...REGISTRY_COMPONENT_NAMES].sort()) === JSON.stringify(realNames),
    `el catálogo estático lista EXACTAMENTE los ${realNames.length} componentes del registry del Studio`,
  );
  for (const spec of COMPOSABLE_COMPONENTS) {
    const defaults = puckComponents[spec.name]?.defaultProps ?? {};
    const catalogProps = Object.keys(spec.props).sort().join(",");
    const realProps = Object.keys(defaults).sort().join(",");
    assert(
      catalogProps === realProps,
      `props exactas de ${spec.name} en el catálogo == defaultProps del registry`,
    );
  }

  // -------------------------------------------------------------------------
  // Fixtures DB
  // -------------------------------------------------------------------------
  console.log("\n# Setup");
  const workspaceId = newId.workspace();
  const adminId = newId.user();
  const projectId = newId.project();
  const stamp = Date.now();

  await db.insert(users).values({
    id: adminId,
    email: `smoke-skills-${stamp}@example.com`,
    passwordHash: "x",
    name: "Laura Aprobadora",
  });
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `smoke-skills-${stamp}`,
    name: "Smoke Skills Workspace",
  });
  await db.insert(workspaceMembers).values({ workspaceId, userId: adminId, role: "admin" });
  await db.insert(projects).values({
    id: projectId,
    workspaceId,
    name: "Acme Industrial — web corporativa",
  });
  const admin: HumanActor = { id: adminId, role: "admin", workspaceId };

  try {
    const all = await ensureProjectArtifacts(projectId, admin);
    const singleton = (type: string): Artifact => {
      const found = all.find((artifact) => artifact.type === type && artifact.key == null);
      if (!found) throw new Error(`fixture: falta el artefacto ${type}`);
      return found;
    };
    const intakeArt = singleton("spec.intake");
    const strategyArt = singleton("spec.strategy");
    const sitemapArt = singleton("spec.sitemap");
    const contentArt = singleton("content.page");
    const cmsArt = singleton("cms.collections");
    const tokensArt = singleton("design.tokens");

    const artifactRow = async (id: string): Promise<Artifact> => {
      const rows = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
      return rows[0];
    };
    const runRow = async (id: string) => {
      const rows = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
      return rows[0];
    };
    const insertProposedRun = async (skillName: string, target: Artifact): Promise<string> => {
      const id = newId.agentRun();
      await db.insert(agentRuns).values({
        id,
        workspaceId,
        projectId,
        skill: skillName,
        skillVersion: "1.0",
        status: "proposed",
        targetArtifactId: target.id,
        targetType: target.type,
        targetKey: target.key,
        provider: "mock",
        inputArtifacts: [],
        createdBy: adminId,
      });
      return id;
    };

    /**
     * Ejecuta una skill por el camino de producción SIN red: bind → Project
     * Context API real → buildPrompt (schema auditado) → mock → parse →
     * TODAS las validaciones. Devuelve la propuesta validada.
     */
    const runSkillMock = async (
      skillName: string,
      rawParams: unknown,
    ): Promise<{ bound: BoundSkill; target: Artifact; payload: unknown }> => {
      const bound = bindSkillForRun(getSkill(skillName), rawParams);
      const rows = await db
        .select()
        .from(artifacts)
        .where(and(eq(artifacts.projectId, projectId), isNull(artifacts.deletedAt)));
      const target = rows.find(
        (artifact) =>
          artifact.type === bound.target.type && artifact.key === bound.target.key,
      );
      if (!target) throw new Error(`no existe el target ${bound.target.type}:${bound.target.key}`);

      const context = await getProjectContext(projectId, bound.definition.reads, {
        targetArtifactId: target.id,
      });
      const input: SkillPromptInput = {
        context,
        target: { artifactId: target.id, type: target.type, key: target.key },
        instruction: bound.instruction,
      };

      const prompt = bound.definition.buildPrompt(input);
      assert(
        prompt.system.length > 0 && prompt.user.length > 0 && prompt.maxTokens === 8000,
        `${skillName}: buildPrompt produce system/user/maxTokens (costBudget §9.1)`,
      );
      const violations = findProviderSchemaViolations(prompt.schema);
      assert(
        violations.length === 0,
        `${skillName}: schema apto para structured outputs (sin minLength/pattern; objetos cerrados)${
          violations.length > 0 ? ` — ${violations.slice(0, 3).join("; ")}` : ""
        }`,
      );

      const mockA = bound.definition.buildMockProposal(input);
      const mockB = bound.definition.buildMockProposal(input);
      assert(
        JSON.stringify(mockA) === JSON.stringify(mockB),
        `${skillName}: el mock es determinista (mismo contexto ⇒ misma propuesta)`,
      );

      const payload = bound.definition.parseProposal(mockA, input);
      const validations = bound.definition.validate(payload, input);
      const failed = validations.filter((validation) => !validation.ok);
      assert(
        validations.length > 0 && failed.length === 0,
        `${skillName}: la propuesta mock pasa TODAS las validaciones (${validations
          .map((validation) => validation.key)
          .join(", ")})${failed.length > 0 ? ` — fallan: ${failed.map((f) => `${f.key}: ${f.detail ?? ""}`).join("; ")}` : ""}`,
      );
      return { bound, target, payload };
    };

    // -----------------------------------------------------------------------
    // Base: intake aprobado por un humano (origin human)
    // -----------------------------------------------------------------------
    console.log("\n# Intake humano aprobado");
    await saveDraft(intakeArt.id, intakeFixture, admin);
    await submitForReview(intakeArt.id, admin);
    const intakeApproved = await approve(intakeArt.id, admin, "Kickoff validado");
    assert(
      intakeApproved.version.origin === "human" && intakeApproved.version.agentRunId === null,
      "un draft humano sella origin human (sin run)",
    );

    // -----------------------------------------------------------------------
    // Skill 1a: generate-spec-draft (strategy) + provenance APPROVE
    // -----------------------------------------------------------------------
    console.log("\n# generate-spec-draft → spec.strategy (propuesta aprobada)");
    const strategyRun = await runSkillMock("generate-spec-draft", { target: "strategy" });
    assert(
      strategyRun.bound.target.type === "spec.strategy" && strategyRun.bound.target.key === null,
      "el target se resuelve por params (strategy)",
    );

    const run1 = await insertProposedRun("generate-spec-draft", strategyRun.target);
    await saveProposalDraft(strategyArt.id, strategyRun.payload, run1);
    let strategyRow = await artifactRow(strategyArt.id);
    assert(
      strategyRow.status === "draft" && strategyRow.proposedByRunId === run1,
      "saveProposalDraft deja DRAFT con proposedByRunId = run (jamás approved, §19)",
    );
    const proposalDiff = await computeDiff(strategyArt.id);
    assert(proposalDiff.changes.length > 0, "la propuesta produce diff estructural (§8.6)");

    await submitForReview(strategyArt.id, admin);
    strategyRow = await artifactRow(strategyArt.id);
    assert(
      strategyRow.proposedByRunId === run1,
      "enviar a revisión NO borra la provenance (sigue siendo la propuesta del run)",
    );

    const strategyApproved = await approve(strategyArt.id, admin, "Propuesta del agente OK");
    assert(
      strategyApproved.version.origin === "agent_run" &&
        strategyApproved.version.agentRunId === run1,
      "aprobar un draft propuesto sella la versión con origin agent_run + agentRunId (§8.3)",
    );
    assert(
      strategyApproved.approval.approvedBy === adminId,
      "la aprobación sigue siendo humana y auditada (§8.5)",
    );
    strategyRow = await artifactRow(strategyArt.id);
    assert(strategyRow.proposedByRunId === null, "tras aprobar, el puntero de provenance se limpia");
    const run1Row = await runRow(run1);
    assert(
      run1Row.status === "approved" &&
        run1Row.resultVersion === strategyApproved.version.version &&
        run1Row.decidedBy === adminId &&
        run1Row.decidedAt != null,
      "el run queda approved + resultVersion + decidedBy/decidedAt (escrito por artifacts)",
    );

    // run inexistente → error tipado, nada escrito
    try {
      await saveProposalDraft(sitemapArt.id, strategyRun.payload, "run_no_existe_123");
      assert(false, "saveProposalDraft exige un run existente del MISMO proyecto");
    } catch (error) {
      assert(
        isArtifactDomainError(error) && error.code === "AGENT_RUN_NOT_FOUND",
        "saveProposalDraft exige un run existente del MISMO proyecto (AGENT_RUN_NOT_FOUND)",
      );
    }

    // -----------------------------------------------------------------------
    // Skill 1b: generate-spec-draft (sitemap) + provenance REJECT + feedback
    // -----------------------------------------------------------------------
    console.log("\n# generate-spec-draft → spec.sitemap (propuesta rechazada con feedback)");
    const sitemapRun = await runSkillMock("generate-spec-draft", { target: "sitemap" });
    assert(
      sitemapRun.bound.target.type === "spec.sitemap",
      "la segunda invocación (params.target = sitemap) escribe el sitemap",
    );
    const sitemapPayload = sitemapRun.payload as SpecSitemapPayload;
    assert(
      sitemapPayload.pages.some((page) => page.slug === "home") &&
        sitemapPayload.pages.some((page) => page.slug === "carreras"),
      "el mock deriva páginas del intake real (home + carreras por el alcance)",
    );

    const run2 = await insertProposedRun("generate-spec-draft", sitemapRun.target);
    await saveProposalDraft(sitemapArt.id, sitemapRun.payload, run2);
    await submitForReview(sitemapArt.id, admin);
    const feedback = "Faltan las páginas legales; revisar con el cliente.";
    await reject(sitemapArt.id, feedback, admin);

    const sitemapRow = await artifactRow(sitemapArt.id);
    assert(
      sitemapRow.status === "draft" && sitemapRow.rejected && sitemapRow.proposedByRunId === null,
      "reject: vuelve a draft con flag rejected y limpia la provenance (§8.2)",
    );
    const run2Row = await runRow(run2);
    assert(
      run2Row.status === "rejected" &&
        run2Row.feedback === feedback &&
        run2Row.decidedBy === adminId &&
        run2Row.resultVersion === null,
      "el run queda rejected + feedback + decidedBy (§8.6/§9.6)",
    );

    // el humano retoma el draft y lo aprueba: ya es SUYO → origin human
    await saveDraft(sitemapArt.id, sitemapRun.payload, admin);
    await submitForReview(sitemapArt.id, admin);
    const sitemapApproved = await approve(sitemapArt.id, admin);
    assert(
      sitemapApproved.version.origin === "human" && sitemapApproved.version.agentRunId === null,
      "el draft re-adoptado por un humano sella origin human",
    );

    // -----------------------------------------------------------------------
    // Skill 2: generate-cms-schema + saveDraft humano LIMPIA provenance
    // -----------------------------------------------------------------------
    console.log("\n# generate-cms-schema → cms.collections (edición humana limpia provenance)");
    const cmsRun = await runSkillMock("generate-cms-schema", {});
    const run3 = await insertProposedRun("generate-cms-schema", cmsRun.target);
    await saveProposalDraft(cmsArt.id, cmsRun.payload, run3);
    let cmsRow = await artifactRow(cmsArt.id);
    assert(cmsRow.proposedByRunId === run3, "la propuesta del run lleva provenance");

    await saveDraft(cmsArt.id, cmsRun.payload, admin); // el humano edita (aunque no cambie nada)
    cmsRow = await artifactRow(cmsArt.id);
    assert(
      cmsRow.proposedByRunId === null,
      "un saveDraft HUMANO limpia proposedByRunId (el draft deja de ser del run)",
    );
    const run3Row = await runRow(run3);
    assert(
      run3Row.status === "proposed" && run3Row.decidedBy === null,
      "el run sin decisión sigue proposed (editar no decide)",
    );
    await submitForReview(cmsArt.id, admin);
    const cmsApproved = await approve(cmsArt.id, admin);
    assert(
      cmsApproved.version.origin === "human",
      "tras la edición humana, la versión sellada es origin human",
    );

    // -----------------------------------------------------------------------
    // design.tokens aprobado (input de compose)
    // -----------------------------------------------------------------------
    await saveDraft(
      tokensArt.id,
      {
        colors: { primary: "#003D7A" },
        typography: { fontFamilies: { sans: "Inter" }, baseSizePx: 16 },
        spacing: {},
        radii: {},
        components: [],
      },
      admin,
    );
    await submitForReview(tokensArt.id, admin);
    await approve(tokensArt.id, admin);

    // -----------------------------------------------------------------------
    // Skill 3: write-page-copy
    // -----------------------------------------------------------------------
    console.log("\n# write-page-copy → content.page");
    const copyRun = await runSkillMock("write-page-copy", {});
    const copyPages = (copyRun.payload as { pages: { slug: string }[] }).pages;
    assert(
      copyPages.length === (sitemapRun.payload as SpecSitemapPayload).pages.length &&
        copyPages.some((page) => page.slug === "home"),
      "el copy cubre todas las páginas del sitemap aprobado",
    );
    await saveDraft(contentArt.id, copyRun.payload, admin);
    await submitForReview(contentArt.id, admin);
    await approve(contentArt.id, admin);

    // -----------------------------------------------------------------------
    // Skill 4: compose-page-draft (keyed) — componentes del registry REAL
    // -----------------------------------------------------------------------
    console.log("\n# compose-page-draft → page.composition:home (keyed)");
    const sync = await syncCompositionArtifacts(projectId, admin);
    assert(
      sync.compositions.some((artifact) => artifact.key === "home"),
      "syncCompositionArtifacts deriva la instancia keyed `home` del sitemap aprobado",
    );

    const composeRun = await runSkillMock("compose-page-draft", { pageKey: "home" });
    assert(
      composeRun.bound.target.type === "page.composition" &&
        composeRun.bound.target.key === "home" &&
        composeRun.target.key === "home",
      "el target keyed sale de params.pageKey",
    );
    const composition = composeRun.payload as PageCompositionPayload;
    const realComponentNames = new Set(Object.keys(puckComponents));
    assert(
      composition.content.length >= 3 &&
        composition.content.every((block) => realComponentNames.has(block.type)),
      `el Data de Puck usa SOLO componentes del registry real (${composition.content
        .map((block) => block.type)
        .join(", ")})`,
    );
    const blockIds = composition.content.map((block) => block.props.id);
    assert(
      new Set(blockIds).size === blockIds.length &&
        blockIds.every((id) => id.endsWith("-1") || /-\d+$/.test(id)),
      `ids de bloque deterministas y únicos (${blockIds.join(", ")})`,
    );

    // provenance también funciona sobre artefactos keyed
    const run4 = await insertProposedRun("compose-page-draft", composeRun.target);
    await saveProposalDraft(composeRun.target.id, composeRun.payload, run4);
    await submitForReview(composeRun.target.id, admin);
    const composeApproved = await approve(composeRun.target.id, admin, "Composición inicial OK");
    assert(
      composeApproved.version.origin === "agent_run" &&
        composeApproved.version.agentRunId === run4 &&
        (await runRow(run4)).resultVersion === composeApproved.version.version,
      "la propuesta keyed aprobada sella origin agent_run + run approved",
    );

    // -----------------------------------------------------------------------
    // Skill 5: revise-artifact (instrucción dirigida sobre CUALQUIER tipo)
    // -----------------------------------------------------------------------
    console.log("\n# revise-artifact → spec.strategy (instrucción dirigida)");
    const instruction = "Haz el tono más premium y directo";
    const reviseRun = await runSkillMock("revise-artifact", {
      instruction,
      targetType: "spec.strategy",
    });
    assert(
      reviseRun.bound.instruction === instruction,
      "bindSkillForRun extrae la instrucción para auditarla en el run",
    );
    const revised = reviseRun.payload as SpecStrategyPayload;
    const approvedStrategy = strategyRun.payload as SpecStrategyPayload;
    assert(
      diffPayloads(approvedStrategy, revised).length > 0 &&
        (revised.toneOfVoice.notes ?? "").includes(instruction),
      "la revisión produce un diff mínimo que incorpora la instrucción",
    );
    assert(
      reviseRun.bound.definition.reads.some((read) => read.type === "spec.intake"),
      "revise-artifact lee el target + sus dependencias §8.4 (spec.intake)",
    );

    // y sobre un tipo keyed (composición): mismo contrato, sin tocar bloques
    const reviseCompose = await runSkillMock("revise-artifact", {
      instruction: "Ajusta la meta descripción al tono aprobado",
      targetType: "page.composition",
      targetKey: "home",
    });
    const revisedComposition = reviseCompose.payload as PageCompositionPayload;
    assert(
      revisedComposition.content.length === composition.content.length &&
        revisedComposition.content.every((block) => realComponentNames.has(block.type)),
      "revise sobre una composición conserva los bloques del registry",
    );

    console.log(`\nSMOKE OK — ${passed} asserts superados.`);
  } finally {
    // Cleanup: cascades remove projects, artifacts, versions, runs, audit.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(inArray(users.id, [adminId]));
    console.log("Cleanup completado (workspace smoke eliminado).");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSMOKE FAILED:", error);
    process.exit(1);
  });
