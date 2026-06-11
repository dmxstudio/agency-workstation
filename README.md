# Agency Workstation

**An agency production OS: from brief to deployed site, with AI that proposes and humans who govern.**

Agency Workstation is a platform monolith for web agencies. The thesis: agencies don't need another AI site generator — they need a production control system where every critical output is a typed, versioned, human-approved artifact, and AI operates inside that cycle instead of around it. This repository is the complete MVP (Next.js 16 + Drizzle + PGlite, with generated projects on Next + Payload + Puck), runnable locally with zero external services.

What makes it technically interesting:

- **Artifact model as the single source of truth (§8).** Every project decision — intake, strategy, sitemap, design tokens, CMS schema, page copy, page compositions, releases — is an artifact with a Zod-validated JSONB payload, an explicit state machine (`empty → draft → in_review → approved`), **immutable versions**, structural diffs, and a fixed dependency graph where `outdated` propagation *marks but never regenerates*. Every mutation hits an audit log.
- **Real code generation with governed regeneration (§18.2).** Approved artifacts compile into a self-contained Next.js + Payload + Puck project (one local git repo per project). Rendering is 100% deterministic (idempotence verified by hash), ownership is tracked per file in a sha256 manifest (`codegen` vs `human`), partial regeneration only rewrites pristine codegen files, and conflicts are **reported as data — never auto-resolved**.
- **A visual editor that never bypasses governance.** The Visual Studio embeds Puck over `page.composition` artifacts (one per page of the approved sitemap), with a 34-component registry mirrored from the generated project's template, CMS bindings validated against the approved schema, and the exact same approval cycle as every other artifact. The Data JSON renders identically in the platform canvas and the generated site.
- **Client review without accounts.** Review rounds run over a sealed release: a token link is the client's entire credential, the public page embeds the *real* preview deployment (iframe + per-section anchors), open comments derive tasks visible in the Cockpit, and client approvals are a separate type that **never transitions internal artifacts**.
- **Immutable releases behind a provider-agnostic deploy interface.** Releases freeze the checklist plus the exact sealed versions of every input and tag the generated repo; the local `DeployProvider` builds one immutable build per release (`git archive` of the tag — a sealed build is never rebuilt), serves production/preview slots, checks status against reality (live pid + HTTP probe), and rollback is just deploying the previous release. Vercel will sit behind the same interface.
- **A BYOK agent runtime where provenance ≠ decision (§19).** Five closed-list skills run through an async runner with `anthropic | openai | mock` providers behind one interface; workspace API keys are encrypted at rest (AES-256-GCM), never logged, never sent to the client, never reach generated projects. An agent run can only ever produce a *proposal* (draft + validations + diff); **no code path lets an agent approve an artifact** — a static assert in the smoke tests enforces it. Approving seals a version with `origin: "agent_run"`, which attributes the *content* to the run while the *decision* remains a human act, audited.

> **Docs are in Spanish** (the product's working language); the architecture map in [`CLAUDE.md`](CLAUDE.md) is the best starting point for both humans and coding agents. The full product spec is [`docs/product-spec-v1.2.md`](docs/product-spec-v1.2.md).

## Screenshots

| | |
|---|---|
| ![Project Cockpit](docs/screenshots/cockpit.png) **Project Cockpit** — phase gates, artifact states (an artifact can be `approved` *and* `outdated` at once), derived tasks and the audit-backed activity feed. | ![Visual Studio editor](docs/screenshots/studio-editor.png) **Visual Studio** — Puck canvas over a `page.composition` artifact rendering with the project's own design tokens; the approval cycle lives in the left rail. |
| ![Studio pages](docs/screenshots/studio-pages.png) **Studio index** — one composition artifact per approved-sitemap page, each with its sealed version, section count and state. | ![Assistant](docs/screenshots/assistant-skills.png) **The single contextual assistant** — five closed-list skills, each showing its §9.1 contract. Violet is reserved exclusively for agent activity. |

![Skill launch form](docs/screenshots/assistant-model-cost.png)
*Launching a skill: what it reads → what it writes (always as a proposal), per-invocation model selector with live cost-per-MTok, and the BYOK key referenced by label + last4 — never by value.*

---

## Estado

**MVP completo.** Los 6 pasos de la secuencia de construcción (§14) están construidos y cada uno tiene su drill end-to-end ejecutable:

1. **Platform core + modelo de artefactos** — auth local (email+password, sesiones httpOnly en DB) detrás de un adapter, workspaces con roles (`admin`/`member`/`client`), proyectos, audit log; 8 tipos de artefacto con payload Zod validado en cada escritura, versiones inmutables, aprobaciones exclusivamente humanas, diff estructural y propagación de `outdated`.
2. **Spec OS + Project Cockpit** — formularios tipados de las 6 secciones de spec; stepper de fases con gates, artefactos por fase, tareas y feed de actividad; editor de artefactos con tabs Editar/Diff/Historial.
3. **Generator** — generación y regeneración parcial idempotente de proyectos reales (Next 16 + Tailwind v4 + Payload 3 con SQLite embebido + Puck) desde artefactos aprobados, con manifest de ownership y conflictos como dato.
4. **Visual Studio + CMS** — editor Puck embebido sobre los artefactos de composición (mismo ciclo de aprobación §13), registry de 34 componentes, bindings CMS validados, preview responsive; vista read-only del modelo de contenido + mapa de bindings.
5. **Client Review + Deploy & Release** — checklist de release §7.8, releases inmutables (versión sellada + tag git), deploy local por slots con rollback, rondas de review de cliente por link con token y aprobación de cliente como tipo aparte.
6. **Agent Runtime** — asistente contextual único, las 5 skills de la lista cerrada §9.3, runner async in-process, BYOK cifrado por workspace, proveedor `mock` de primera clase y el ciclo propose → diff → decisión humana con provenance `agent_run`.

## Requisitos

- **Node.js 20+** y **git** en el PATH (el Generator crea un repo git por proyecto y el deploy local construye con `git archive`).
- Nada más: la base de datos por defecto es **PGlite** (Postgres embebido) y persiste en `./.data/pglite`. Sin Docker, sin servicios externos; la demo completa corre offline.

## Quickstart

```bash
npm install
npm run db:migrate   # aplica el schema a la DB local (PGlite)
npm run db:seed      # datos demo (idempotente; imprime los links al final)
npm run dev          # http://localhost:3000
```

Credenciales demo (las imprime también el seed):

| Campo      | Valor                   |
| ---------- | ----------------------- |
| Email      | `demo@agency.local`     |
| Contraseña | `demo1234`              |
| Workspace  | Demo Agency (`/w/demo`) |

El seed crea el proyecto **«Sitio Corporativo Acme»** con una historia realista producida por los servicios de dominio reales (no inserts a mano): `spec.intake` aprobado en v2 (re-scope que añade la página de carreras), `spec.strategy` marcado `outdated` por esa propagación (§8.4) y re-validado como v2, `spec.sitemap` aprobado (6 páginas), `design.tokens`, `cms.collections` y `content.page` aprobados, TODAS las composiciones (`page.composition`, un artefacto por página) selladas vía el ciclo §13, el repo del proyecto generado, el **release v1 sellado** (versión inmutable + tag git `release-1`), una **ronda de review de cliente abierta** con dos comentarios demo (uno abierto con su tarea derivada visible en el Cockpit, uno resuelto) y **sin aprobación de cliente** — ese momento queda para ti en `/review/<token>` (el seed imprime el link). El seed **nunca despliega** (los builds tardan minutos).

Además deja **un agent run real en `proposed`**: el workspace recibe una key `mock` BYOK («Proveedor de demostración») y el runner deja una propuesta de `revise-artifact` sobre la composición de «Nosotros» (proveedor mock determinista, $0) esperando tu decisión humana — el seed también imprime ese link. El run se crea solo si el proyecto aún no tiene runs; una vez decidido, el momento no se re-abre re-sembrando (demo impoluta: borra `./.data` y re-siembra).

> **PGlite es de un solo proceso:** para el dev server (`npm run dev`) antes de ejecutar el seed o cualquier script `tsx` que toque la DB, y relánzalo después.

Para regenerar la demo desde cero: borra `./.data` y repite `db:migrate` + `db:seed`.

## Tour de la demo

El recorrido completo brief → sitio desplegado, en orden:

1. **Cockpit** (`/w/demo/p/<id>`) — stepper de fases con gates, artefactos por fase con StatusPill y flags, tareas (incluida la derivada del comentario de cliente abierto) y feed de actividad/audit completo.
2. **Spec OS** — abre cualquier artefacto de spec: tabs Editar/Diff/Historial, barra de acciones por estado y rol, historial de versiones inmutables (mira el diff v1→v2 de `spec.intake`).
3. **Generator** (`…/generator`) — la checklist exige `spec.sitemap`, `cms.collections` y `design.tokens` aprobados (el seed los deja listos) y solo consume versiones selladas. Genera/regenera el repo en `.data/projects/<projectId>/` con commit descriptivo y manifest de ownership; los conflictos (§18.2) se reportan en pantalla, nunca se auto-resuelven. Para correr el proyecto generado (pasos del usuario — la plataforma nunca instala dependencias):

   ```bash
   cd .data/projects/<projectId>
   npm install
   npm run generate:types   # re-sincroniza payload-types.ts con las colecciones generadas
   npm run seed             # carga los fixtures en la SQLite del proyecto
   npm run dev              # http://localhost:4000  (sitio, /admin de Payload, /edit con Puck)
   ```

4. **Studio y CMS** (`…/studio`, `…/studio/<página>`, `…/cms`) — índice de páginas con estado por composición y «Sincronizar páginas desde sitemap»; editor Puck con los tokens del proyecto inyectados en el canvas, preview responsive (375/768/1280), autosave de borrador con issues Zod, diff estructural draft↔aprobada y panel de aprobación §13 (aprobar sella versión inmutable y el canvas pasa a read-only); vista read-only del modelo de contenido con el mapa de bindings. El Data JSON renderiza idéntico en plataforma y template — el contrato lo verifica `scripts/e2e-studio.ts`.
5. **Review por token** (`…/review` y la superficie pública `/review/<token>`) — el equipo abre rondas sobre un release sellado; el link con token es la credencial completa del cliente (sin cuenta, R8). La página pública embebe el deployment real del slot preview por iframe con las secciones como anclas (despliega primero el release v1 para ver el sitio embebido), hilos de comentarios anclados a página/sección, comentario abierto → tarea derivada en el Cockpit, y la aprobación del cliente como tipo aparte (`client_approvals`) que jamás transiciona artefactos internos.
6. **Deploy** (`…/deploy`) — checklist de release §7.8 en vivo (5 validaciones automáticas), sellado de release con confirmación humana con rol, y deploy por slots: `production` en `http://localhost:4100` y `preview` en `http://localhost:4200` (envs `DEPLOY_PROD_PORT` / `DEPLOY_PREVIEW_PORT`; builds en `.data/deploys/`). Build inmutable por release, estado contra la realidad (pid vivo + probe HTTP), `PORT_IN_USE` claro si el puerto lo ocupa un proceso ajeno, rollback = desplegar el release anterior. Nota: con la propuesta del agent run pendiente, el checklist VIVO marca «nosotros» sin aprobar — es lo esperado; el release v1 congeló su checklist en verde al sellarse.
7. **Asistente y agent runs** (panel lateral en Cockpit/Spec/Studio, `…/runs`) — el asistente contextual invoca las 5 skills (`generate-spec-draft`, `generate-cms-schema`, `write-page-copy`, `compose-page-draft`, `revise-artifact`) sobre el Project Context API (solo versiones aprobadas + el draft del propio target). Decide el run pendiente sobre «Nosotros» desde `/runs/<runId>`: contrato lee→escribe con las versiones exactas leídas (§9.6), validaciones, diff y Aprobar/Rechazar/Abrir en editor. Para usar un proveedor real: *Ajustes → Claves LLM (BYOK)* como admin, añade tu key de Anthropic (`sk-ant-…`, modelo por defecto `claude-sonnet-4-6`) o de OpenAI (`OPENAI_MODEL_ID`, por defecto `gpt-4o`); la plataforma la valida contra el proveedor antes de cifrarla (AES-256-GCM) y solo expone id/etiqueta/últimos 4.

## Comandos

> Todos los scripts `tsx` que tocan la DB exigen el dev server parado (PGlite es de un solo proceso). Los e2e asumen la demo sembrada.

| Comando                                   | Qué hace                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Dev server (http://localhost:3000)                                                                                                                                     |
| `npm run build`                           | Build de producción                                                                                                                                                    |
| `npm run lint`                            | ESLint                                                                                                                                                                 |
| `npm run db:migrate`                      | Aplica las migraciones SQL de `src/db/migrations`                                                                                                                      |
| `npm run db:seed`                         | Datos demo (idempotente; imprime los links de review y del run al final)                                                                                               |
| `npx tsx scripts/e2e-generator.ts`        | Genera el proyecto demo + drill de conflictos §18.2. **OJO: re-crea el repo demo y destruye los tags `release-N`; re-sembrar después**                                  |
| `npx tsx scripts/e2e-studio.ts`           | Drill del paso 4: composición → diff → aprobación → regeneración → el sitio generado sirve el cambio (verifica el contrato Studio↔template). **Misma advertencia: re-crea el repo demo.** Deja flags `outdated` legítimos (§8.4) |
| `npx tsx scripts/e2e-deploy-review.ts`    | Drill del paso 5: decide propuestas pendientes (consume el momento demo del run) → checklist → release → deploy(preview) → review por token → comentario→tarea→resolver → aprobación de cliente → rollback → stop. Mata todo lo que arranca; cada ejecución sella un release más |
| `npx tsx scripts/e2e-agents.ts`           | Drill del paso 6: las 5 skills por el runner real con mock → proposed → diff → decisión humana con provenance, reject con feedback, AUTH_FAILED sin fugas de plaintext. **Restaura la demo al final (re-runnable)**                |
| `npx tsx scripts/smoke-agents-runtime.ts` | Smoke del runtime de agentes: crypto BYOK, keys, runner, retries (aislado, se limpia solo)                                                                              |
| `npx tsx scripts/smoke-skills.ts`         | Smoke de las 5 skills + provenance `agent_run` + el assert estático de imports prohibidos (aislado, se limpia solo)                                                     |
| `npx tsx scripts/smoke-review.ts`         | Smoke del módulo review/release (aislado, se limpia solo)                                                                                                              |
| `npx tsx scripts/smoke-deploy.ts`         | Smoke del DeployProvider local (requiere el repo demo generado con `node_modules`; deja los slots 4100/4200 libres)                                                     |
| `npx tsx scripts/smoke-artifacts.ts`      | Smoke del dominio de artefactos (se limpia solo)                                                                                                                       |
| `npx tsx scripts/smoke-generator.ts`      | Smoke del módulo generator (aislado, se limpia solo)                                                                                                                   |
| `npx tsx scripts/smoke-pglite-lock.ts`    | Smoke del lock de proceso único de PGlite (dataDir temporal: seguro con el dev server vivo)                                                                            |
| `npx tsx src/modules/studio/registry/smoke-render.mts` | Smoke de render del registry del Studio (RSC)                                                                                                             |

## Mapa de módulos

```
src/db/                      schema Drizzle, factory getDb(), migraciones
src/modules/platform-core/   auth (adapter+provider local), workspaces, proyectos, roles, audit log
src/modules/artifacts/       tipos Zod, máquina de estados, versiones inmutables, diff, dependencias
src/modules/spec-os/         formularios tipados de las 6 secciones de spec
src/modules/generator/       generación/regeneración parcial determinista, ownership manifest, git local
src/modules/studio/          Visual Studio: registry Puck (espejo del template) + editor con ciclo §13
src/modules/review/          releases inmutables, rondas por token, comentarios, client_approvals
src/modules/deploy/          interfaz DeployProvider + provider local (builds inmutables, slots)
src/modules/agents/          5 skills, runner, proveedores anthropic|openai|mock, BYOK, Project Context API
src/ui/                      design system (tokens §11.4 + componentes)
src/app/                     rutas App Router (las pantallas componen módulos; la lógica vive en módulos)
templates/project-base/      template del proyecto generado (Next+Payload+Puck; contrato en su TEMPLATE.md)
scripts/                     migrate, seed, e2e-*, smoke-*
```

Regla de dependencia: `app → modules → db`; los módulos no se importan entre sí salvo las excepciones documentadas. El mapa completo — con los límites exactos entre módulos, los contratos duplicados-sincronizados y las reglas que imponen los smokes — vive en [`CLAUDE.md`](CLAUDE.md), pensado como punto de entrada tanto para humanos como para coding agents.

## Postgres real

Por defecto no hay nada que configurar (PGlite embebido). Para usar un Postgres de verdad, define `DATABASE_URL` (por ejemplo en `.env.local`, ver `.env.example`):

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/agency_workstation
```

Con la variable definida, `npm run db:migrate`, `npm run db:seed` y la app usan el driver `pg` contra esa base de datos. Ningún módulo importa el driver directamente: todo pasa por la factory `getDb()` de `src/db/client.ts`.

## Limitaciones honestas

El MVP resuelve todo en local a propósito; los proveedores externos llegarán **detrás de adapters/interfaces que ya existen** (§18.6):

- **Clerk** como proveedor de auth — detrás del mismo adapter que el provider local (`src/modules/platform-core/auth/adapter.ts`).
- **Vercel** como DeployProvider real — detrás de la misma interfaz `src/modules/deploy/provider.ts` (el contrato de builds inmutables y status-contra-realidad ya está definido y ejercitado por el provider local).
- **GitHub** (vía App) como hosting de los repos generados — hoy son repos git locales en `.data/projects/`, con la misma disciplina de commits descriptivos que prevé la spec.

Además:

- **Cierre de gates de fase**: el stepper marca «cerrable» pero no existe aún la acción de cierre con lock masivo + avance de `currentPhase`.
- **Sin historia de upgrade de template** (§18.2): la regeneración solo reescribe archivos owned-by-codegen; los archivos estáticos copiados del template son territorio humano tras la copia inicial y no se re-copian. Un cambio de template llega a repos existentes re-creándolos o con un commit humano dentro del repo generado.
- **Migraciones destructivas spec↔CMS** (§10.3) pendientes: hoy la regeneración detecta y reporta los conflictos de bindings como dato; no existe aún la migración con confirmación humana + preview de impacto sobre contenido existente.

## Licencia

MIT.
