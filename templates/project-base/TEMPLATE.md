# Template base del proyecto generado

Este directorio es el **template** desde el que el generador de la plataforma
(Agency Workstation, §7.3) instancia cada proyecto de cliente. Es una app
Next.js 16 autocontenida: Tailwind v4 + Payload 3.x embebido (SQLite,
`file:./.data/site.db`) + editor visual Puck (`@puckeditor/core`). No depende
de ningún paquete propietario de la plataforma en runtime (§19): todo lo que
necesita vive copiado aquí dentro.

Con sus valores de ejemplo el template ya es un sitio funcional: instala,
siembra y arranca (ver "Comandos").

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | dev server en `http://localhost:4000` |
| `npm run build` | build de producción (Turbopack) |
| `npm run start` | sirve el build en el puerto 4000 |
| `npm run seed` | carga `src/seed/content.json` en la DB SQLite (`.data/site.db`) y asegura el usuario admin |
| `npm run generate:types` | regenera `src/payload-types.ts` desde el config de Payload |
| `npm run generate:importmap` | regenera `src/app/(payload)/admin/importMap.js` (solo necesario con componentes custom del admin) |

Superficies:

- `/` — render publicado de la página home (`site.config.ts → homePath`).
- `/<path>` — render publicado de cualquier página (`pages.publishedData`; si
  la página nunca se publicó muestra el borrador con un aviso).
- `/edit` — índice de páginas + crear página (protegido por `EDIT_TOKEN`).
- `/edit/<path>` — editor Puck (autosave de borrador, Publicar en el header).
- `/admin` — admin UI de Payload (login con el usuario del seed).
- `/api/external/<collection>` — feed de documentos para el campo `external`
  de Puck (cualquier colección generada; `users` y `pages` están excluidas).
- `/api/...` — REST y GraphQL estándar de Payload.

Variables de entorno (ver `.env.example`): `EDIT_TOKEN` (sin definir = editor
abierto, solo dev local), `PAYLOAD_SECRET`, `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD` (por defecto `admin@example.com` / `change-me-1234`).

## Contrato de ownership (§18.2)

La regeneración parcial funciona con **ownership por archivo completo**
(decisión validada en el spike §18.2: nada de zonas intra-archivo). Tres
clases de archivo:

### 1. OWNED-BY-CODEGEN — el generador los reescribe; NUNCA editarlos a mano

Una edición manual aquí se detecta como conflicto (`human-edit-in-codegen-zone`)
en la siguiente regeneración y bloquea solo ese archivo. Todos llevan header
`@generated`/`@generated-example`.

| Archivo | Se genera desde | Notas |
| --- | --- | --- |
| `site.config.ts` | `spec.intake` / `spec.strategy` | nombre, slug, descripción, homePath, locale |
| `src/generated/tokens.css` | `design.tokens` | variables CSS de marca; el registry las consume vía utilities `*-brand-*` mapeadas en `src/app/(site)/globals.css` |
| `src/generated/navigation.ts` | `spec.sitemap` | `mainNav`, `footerColumns`, `legalText`; defaultProps de Navbar/Footer para inserciones nuevas |
| `src/collections/*.ts` (incl. `index.ts`) | `cms.collections` | un archivo por colección + barrel; `testimonials.ts`/`posts.ts` son el ejemplo de la forma emitida. Tras regenerar colecciones, correr `npm run generate:types` (los literales `relationTo` tipan contra la unión de `payload-types.ts`) |
| `src/seed/content.json` | `spec.sitemap` + `cms.collections` + `content.page` | fixtures en la forma `SeedContent` de `scripts/seed.mts`: `collections` (3 documentos de ejemplo por colección; los campos `relation` se omiten — enlazar documentos es tarea humana en el CMS) y `pages` (una página Puck publicada por entrada del sitemap, compuesta desde el copy aprobado). Se cargan con `npm run seed`. Sintaxis de binding: `{ "$seedRef": { "collection": "posts", "index": 0 } }` → `{ collection, docId, ...snapshot }` |
| `src/payload-types.ts` | config de Payload | lo regenera `npm run generate:types`, no la plataforma; tratarlo igualmente como archivo cerrado |
| `package.json` → campo `name` | nombre del proyecto (slug) | escrito UNA sola vez en la generación inicial (JSON-merge, sin entrada en el manifest); después el archivo entero es territorio del proyecto: la regeneración nunca lo lee ni lo reescribe |

### 2. OWNED-BY-HUMAN — el generador JAMÁS los toca

- **Las composiciones de página** (`pages.puckData` / `pages.publishedData` en
  la DB): tras el scaffold inicial del seed, la composición viva pertenece al
  equipo (vía `/edit` o vía Studio de la plataforma). La regeneración nunca
  las sobrescribe; los bindings rotos por cambios de schema se reportan como
  conflicto (§8.4: marcar, nunca regenerar).
- **El contenido del CMS** (documentos de las colecciones, usuarios).
- **Cualquier archivo nuevo** que el equipo añada al proyecto (rutas extra,
  componentes propios fuera de `src/puck/`, hooks de Payload, etc.). El
  manifest de ownership del generador los registra sin hash y no los compara.

### 3. ESTÁTICOS DEL TEMPLATE — vienen del template; solo cambian con upgrades de template

Todo lo demás. En particular:

- `src/puck/**` — registry de 34 secciones gobernadas (sin CSS libre; toda
  opción visual es variante enumerada). La extensión del registry es tarea de
  developer (o, post-MVP, de la skill `extend-component-variant`).
- `src/lib/**` — Payload Local API, resolución de bindings en render,
  acciones del editor, gate de `EDIT_TOKEN`, colecciones base (`users`,
  `pages`).
- `src/app/**` — rutas: render publicado, editor, admin de Payload, APIs.
- `src/components/**`, `payload.config.ts`, `next.config.ts`,
  `tsconfig.json`, `postcss.config.mjs`, `scripts/seed.mts`, `.gitignore`,
  `package.json` (el campo `name` se rellena una vez en la generación
  inicial; ver tabla de arriba).

Si un proyecto necesita divergir de un archivo estático, esa edición convierte
el archivo en owned-by-human de facto: los upgrades de template para ese
proyecto deberán resolverse como conflicto, no como sobrescritura.

## Decisiones de diseño relevantes

- **SQLite por proyecto** (`@payloadcms/db-sqlite`, `file:./.data/site.db`):
  cero servidores en local; la spec prevé Postgres por proyecto en producción
  detrás del mismo adapter de Payload.
- **Render publicado re-resuelve bindings CMS por request**
  (`src/lib/bindings.ts`): editar un documento en el CMS actualiza la página
  publicada sin tocar la composición. Un documento borrado deja el snapshot
  marcado con `_broken: true`.
- **La aprobación no vive aquí.** El template no tiene estados de aprobación
  ni panel de revisión: ese gobierno pertenece al Artifact Model de la
  plataforma (las composiciones serán artefactos `page.composition`). El
  editor standalone es deliberadamente manual-first (§5).
- **`turbopack.root` fijado** en `next.config.ts`: los proyectos generados
  pueden vivir bajo el árbol de otro repo (p.ej. `.data/projects/<id>/`) sin
  que Turbopack adopte el lockfile padre.
- **Seed reproducible:** `npm run seed` borra y recarga `pages` + colecciones
  de los fixtures; preserva usuarios.
