@AGENTS.md

# Agency Workstation — Platform Monolith (MVP)

"Agency Workstation" es el codename. Spec completa del producto: `docs/product-spec-v1.2.md` (la fuente de verdad de alcance y reglas; las referencias §N en este archivo apuntan ahí).

## Comandos

- `npm run dev` — dev server (http://localhost:3000)
- `npm run build` — build de producción
- `npm run db:migrate` — aplica el schema a la DB (PGlite local por defecto)
- `npm run db:seed` — datos demo (workspace + proyecto + artefactos)

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
src/modules/{generator,studio,review,deploy,agents}/  futuros — NO implementar sin volver a la spec
src/ui/                      design system de la plataforma (tokens §11.4 + componentes)
src/app/                     rutas App Router (pantallas componen módulos; lógica vive en módulos)
scripts/                     migrate.ts, seed.ts
```

Regla de dependencia entre módulos: `app → modules → db`. Los módulos no se importan entre sí salvo `* → platform-core` (auth/roles) y `spec-os → artifacts`.

## Restricciones no negociables (§19)

1. Ninguna ruta de código permite a un agent run transicionar un artefacto a `approved`. Solo humanos con rol.
2. Versiones de artefacto **inmutables**; soft-delete universal; audit log en toda mutación.
3. La propagación de `outdated` **marca, nunca regenera** (§8.4).
4. Auth siempre vía adapter; cero imports del proveedor en módulos de producto.
5. UI solo con tokens del design system (§11.4): monocromo + acentos semánticos; violeta/cyan reservado EXCLUSIVAMENTE a actividad de agentes; mono obligatoria para IDs, versiones, diffs y logs. Sin gradientes decorativos, sin glassmorphism, sin sombras pesadas.
6. Cero código AGPL (Webstudio prohibido). Puck/Payload (MIT) llegarán en fases posteriores.

## Convenciones

- IDs: prefijados + aleatorios, p.ej. `usr_x7k2…`, `ws_…`, `prj_…`, `art_…`, `ver_…`, `run_…` (util en `src/db/ids.ts`).
- Estados de artefacto: `empty | draft | in_review | approved | locked` + flags transversales `outdated`/`rejected` (§8.2). `approved` y `outdated` pueden coexistir.
- Payloads de artefacto: JSONB validado con Zod **en cada escritura** (schemas en `src/modules/artifacts/types/`).
- Server Actions para mutaciones (en `src/modules/*/actions.ts`, con `"use server"`); las pantallas no llaman a la DB directamente.
- Idioma de la UI: español. Código, identificadores y commits: inglés.
