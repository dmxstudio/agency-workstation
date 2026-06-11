@AGENTS.md

# Agency Workstation — Platform Monolith (MVP)

"Agency Workstation" es el codename. Spec completa del producto: `docs/product-spec-v1.2.md` (la fuente de verdad de alcance y reglas; las referencias §N en este archivo apuntan ahí).

## Comandos

- `npm run dev` — dev server (http://localhost:3000)
- `npm run build` — build de producción
- `npm run db:migrate` — aplica el schema a la DB (PGlite local por defecto)
- `npm run db:seed` — datos demo (workspace + proyecto con TODAS las composiciones del sitemap aprobadas, release v1 SELLADO y una ronda de review abierta cuyo link imprime al final; nunca despliega). PGlite es de un solo proceso: parar el dev server antes de cualquier script `tsx` que toque la DB.
- `npx tsx scripts/e2e-generator.ts` — genera el proyecto demo + drill de conflictos §18.2 (OJO: re-crea el repo demo y destruye los tags `release-N`; re-sembrar después)
- `npx tsx scripts/e2e-studio.ts` — drill del paso 4: edición de composición → diff → aprobación → regeneración → el sitio generado sirve el cambio (incluye el contrato de compatibilidad Studio↔template; misma advertencia: re-crea el repo demo)
- `npx tsx scripts/e2e-deploy-review.ts` — drill del paso 5: checklist §7.8 → release sellado → deploy(preview) → páginas servidas con anclas → ronda por token → comentario→tarea→resolver → aprobación de cliente → cerrar → rollback → stop (mata todo lo que arranca)

## Stack y decisiones locales

- Next.js 16 (App Router) + TypeScript estricto + Tailwind v4. **Leer `AGENTS.md` y `node_modules/next/dist/docs/` antes de escribir código Next — hay breaking changes vs. conocimiento previo.**
- DB: Drizzle ORM detrás de una factory en `src/db/client.ts`. Driver por defecto: **PGlite** (Postgres embebido, datos en `./.data/pglite/`); si `DATABASE_URL` está definida se usa `pg` (Postgres real). Ningún módulo importa el driver directamente — siempre `getDb()`.
- Auth: **local dev provider** (email+password con scrypt de `node:crypto`, sesiones httpOnly en DB) detrás del adapter `src/modules/platform-core/auth/adapter.ts`. Clerk llegará después detrás del MISMO adapter (§18.6). Ningún módulo de producto importa el proveedor concreto.
- Package manager: npm. No añadir dependencias sin necesidad real; las ya instaladas cubren el MVP actual.

## Mapa de módulos (límites explícitos, §19.5)

```
src/db/                      schema Drizzle, client factory, migraciones
src/modules/platform-core/   auth (adapter+provider), workspaces, proyectos, roles, audit log
src/modules/artifacts/       tipos Zod de artefactos, máquina de estados, versiones, diff
                             estructural, dependencias/outdated, aprobaciones, tareas derivadas
src/modules/spec-os/         formularios tipados de las 6 secciones de spec
src/modules/generator/       generación/regeneración parcial (§7.3, §18.2): renderers
                             deterministas desde versiones SELLADAS, manifest de ownership,
                             conflictos como dato, git local por proyecto
src/modules/studio/          Visual Studio (§7.4): registry/ (espejo del registry del template,
                             34 componentes Puck + custom field de bindings + CSS del canvas;
                             fuente de verdad del shape = el template, ver su README.md) y
                             editor/ (island <Puck>, panel de aprobación §13, diff, autosave).
                             Las pantallas Studio (índice de páginas) y CMS (read-only +
                             mapa de bindings) viven en src/app y componen artifacts+studio
src/modules/review/          review & release (§7.7, §7.8, §8.5, §12.2): checklist de release,
                             releases = versiones INMUTABLES del artefacto `release` selladas vía
                             artifacts (+ git tag `release-N` en el repo generado), rondas de
                             review de cliente por LINK CON TOKEN (sin cuenta, R8), comentarios
                             con hilos anclados a página/sección, aprobaciones de CLIENTE (tabla
                             propia `client_approvals`; jamás transicionan artefactos internos)
                             y tareas derivadas de comentarios abiertos
src/modules/deploy/         Deploy & Release local (§7.8): interfaz DeployProvider
                             (provider.ts — Vercel llegará detrás de la MISMA interfaz,
                             patrón adapter §18.6), provider local (builds inmutables por
                             release vía `git archive` del tag en .data/deploys/, slots
                             production :4100 / preview :4200 con `next start` detached +
                             pidfile, status contra la REALIDAD), service.ts (filas
                             `deployments` + audit alrededor del provider; solo releases
                             SELLADOS se despliegan) y actions.ts (sesión + rol)
src/modules/agents/          futuro — NO implementar sin volver a la spec
src/ui/                      design system de la plataforma (tokens §11.4 + componentes)
src/app/                     rutas App Router (pantallas componen módulos; lógica vive en módulos)
templates/project-base/      template del proyecto generado (Next+Payload+Puck, autocontenido,
                             node_modules y tsconfig propios; contrato en su TEMPLATE.md)
scripts/                     migrate.ts, seed.ts, e2e-generator.ts, e2e-studio.ts, smoke-*.ts
```

Regla de dependencia entre módulos: `app → modules → db`. Los módulos no se importan entre sí salvo `* → platform-core` (auth/roles), `spec-os → artifacts`, `generator → artifacts`, `studio → artifacts` (consumen los tipos Zod, los bindings compartidos y las versiones aprobadas) y `review → artifacts + generator` (sella releases vía el ciclo de artifacts y valida/tagea el repo generado: requirements, manifest, git tag). `studio ↛ generator`: lo que ambos derivan de la misma spec (tokens CSS, defaults de navegación) se duplica sincronizado y documentado — el contrato lo verifica `scripts/e2e-studio.ts`. `deploy ↛ artifacts/generator/review`: el deploy recibe coordenadas planas (`releaseNumber`, `gitTag`), valida el payload sellado con un schema Zod mínimo propio y duplica sincronizada la resolución de paths del generator (documentado en `deploy/paths.ts`).

## Deploy local (§7.8) — decisiones

- **DeployProvider** es la interfaz; el provider local es un detalle. Reglas del contrato: build inmutable por release (un build sellado jamás se reconstruye; tag movido sobre build sellado = error), `status()` reporta realidad (pid vivo + identidad por cwd + probe HTTP), rollback = `deploy(releaseAnterior, slot)`, el provider NUNCA toca la DB de la plataforma ni mata procesos ajenos (`PORT_IN_USE` claro).
- Slots locales: **production `http://localhost:4100`** y **preview `http://localhost:4200`** (envs `DEPLOY_PROD_PORT` / `DEPLOY_PREVIEW_PORT`; base de builds `LOCAL_DEPLOYS_DIR`, por defecto `.data/deploys/`).
- Gobernanza §13/§19: solo se despliegan releases **sellados** (versión inmutable del artefacto `release`, creada por `createRelease` tras checklist §7.8 en verde + confirmación humana con rol). La aprobación de CLIENTE (§8.5) es un tipo distinto (`client_approvals`) y jamás transiciona artefactos internos; el cliente entra por link con token (`/review/<token>`, fuera del matcher de auth a propósito).
- La regeneración NO re-copia archivos estáticos del template (territorio humano tras la copia inicial, §18.2): un cambio de template llega a repos existentes re-creándolos o con commit humano dentro del repo generado — no hay historia de «upgrade de template» todavía.

## Generator: convenciones de ownership (§18.2)

- Los proyectos generados viven en `.data/projects/<projectId>/`, un repo git por proyecto (override: `GENERATED_PROJECTS_DIR`). La plataforma escribe SOLO vía commits descriptivos (`generate:` / `regenerate:`) y nunca ejecuta `npm install` dentro (eso es paso del usuario).
- Ownership **por archivo completo** en `ownership.manifest.json`: `codegen` (con sha256; la regeneración lo reescribe solo si está prístino) o `human` (scaffold único; jamás se reescribe). Lo que no está en el manifest es territorio del proyecto. Excepción única: el campo `name` de `package.json` se escribe una vez en la generación inicial (JSON-merge fuera del manifest).
- Zonas codegen (`site.config.ts`, `src/generated/`, `src/collections/`, `src/seed/`): se purgan del template en el generate inicial — no añadir archivos no-codegen ahí (contrato en `render.ts` y `TEMPLATE.md`).
- Render 100% determinista (sin timestamps ni aleatoriedad, ordenación estable): la idempotencia se verifica por hash. Conflictos = dato (`GenerationSummary.conflicts`), nunca auto-resolución.
- Verificación: `npx tsx scripts/smoke-generator.ts` (aislado, se limpia solo) y `npx tsx scripts/e2e-generator.ts` (genera el proyecto demo + drill de conflictos; re-runnable).

## Restricciones no negociables (§19)

1. Ninguna ruta de código permite a un agent run transicionar un artefacto a `approved`. Solo humanos con rol.
2. Versiones de artefacto **inmutables**; soft-delete universal; audit log en toda mutación.
3. La propagación de `outdated` **marca, nunca regenera** (§8.4).
4. Auth siempre vía adapter; cero imports del proveedor en módulos de producto.
5. UI solo con tokens del design system (§11.4): monocromo + acentos semánticos; violeta/cyan reservado EXCLUSIVAMENTE a actividad de agentes; mono obligatoria para IDs, versiones, diffs y logs. Sin gradientes decorativos, sin glassmorphism, sin sombras pesadas.
6. Cero código AGPL (Webstudio prohibido). **`@puckeditor/core` está permitido en la plataforma SOLO dentro de `src/modules/studio`** (canvas del Visual Studio, misma versión pineada que el template — la compatibilidad de render del Data JSON es sagrada). Payload sigue viviendo SOLO en los proyectos generados (`templates/project-base/`); la plataforma no lo importa y los proyectos generados no dependen de ningún paquete de la plataforma en runtime.

## Convenciones

- IDs: prefijados + aleatorios, p.ej. `usr_x7k2…`, `ws_…`, `prj_…`, `art_…`, `ver_…`, `run_…`, `gen_…` (util en `src/db/ids.ts`).
- Estados de artefacto: `empty | draft | in_review | approved | locked` + flags transversales `outdated`/`rejected` (§8.2). `approved` y `outdated` pueden coexistir.
- Tipos multi-instancia (`page.composition`): una fila por página del sitemap APROBADO, identificada por `artifacts.key` = path de la página (`inicio`, `servicios`, `legal/terms`; único por `(project_id, type, key)` vivos) y `label` humano («Composición: Servicios»). Las instancias se derivan SOLO con `syncCompositionArtifacts` (crea las que faltan, marca huérfanas — nunca borra); su payload es el Data JSON de Puck del template (schema v2).
- Payloads de artefacto: JSONB validado con Zod **en cada escritura** (schemas en `src/modules/artifacts/types/`).
- Server Actions para mutaciones (en `src/modules/*/actions.ts`, con `"use server"`); las pantallas no llaman a la DB directamente.
- Idioma de la UI: español. Código, identificadores y commits: inglés.
