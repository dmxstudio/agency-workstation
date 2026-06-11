# Agency Workstation (MVP)

**Agency Workstation** (codename) es el monolito de plataforma para agencias web: especificación de proyectos como **artefactos versionados e inmutables** con ciclo humano de aprobación (draft → revisión → aprobación), grafo de dependencias con propagación de `outdated` (marca, nunca regenera) y audit log en toda mutación.

La fuente de verdad de alcance y reglas es la spec del producto: [`docs/product-spec-v1.2.md`](docs/product-spec-v1.2.md). Las convenciones de desarrollo viven en [`CLAUDE.md`](CLAUDE.md).

## Requisitos

- **Node.js 20+** (no hace falta nada más: la base de datos por defecto es PGlite, un Postgres embebido que persiste en `./.data/pglite`).

## Quickstart

```bash
npm install
npm run db:migrate   # aplica el schema a la DB local (PGlite)
npm run db:seed      # datos demo (idempotente)
npm run dev          # http://localhost:3000
```

Credenciales demo (las imprime también el seed):

| Campo      | Valor                          |
| ---------- | ------------------------------ |
| Email      | `demo@agency.local`            |
| Contraseña | `demo1234`                     |
| Workspace  | Demo Agency (`/w/demo`)        |

El seed crea el proyecto **"Sitio Corporativo Acme"** con el grafo de 8 artefactos instanciado y una historia realista producida por los servicios de dominio reales: `spec.intake` aprobado en **v2** (re-scope que añade la página de carreras), `spec.strategy` marcado `outdated` por esa propagación (§8.4) y **re-validado como v2**, `spec.sitemap` aprobado (6 páginas, con un borrador previo al re-scope en su historial), `design.tokens`, `cms.collections` (3 colecciones), `content.page` (copy/SEO de 3 páginas) y `page.composition` (con un binding CMS) aprobados, `release` vacío, una tarea manual abierta y el feed de actividad/audit completo.

Los **tres artefactos que requiere el Generator** (`spec.sitemap`, `cms.collections`, `design.tokens`) quedan aprobados: el proyecto demo es generable nada más sembrar (ver la sección Generator).

Para regenerar la demo desde cero: borra `./.data` y repite `db:migrate` + `db:seed`.

## Estado actual del MVP

Hecho:

- **Platform core** — auth local (email+password, sesiones httpOnly en DB) detrás del adapter `src/modules/platform-core/auth/adapter.ts`, workspaces con roles (`admin`/`member`/`client`), proyectos, audit log.
- **Modelo de artefactos** (`src/modules/artifacts`) — 8 tipos con payload Zod validado en cada escritura, máquina de estados (`empty|draft|in_review|approved|locked` + flags `outdated`/`rejected`), versiones inmutables, aprobaciones humanas (ningún code path permite que un agente apruebe), diff estructural, grafo fijo de dependencias con propagación de `outdated` y tareas derivadas.
- **Spec OS** (`src/modules/spec-os`) — formularios tipados de las 6 secciones de spec.
- **Pantallas** — login/registro/onboarding, home de workspace con tabla de proyectos, **Project Cockpit** (stepper de fases con gates, artefactos por fase, tareas, feed de actividad) y **editor de artefactos** con tabs Editar/Diff/Historial y barra de acciones por estado y rol.
- **Design system** (`src/ui`) — tokens §11.4: monocromo + acentos semánticos, violeta reservado a actividad de agentes, mono para IDs/versiones/diffs.
- **Generator** (`src/modules/generator` + pantalla `/w/<slug>/p/<id>/generator`) — generación y regeneración parcial de proyectos reales desde los artefactos aprobados (ver sección siguiente).

Pendiente (fases posteriores de la spec):

- **Studio, Review, Deploy** — placeholders "Próximamente" en la navegación (Puck como Studio embebido en la plataforma llegará aquí; el proyecto generado ya trae su propio editor Puck standalone).
- **Agent Runtime** (`agent_runs` es solo un placeholder en el schema; no hay flujo propose→diff→approve de agentes).
- **Cierre de gates de fase** (el stepper marca "cerrable" pero no existe la acción de cierre con lock masivo + avance de `currentPhase`).
- **Clerk** como proveedor de auth (llegará detrás del mismo adapter, §18.6).

## Generator (§7.3, §18.2)

El Generator convierte los artefactos **aprobados** de un proyecto en una app Next.js real (Next 16 + Tailwind v4 + Payload 3 con SQLite embebido + editor Puck), instanciada desde el template `templates/project-base/`.

**Flujo:**

1. En la pantalla `Generator` del proyecto (`/w/<slug>/p/<id>/generator`), la checklist exige `spec.sitemap`, `cms.collections` y `design.tokens` aprobados (`content.page` y `page.composition` enriquecen el resultado si también lo están). Solo consume **versiones selladas** — nunca borradores.
2. **Generar** copia el template, renderiza el codegen desde los artefactos (config del sitio, tokens CSS, navegación, colecciones Payload, fixtures de contenido con páginas Puck compuestas, scaffolds de composición) y crea un **repo git local** con commit descriptivo y manifest de ownership (sha256 por archivo).
3. **Regenerar** (tras aprobar nuevas versiones de la spec) reescribe **solo** archivos owned-by-codegen prístinos; las ediciones humanas y las composiciones jamás se tocan. Los conflictos (edición manual en zona codegen, binding a campo/colección eliminado, huérfanos modificados…) se **reportan como dato** en la pantalla, nunca se resuelven solos. La operación es idempotente: misma spec ⇒ cero diffs.

**Dónde quedan los proyectos:** `.data/projects/<projectId>/` (un repo git por proyecto; override con la env `GENERATED_PROJECTS_DIR`). Cada generación inserta una fila en la tabla `generations` (historial de la pantalla) y un evento en el audit log.

**Cómo correr un proyecto generado** (pasos del usuario — la plataforma nunca instala dependencias):

```bash
cd .data/projects/<projectId>
npm install
npm run generate:types   # re-sincroniza payload-types.ts con las colecciones generadas
npm run seed             # carga los fixtures (src/seed/content.json) en la SQLite del proyecto
npm run dev              # http://localhost:4000  (sitio publicado, /admin de Payload, /edit con Puck)
```

**Demo end-to-end:** con la demo sembrada, `npx tsx scripts/e2e-generator.ts` genera el proyecto demo, demuestra el ciclo de conflictos §18.2 (edición humana en zona codegen + campo bindeado eliminado por una v2 de `cms.collections` → `status=conflicts` → resolución → `success`) y deja el historial limpio. El contrato completo del template (ownership por archivo, comandos, decisiones) está en [`templates/project-base/TEMPLATE.md`](templates/project-base/TEMPLATE.md).

## Postgres real

Por defecto no hay nada que configurar (PGlite embebido). Para usar un Postgres de verdad, define `DATABASE_URL` (por ejemplo en `.env.local`, ver `.env.example`):

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/agency_workstation
```

Con la variable definida, `npm run db:migrate`, `npm run db:seed` y la app usan el driver `pg` contra esa base de datos. Ningún módulo importa el driver directamente: todo pasa por la factory `getDb()` de `src/db/client.ts`.

## Comandos

| Comando                               | Qué hace                                                         |
| ------------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                         | Dev server (http://localhost:3000)                               |
| `npm run build`                       | Build de producción                                              |
| `npm run db:migrate`                  | Aplica las migraciones SQL de `src/db/migrations`                |
| `npm run db:seed`                     | Datos demo (idempotente)                                         |
| `npm run lint`                        | ESLint                                                           |
| `npx tsx scripts/e2e-generator.ts`    | Genera el proyecto demo + drill de conflictos §18.2 (re-runnable) |
| `npx tsx scripts/smoke-artifacts.ts`  | Smoke del dominio de artefactos                                  |
| `npx tsx scripts/smoke-generator.ts`  | Smoke del módulo generator (aislado, se limpia solo)             |
