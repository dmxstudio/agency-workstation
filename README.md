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

El seed crea el proyecto **"Sitio Corporativo Acme"** con el grafo de 8 artefactos instanciado y un estado realista: `spec.intake` aprobado en **v2** (dos versiones inmutables), `spec.strategy` aprobado **y marcado `outdated`** por la propagación de la v2 del intake (con su tarea derivada de re-validación), `spec.sitemap` en borrador, una tarea manual abierta y el feed de actividad poblado.

Para regenerar la demo desde cero: borra `./.data` y repite `db:migrate` + `db:seed`.

## Estado actual del MVP

Hecho:

- **Platform core** — auth local (email+password, sesiones httpOnly en DB) detrás del adapter `src/modules/platform-core/auth/adapter.ts`, workspaces con roles (`admin`/`member`/`client`), proyectos, audit log.
- **Modelo de artefactos** (`src/modules/artifacts`) — 8 tipos con payload Zod validado en cada escritura, máquina de estados (`empty|draft|in_review|approved|locked` + flags `outdated`/`rejected`), versiones inmutables, aprobaciones humanas (ningún code path permite que un agente apruebe), diff estructural, grafo fijo de dependencias con propagación de `outdated` y tareas derivadas.
- **Spec OS** (`src/modules/spec-os`) — formularios tipados de las 6 secciones de spec.
- **Pantallas** — login/registro/onboarding, home de workspace con tabla de proyectos, **Project Cockpit** (stepper de fases con gates, artefactos por fase, tareas, feed de actividad) y **editor de artefactos** con tabs Editar/Diff/Historial y barra de acciones por estado y rol.
- **Design system** (`src/ui`) — tokens §11.4: monocromo + acentos semánticos, violeta reservado a actividad de agentes, mono para IDs/versiones/diffs.

Pendiente (fases posteriores de la spec):

- **Generator, Studio, Review, Deploy** — placeholders "Próximamente" en la navegación (Puck/Payload llegarán aquí).
- **Agent Runtime** (`agent_runs` es solo un placeholder en el schema; no hay flujo propose→diff→approve de agentes).
- **Cierre de gates de fase** (el stepper marca "cerrable" pero no existe la acción de cierre con lock masivo + avance de `currentPhase`).
- **Clerk** como proveedor de auth (llegará detrás del mismo adapter, §18.6).

## Postgres real

Por defecto no hay nada que configurar (PGlite embebido). Para usar un Postgres de verdad, define `DATABASE_URL` (por ejemplo en `.env.local`, ver `.env.example`):

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/agency_workstation
```

Con la variable definida, `npm run db:migrate`, `npm run db:seed` y la app usan el driver `pg` contra esa base de datos. Ningún módulo importa el driver directamente: todo pasa por la factory `getDb()` de `src/db/client.ts`.

## Comandos

| Comando              | Qué hace                                          |
| -------------------- | ------------------------------------------------- |
| `npm run dev`        | Dev server (http://localhost:3000)                |
| `npm run build`      | Build de producción                               |
| `npm run db:migrate` | Aplica las migraciones SQL de `src/db/migrations` |
| `npm run db:seed`    | Datos demo (idempotente)                          |
| `npm run lint`       | ESLint                                            |
