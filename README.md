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

El seed crea el proyecto **"Sitio Corporativo Acme"** con el grafo de 8 artefactos instanciado y una historia realista producida por los servicios de dominio reales: `spec.intake` aprobado en **v2** (re-scope que añade la página de carreras), `spec.strategy` marcado `outdated` por esa propagación (§8.4) y **re-validado como v2**, `spec.sitemap` aprobado (6 páginas, con un borrador previo al re-scope en su historial), `design.tokens`, `cms.collections` (3 colecciones) y `content.page` (copy/SEO de 3 páginas) aprobados, una tarea manual abierta y el feed de actividad/audit completo. Las composiciones (`page.composition`, **un artefacto por página** del sitemap aprobado) quedan TODAS aprobadas (las páginas sin composición autorada reciben el scaffold del Generator sellado vía el ciclo §13).

Además el seed deja el **paso 5 listo para vivirlo**: genera/regenera el repo del proyecto, valida el checklist de release §7.8 en verde, **sella el release v1** (versión inmutable del artefacto `release` + tag git `release-1`) y abre una **ronda de review de cliente** («Cliente Acme — ronda 1») con dos comentarios demo — uno abierto (su tarea derivada §12.2 aparece en el Cockpit) y uno resuelto — y **sin aprobación de cliente** (ese momento queda para ti en `/review/<token>`; el seed imprime el link al final). El seed **nunca despliega** (los builds tardan minutos): hazlo desde la pantalla Deploy o con `npx tsx scripts/e2e-deploy-review.ts`.

Los **tres artefactos que requiere el Generator** (`spec.sitemap`, `cms.collections`, `design.tokens`) quedan aprobados: el proyecto demo es generable nada más sembrar (ver la sección Generator).

> PGlite es de **un solo proceso**: para ejecutar el seed o cualquier script `tsx` que toque la DB, para antes el dev server (`npm run dev`) y relánzalo después.

Para regenerar la demo desde cero: borra `./.data` y repite `db:migrate` + `db:seed`.

## Estado actual del MVP

Hecho:

- **Platform core** — auth local (email+password, sesiones httpOnly en DB) detrás del adapter `src/modules/platform-core/auth/adapter.ts`, workspaces con roles (`admin`/`member`/`client`), proyectos, audit log.
- **Modelo de artefactos** (`src/modules/artifacts`) — 8 tipos con payload Zod validado en cada escritura, máquina de estados (`empty|draft|in_review|approved|locked` + flags `outdated`/`rejected`), versiones inmutables, aprobaciones humanas (ningún code path permite que un agente apruebe), diff estructural, grafo fijo de dependencias con propagación de `outdated` y tareas derivadas.
- **Spec OS** (`src/modules/spec-os`) — formularios tipados de las 6 secciones de spec.
- **Pantallas** — login/registro/onboarding, home de workspace con tabla de proyectos, **Project Cockpit** (stepper de fases con gates, artefactos por fase, tareas, feed de actividad) y **editor de artefactos** con tabs Editar/Diff/Historial y barra de acciones por estado y rol.
- **Design system** (`src/ui`) — tokens §11.4: monocromo + acentos semánticos, violeta reservado a actividad de agentes, mono para IDs/versiones/diffs.
- **Generator** (`src/modules/generator` + pantalla `/w/<slug>/p/<id>/generator`) — generación y regeneración parcial de proyectos reales desde los artefactos aprobados (ver sección Generator).
- **Visual Studio + CMS** (`src/modules/studio` + pantallas `/studio`, `/studio/<página>` y `/cms`) — editor Puck embebido con el ciclo de aprobación §13 y vistas del modelo de contenido (ver sección Studio y CMS).
- **Review + Deploy & Release** (`src/modules/review`, `src/modules/deploy` + pantallas `/review`, `/deploy` y la superficie pública `/review/<token>`) — checklist de release §7.8, releases inmutables, deploy local por slots con rollback y review de cliente por link con token (ver sección Review y Deploy).

Pendiente (fases posteriores de la spec):

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

## Studio y CMS (§7.4, §7.6, §11.2)

El **Visual Studio** compone las páginas del sitemap aprobado con el registry gobernado de 34 componentes (sin CSS libre: toda opción visual es una variante enumerada). Cada página es un artefacto `page.composition` propio (key = path de la página) con el MISMO ciclo §13 que el resto de la spec: el Studio jamás crea un camino paralelo de aprobación.

- **`/w/<slug>/p/<id>/studio`** — índice de páginas: estado por composición (StatusPill + flags), versión sellada, nº de secciones, peso del Data JSON, y el botón «Sincronizar páginas desde sitemap» (deriva un artefacto por página del sitemap APROBADO; marca huérfanas, nunca borra — §8.4).
- **`/w/<slug>/p/<id>/studio/<página>`** — editor Puck (`@puckeditor/core`, misma versión pineada que el template): canvas con los tokens del proyecto inyectados en el iframe, preview responsive (375/768/1280), autosave de borrador con issues de validación Zod, diff estructural draft↔aprobada (las secciones se alinean por su `props.id` estable), bindings CMS validados contra `cms.collections` aprobado, y el panel «Aprobación» (enviar a revisión / aprobar / rechazar / revalidar — solo humanos con rol; aprobar sella versión inmutable y el canvas pasa a read-only).
- **`/w/<slug>/p/<id>/cms`** — vista read-only del modelo de contenido aprobado + mapa de bindings (qué página/sección/prop consume qué colección/campo, con conflictos marcados) + cómo correr el CMS real del proyecto generado.

**Compatibilidad de render (contrato sagrado):** el Data JSON que produce el Studio renderiza idéntico en el renderer del template — mismos nombres de componente, mismas props, mismo formato de bindings. La fuente de verdad del shape es `templates/project-base/src/puck/`; el espejo de plataforma vive en `src/modules/studio/registry` (reglas de sincronización en su `README.md`) y el contrato lo verifica `scripts/e2e-studio.ts` en cada ejecución.

**Demo end-to-end del paso 4:** con la demo sembrada, `npx tsx scripts/e2e-studio.ts` añade una sección a la composición de «Servicios» tal y como la crearía el canvas (defaultProps del registry), muestra el diff, la aprueba (v2), regenera el proyecto, hace `seed + build + next start` DENTRO del proyecto generado y verifica con curl que `/servicios` sirve la sección nueva y `/` la composición aprobada de «inicio». Nota: cada ejecución de los e2e deja flags `outdated` legítimos (propagación §8.4 de las versiones que aprueban); para una demo impoluta, revalida desde el Cockpit o re-siembra desde cero.

## Review de cliente y Deploy & Release (§7.7, §7.8, §8.5)

El paso 5 cierra el ciclo: **release inmutable → deploy real → review del cliente sobre el deployment → rollback**. Una sola pipeline de render (§16): el cliente revisa el MISMO build que se despliega, embebido por iframe — nunca un render paralelo.

**Releases (pantalla `/w/<slug>/p/<id>/deploy`):**

1. El **checklist de release §7.8** se evalúa en vivo (5 validaciones automáticas: inputs del generator aprobados, todas las composiciones del sitemap aprobadas, cero bindings CMS rotos, generación al día, sin re-validaciones `outdated` pendientes).
2. **Crear release** exige el checklist todo en verde + confirmación explícita de un humano con rol `admin|member` (§13: ningún deploy sin checklist confirmado). Un release es una **versión inmutable del artefacto `release`** sellada vía el ciclo normal de artifacts (origin humano, audit log) que congela las versiones selladas de cada input + el checklist evaluado, y tagea el repo generado (`release-N`).
3. **Desplegar**: cada release sellado puede activarse en cualquiera de los dos slots. El **rollback** es desplegar el release anterior — sin estado extra.

**Deploy local (interfaz `DeployProvider`):** el MVP resuelve §7.8 en local detrás de la interfaz provider-agnóstica `src/modules/deploy/provider.ts` (mismo patrón que el adapter de auth §18.6 — Vercel llegará detrás de la MISMA interfaz). El provider local construye un **build inmutable por release** (`git archive` del tag → `.data/deploys/<projectId>/builds/release-<N>/`, sellado con marker; jamás se reconstruye) y sirve los slots con `next start` detached + pidfile:

| Slot         | URL                     | Env override          |
| ------------ | ----------------------- | --------------------- |
| `production` | `http://localhost:4100` | `DEPLOY_PROD_PORT`    |
| `preview`    | `http://localhost:4200` | `DEPLOY_PREVIEW_PORT` |

El estado de los slots se comprueba contra la REALIDAD (pid vivo + identidad del proceso + probe HTTP), no contra lo persistido; un puerto ocupado por un proceso ajeno es un error claro (`PORT_IN_USE`) y la plataforma **nunca** mata procesos que no arrancó. Cada deploy/stop registra filas en `deployments` + audit log.

**Review del cliente (§7.7, §8.5):**

- En `/w/<slug>/p/<id>/review` el equipo abre **rondas de review** sobre un release sellado; cada ronda emite un **link con token** (`/review/<token>`) que es la credencial completa del cliente (sin cuenta, R8: su identidad es la etiqueta del link + el nombre que escribe).
- La página pública embebe el **deployment real** del slot preview por iframe, con las secciones de la composición sellada como anclas (`<section id="<blockId>">` — clic en la sidebar hace scroll en el sitio servido), hilos de comentarios anclados a página/sección y estados abierto/resuelto.
- **Comentario de cliente abierto → tarea derivada** (§12.2) visible en el Cockpit; resolver el comentario la cierra (las tareas derivadas nunca mienten).
- La **aprobación del cliente es un tipo distinto** (§8.5): filas en `client_approvals` ancladas a la ronda + versión de release. **Jamás** transiciona artefactos internos.

**Demo end-to-end del paso 5:** con la demo sembrada (el seed deja el release v1 sellado y la ronda abierta, sin desplegar), `npx tsx scripts/e2e-deploy-review.ts` recorre todo con los servicios reales: checklist en verde → sella el siguiente release → build inmutable + deploy al slot preview → verifica que TODAS las páginas del release se sirven con sus anclas de sección → ronda nueva → comentario de cliente por token → tarea derivada → resolver → aprobación de cliente → cerrar ronda → **rollback** al release anterior → stop del slot y puertos libres. Mata todos los procesos que arranca (re-runnable; cada ejecución sella un release más).

> Nota honesta sobre el template: la regeneración solo reescribe archivos owned-by-codegen; los archivos **estáticos copiados del template** (p.ej. `src/puck/*`) son territorio humano tras la copia inicial y NO se re-copian (§18.2). Un cambio de template llega a los repos ya generados re-creándolos (`scripts/e2e-studio.ts` lo hace con el repo demo) o portándolo con un commit humano dentro del repo generado; no existe aún una historia de producto de «upgrade de template».

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
| `npx tsx scripts/e2e-studio.ts`       | Drill del paso 4: composición→diff→aprobación→regeneración→el sitio generado sirve el cambio (re-runnable) |
| `npx tsx scripts/e2e-deploy-review.ts` | Drill del paso 5: release→deploy(preview)→review por token→rollback→stop (re-runnable; mata todo lo que arranca) |
| `npx tsx scripts/smoke-review.ts`     | Smoke del módulo review/release (aislado, se limpia solo)        |
| `npx tsx scripts/smoke-deploy.ts`     | Smoke del DeployProvider local (usa el repo demo; slots 4100/4200 quedan libres) |
| `npx tsx scripts/smoke-artifacts.ts`  | Smoke del dominio de artefactos                                  |
| `npx tsx scripts/smoke-generator.ts`  | Smoke del módulo generator (aislado, se limpia solo)             |
| `npx tsx src/modules/studio/registry/smoke-render.mts` | Smoke de render del registry del Studio (RSC)   |
