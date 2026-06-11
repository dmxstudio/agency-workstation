/**
 * Demo seed (npm run db:seed) — idempotent.
 *
 * Creates:
 * - Demo user        demo@agency.local / demo1234 (admin)
 * - Workspace        "Demo Agency" (slug `demo`)
 * - Project          "Sitio Corporativo Acme" with the 8 MVP artifacts
 *   - spec.intake    approved v2 (two immutable versions, kickoff + re-scope)
 *   - spec.strategy  approved v1 AND flagged `outdated` (marked by the
 *     propagation of intake v2 — §8.4: marks, never regenerates)
 *   - spec.sitemap   draft (pending review)
 * - Derived task "Re-validar «Estrategia»…" (opened by the propagation)
 * - One open manual task
 * - Activity feed entries (project created, drafts, reviews, approvals…)
 *
 * Everything flows through the real domain services (`createWorkspace`,
 * `createProject`, `saveDraft`, `submitForReview`, `approve`), so states,
 * versions, derived tasks and audit events are produced by the same code
 * paths the app uses.
 *
 * Idempotency: if the demo project already exists the seed prints the
 * credentials and exits without touching anything. To re-generate from
 * scratch: delete `./.data` and run `npm run db:migrate && npm run db:seed`.
 */
import { randomBytes, scrypt } from "node:crypto";
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
import { projects, tasks, users, workspaces } from "../src/db/schema";
import {
  approve,
  getProjectArtifacts,
  saveDraft,
  submitForReview,
  type HumanActor,
} from "../src/modules/artifacts/service";
import type { SpecIntakePayload } from "../src/modules/artifacts/types/spec-intake";
import type { SpecSitemapPayload } from "../src/modules/artifacts/types/spec-sitemap";
import type { SpecStrategyPayload } from "../src/modules/artifacts/types/spec-strategy";
import { logAudit } from "../src/modules/platform-core/audit";
import { createProject } from "../src/modules/platform-core/projects";
import { createWorkspace } from "../src/modules/platform-core/workspaces";

// ---------------------------------------------------------------------------
// Demo fixtures
// ---------------------------------------------------------------------------

const DEMO_EMAIL = "demo@agency.local";
const DEMO_PASSWORD = "demo1234";
const DEMO_NAME = "Demo Admin";
const DEMO_WORKSPACE_NAME = "Demo Agency";
const DEMO_WORKSPACE_SLUG = "demo";
const DEMO_PROJECT_NAME = "Sitio Corporativo Acme";

// ---------------------------------------------------------------------------
// Password hashing — mirrors the local auth provider format exactly
// (`scrypt:<N>:<r>:<p>:<salt b64>:<hash b64>`). Duplicated here on purpose:
// the provider lives behind `next/headers` (cookies) and cannot be imported
// from a plain Node script.
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, hash) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(
          [
            "scrypt",
            SCRYPT_N,
            SCRYPT_R,
            SCRYPT_P,
            salt.toString("base64"),
            hash.toString("base64"),
          ].join(":"),
        );
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Realistic demo payloads (Spanish — the product UI language)
// ---------------------------------------------------------------------------

const intakeV1: SpecIntakePayload = {
  objective:
    "Renovar la presencia digital de Acme Industrial con un sitio corporativo que transmita fiabilidad y genere solicitudes de presupuesto cualificadas.",
  client: {
    name: "Acme Industrial S.A.",
    industry: "Fabricación de maquinaria de envasado",
    website: "https://www.acme-industrial.example",
    contactName: "Laura Gómez",
    contactEmail: "laura.gomez@acme-industrial.example",
  },
  scope: {
    inScope: [
      "Sitio corporativo de 6 páginas (inicio, servicios, proyectos, nosotros, blog, contacto)",
      "Formulario de contacto con solicitud de presupuesto",
      "Blog corporativo editable desde el CMS",
      "SEO técnico básico y analítica de visitas",
    ],
    outOfScope: [
      "E-commerce y pagos online",
      "Área privada de clientes",
      "Campañas de paid media",
    ],
  },
  constraints: {
    budget: "12.000 € (presupuesto cerrado)",
    deadline: "2026-09-15",
    technical: [
      "Integración del formulario con HubSpot CRM",
      "Hosting en la infraestructura actual del cliente (Vercel)",
    ],
    legal: [
      "RGPD: banner de consentimiento de cookies",
      "Aviso legal y política de privacidad revisados por su asesoría",
    ],
  },
  brandInputs: {
    hasLogo: true,
    hasStyleGuide: false,
    assetsUrl: "https://drive.example.com/acme-brand",
    notes:
      "Logo vectorial disponible. No existe guía de estilo formal: solo colores corporativos (azul #003D7A y gris) y tipografía del catálogo impreso.",
  },
  successCriteria: [
    "Sitio publicado antes del 15 de septiembre de 2026",
    "20 solicitudes de presupuesto al mes a los 3 meses del lanzamiento",
    "Carga inferior a 2 segundos en móvil (LCP)",
  ],
};

/** v2: ampliación de alcance acordada con el cliente tras el kickoff. */
const intakeV2: SpecIntakePayload = {
  ...intakeV1,
  scope: {
    ...intakeV1.scope,
    inScope: [
      ...intakeV1.scope.inScope,
      "Página de carreras con listado de vacantes gestionado desde el CMS",
    ],
  },
  successCriteria: [
    ...intakeV1.successCriteria,
    "Al menos 5 candidaturas mensuales a través de la página de carreras",
  ],
};

const strategyV1: SpecStrategyPayload = {
  audiences: [
    {
      name: "Directores de operaciones de pymes industriales",
      description:
        "Deciden la compra de maquinaria; valoran fiabilidad, plazos de entrega y servicio postventa.",
      needs: [
        "Comparar especificaciones técnicas sin fricción",
        "Ver casos de éxito con resultados medibles",
        "Solicitar presupuesto en menos de un minuto",
      ],
    },
    {
      name: "Ingenieros de planta",
      description:
        "Prescriptores técnicos; consultan fichas de producto y documentación de mantenimiento.",
      needs: [
        "Documentación técnica descargable",
        "Información de repuestos y tiempos de respuesta del SAT",
      ],
    },
  ],
  positioning:
    "Acme Industrial es el fabricante ibérico de maquinaria de envasado con el servicio postventa más rápido: soporte técnico propio en menos de 24 horas.",
  valueProposition:
    "Maquinaria fiable y mantenimiento garantizado: reducimos las paradas de producción de nuestros clientes.",
  differentiators: [
    "Servicio técnico propio con cobertura nacional en 24 h",
    "40 años fabricando en España",
    "Stock permanente de repuestos originales",
  ],
  toneOfVoice: {
    attributes: ["cercano", "técnico", "directo", "fiable"],
    notes:
      "Evitar jerga comercial vacía; hablar con datos y plazos concretos. Tratamiento de usted en las páginas corporativas.",
  },
};

const sitemapDraft: SpecSitemapPayload = {
  pages: [
    {
      title: "Inicio",
      slug: "inicio",
      description: "Propuesta de valor, líneas de producto y casos destacados.",
      children: [],
    },
    {
      title: "Servicios",
      slug: "servicios",
      description: "Líneas de maquinaria y servicios de mantenimiento.",
      children: [
        { title: "Maquinaria de envasado", slug: "maquinaria-envasado", children: [] },
        { title: "Líneas de producción", slug: "lineas-produccion", children: [] },
        {
          title: "Mantenimiento y repuestos",
          slug: "mantenimiento-repuestos",
          children: [],
        },
      ],
    },
    {
      title: "Proyectos",
      slug: "proyectos",
      description: "Casos de éxito con resultados medibles.",
      children: [],
    },
    {
      title: "Nosotros",
      slug: "nosotros",
      description: "Historia, equipo, planta de producción y certificaciones.",
      children: [],
    },
    { title: "Blog", slug: "blog", children: [] },
    {
      title: "Contacto",
      slug: "contacto",
      description: "Formulario de solicitud de presupuesto conectado a HubSpot.",
      children: [],
    },
  ],
  navigation: {
    header: ["inicio", "servicios", "proyectos", "nosotros", "contacto"],
    footer: ["servicios", "blog", "contacto"],
  },
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function printCredentials(): void {
  console.log("\n────────────────────────────────────────────");
  console.log("Credenciales demo");
  console.log(`  URL:        http://localhost:3000/login`);
  console.log(`  Email:      ${DEMO_EMAIL}`);
  console.log(`  Contraseña: ${DEMO_PASSWORD}`);
  console.log(`  Workspace:  ${DEMO_WORKSPACE_NAME} (/w/${DEMO_WORKSPACE_SLUG})`);
  console.log("────────────────────────────────────────────");
}

async function main(): Promise<void> {
  const db = getDb();

  // --- Demo user (idempotent by unique email) ------------------------------
  let userId: string;
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, DEMO_EMAIL), isNull(users.deletedAt)))
    .limit(1);
  if (existingUser[0]) {
    userId = existingUser[0].id;
    console.log(`Usuario demo ya existe (${userId}).`);
  } else {
    userId = newId.user();
    await db.insert(users).values({
      id: userId,
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      name: DEMO_NAME,
    });
    console.log(`Usuario demo creado (${userId}).`);
  }

  // --- Workspace (idempotent by unique slug) -------------------------------
  let workspaceId: string;
  const existingWorkspace = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.slug, DEMO_WORKSPACE_SLUG), isNull(workspaces.deletedAt)))
    .limit(1);
  if (existingWorkspace[0]) {
    workspaceId = existingWorkspace[0].id;
    console.log(`Workspace "${DEMO_WORKSPACE_NAME}" ya existe (${workspaceId}).`);
  } else {
    const workspace = await createWorkspace(
      DEMO_WORKSPACE_NAME,
      DEMO_WORKSPACE_SLUG,
      userId,
    );
    workspaceId = workspace.id;
    console.log(`Workspace "${DEMO_WORKSPACE_NAME}" creado (${workspaceId}).`);
  }

  // --- Project (idempotency cutoff: existing project ⇒ nothing to do) ------
  const existingProject = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.name, DEMO_PROJECT_NAME),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (existingProject[0]) {
    console.log(
      `Proyecto "${DEMO_PROJECT_NAME}" ya existe (${existingProject[0].id}); seed omitido.`,
    );
    printCredentials();
    return;
  }

  const project = await createProject(workspaceId, DEMO_PROJECT_NAME, userId);
  console.log(`Proyecto "${DEMO_PROJECT_NAME}" creado (${project.id}) con sus 8 artefactos.`);

  const actor: HumanActor = { id: userId, role: "admin", workspaceId };
  const artifacts = await getProjectArtifacts(project.id);
  const byType = new Map(artifacts.map((item) => [item.artifact.type, item.artifact]));
  const intake = byType.get("spec.intake");
  const strategy = byType.get("spec.strategy");
  const sitemap = byType.get("spec.sitemap");
  if (!intake || !strategy || !sitemap) {
    throw new Error("El grafo de artefactos del proyecto demo no se instanció correctamente.");
  }

  // --- spec.intake → approved v1 (ciclo §13 completo) ----------------------
  await saveDraft(intake.id, intakeV1, actor);
  await submitForReview(intake.id, actor);
  await approve(intake.id, actor, "Visto bueno en la reunión de kickoff con el cliente.");
  console.log("spec.intake: borrador → revisión → aprobado (v1).");

  // --- spec.strategy → approved v1 ------------------------------------------
  await saveDraft(strategy.id, strategyV1, actor);
  await submitForReview(strategy.id, actor);
  await approve(strategy.id, actor, "Estrategia validada con la dirección comercial de Acme.");
  console.log("spec.strategy: borrador → revisión → aprobado (v1).");

  // --- spec.sitemap → draft (pendiente de revisión) -------------------------
  await saveDraft(sitemap.id, sitemapDraft, actor);
  console.log("spec.sitemap: borrador guardado (en draft).");

  // --- spec.intake v2 → re-aprobación que propaga `outdated` (§8.4) ---------
  // Editing an approved artifact opens the draft of its next version; the
  // approval seals v2 and MARKS the dependent strategy as outdated (it never
  // regenerates anything), deriving the re-validation task.
  await saveDraft(intake.id, intakeV2, actor);
  await submitForReview(intake.id, actor);
  const reapproval = await approve(
    intake.id,
    actor,
    "Ampliación de alcance acordada: se añade la página de carreras.",
  );
  console.log(
    `spec.intake: v2 aprobada; propagación outdated → ${reapproval.outdatedDependentIds.length} dependiente(s) marcados (spec.strategy).`,
  );

  // --- Manual open task (mirrors the Cockpit's create-task action) ----------
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(tasks)
      .values({
        id: newId.task(),
        projectId: project.id,
        kind: "manual",
        title:
          "Recopilar assets de marca del cliente (logo vectorial y fotografías de planta)",
        status: "open",
        assigneeId: userId,
        artifactId: null,
        dedupeKey: null,
      })
      .returning();
    await logAudit(
      {
        workspaceId,
        projectId: project.id,
        actorId: userId,
        action: "task.created",
        entityType: "task",
        entityId: inserted[0].id,
        detail: { title: inserted[0].title, kind: "manual", assigneeId: userId },
      },
      tx,
    );
  });
  console.log("Tarea manual abierta creada.");

  console.log("\nSeed completado:");
  console.log("  - spec.intake    approved (v2, 2 versiones inmutables)");
  console.log("  - spec.strategy  approved (v1) + flag outdated (propagación §8.4)");
  console.log("  - spec.sitemap   draft");
  console.log("  - 1 tarea derivada de re-validación + 1 tarea manual abiertas");
  printCredentials();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
