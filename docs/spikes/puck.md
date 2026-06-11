# Spike §18.1 — Puck como núcleo del Visual Studio

**Fecha:** 2026-06-10 · **Código:** `spikes/puck/` (desechable, independiente del monolito)
**Versiones probadas:** `@puckeditor/core 0.21.3` · `payload 3.85.1` · `@payloadcms/db-sqlite 3.85.1` · `@payloadcms/next 3.85.1` · `next 16.2.9` (Turbopack) · `react 19.2.4` · Node 22.22.3 · sin Docker, sin brew, todo embebido.

> Nota de paquete: se usó **@puckeditor/core 0.21.x** (el paquete activo). `@measured/puck` está congelado en 0.20.2 y NO se usó. El API de **slots** sustituye al de zones/DropZone (deprecado); este spike solo usa slots.

---

## Veredicto global: **GO** (con condiciones, ver §Riesgos)

El criterio de salida de la spec se cumple sin hacks. Los siete puntos del mandato quedan demostrados con código funcional y verificación en navegador. Las fricciones encontradas son reales pero ninguna es estructural.

---

## Criterio de salida (§18.1, literal)

> "componer un sitio de 8 páginas con bindings CMS sin hacks estructurales ni edición libre de HTML/CSS"

**CUMPLE.** Evidencia: seed programático de 8 páginas (62 bloques, una con 12 secciones de nivel raíz y otra con slots anidados) + una novena página creada en vivo desde la UI. Bindings CMS reales contra dos colecciones Payload. Cero campos de CSS/HTML libre en el registry: toda opción visual es una variante enumerada (`select`/`radio`). No se usó ninguna API interna de Puck, ningún parche, ni el API deprecado de zones.

---

## Veredicto por punto del mandato

### 1. Multi-página — **CUMPLE**
- `app/edit/[...path]/page.tsx`: editor Puck por URL con catch-all; admite rutas anidadas (`/edit/legal/terms`, `/edit/spike/nueva`).
- `app/[...path]/page.tsx`: render publicado por URL (RSC).
- `app/page.tsx`: índice con las páginas (estado, nº de secciones, peso del Data JSON) + formulario de creación → Server Action → redirect al editor. **Verificado en navegador**: crear "Página Nueva del Spike" en `spike/nueva` abrió el editor de inmediato y la página renderiza en `/spike/nueva`.

### 2. Persistencia (Payload 3.x embebido) — **CUMPLE**
- Payload 3.85 + `@payloadcms/db-sqlite` con `file:./.data/puck-spike.db`. Cero servidores: el schema se auto-push-ea en dev, la Local API (`getPayload`) corre dentro del proceso Next.
- Colección `pages` con `puckData` (borrador), `publishedData` (snapshot al publicar) y `approvalStatus`. Guardar borrador, publicar y transicionar estado persisten vía Server Actions (verificado: el estado cambiado en el panel sobrevive recargas y aparece en el índice).
- `@payloadcms/next` declara soporte explícito de Next 16 (`>=16.2.6 <17`); `withPayload` no dio problemas con Turbopack.
- **Matiz honesto:** el admin UI de Payload NO se montó (decisión de timebox; el spike valida persistencia y Local API, no el panel de administración). Si el MVP quiere admin embebido, falta esa validación — la doc oficial lo da por soportado pero el scaffold del route group `(payload)` tiene piezas (importMap, custom.scss) que aquí no se ejercitaron.

### 3. Bindings dinámicos CMS — **CUMPLE**
- 4 componentes con campo `external` de Puck: `TestimonialQuote`, `TestimonialWall` (external dentro de array), `PostFeature`, `BlogPosts`, contra las colecciones `testimonials` y `posts`.
- `fetchList` → route handlers `/api/external/*` → Payload Local API, **con búsqueda** (`showSearch` + `where like`) y columnas custom (`mapRow`). Verificado en navegador: el modal lista los 6 testimonios reales, la búsqueda funciona, y al seleccionar otro doc el canvas se actualiza al instante.
- `mapProp` guarda `{ collection, docId, ...snapshot }`: referencia + copia para preview.
- El render publicado **re-resuelve cada referencia contra Payload en cada request** (`lib/bindings.ts`). Prueba ejecutada: se editó el quote de un testimonio en el CMS y la página publicada mostró el texto nuevo **sin tocar la composición ni republicar**. Binding real, no copia.
- **Matiz:** para el render server-side no se usó el `resolveAllData` de Puck — sus resolvers se comparten con el editor (browser) y dependen de `fetch` relativo, que no funciona en RSC. La resolución propia son ~40 líneas de walk; trivial, pero es patrón nuestro, no de Puck. Para refrescar datos DENTRO del editor, el mecanismo `resolveData` de Puck sí existiría (no se necesitó aquí).

### 4. Registry 25-35 componentes — **CUMPLE**
- **34 componentes** tipados con `ComponentConfig<Props>`, organizados en 6 categorías (estructura, heroes, contenido, marketing, CMS, navegación): Section, Columns, Spacer, Divider, Hero, HeroSplit, HeroMinimal, Heading, Paragraph, ButtonRow, ImageText, Steps, Timeline, Quote, VideoEmbed, Banner, Features, FeatureList, Pricing, Cta, CtaBanner, Stats, Faq, LogoCloud, Gallery, Team, Newsletter, ContactForm, TestimonialQuote, TestimonialWall, PostFeature, BlogPosts, Navbar, Footer.
- Comparten primitivas internas (`lib/puck/primitives.tsx`: tonos, paddings, anchuras, botones, grids) pero cada uno tiene su config Puck propia (fields + defaultProps).
- **Sin CSS libre:** todas las opciones visuales son variantes enumeradas. Las clases Tailwind son literales (mapas variante→clase), compatibles con el extractor estático.
- `Section` y `Columns` usan el **API de slots** (incluidos slots anidados Section→Columns→Heading/Paragraph/ButtonRow), sembrados por JSON y renderizados tanto en editor como en RSC. Sin zones.

### 5. Preview responsive — **CUMPLE**
- `viewports` configurados: Móvil 375 / Tablet 768 / Escritorio 1280. Verificado: los tres botones aparecen y al cambiar a Escritorio el iframe pasa a 1280px (con auto-zoom para encajar). Zoom in/out incluido de serie.
- Tailwind del documento padre se inyecta automáticamente en el iframe del canvas — los componentes se ven idénticos en editor y render.

### 6. Extensiones laterales (diff/aprobaciones) — **CUMPLE**
- El **Plugin API de 0.21 es de primera clase**: `{ name, label, icon, render }` añade un panel propio al rail izquierdo del editor, al lado de Blocks/Outline (que internamente son plugins también). No hubo que tocar overrides ni composición manual: el caso de uso de la plataforma encaja en el API pública.
- Panel "Aprobación" implementado (`lib/puck/approval-plugin.tsx`):
  - Estado `draft → in_review → approved` con botones de transición persistidos por Server Action (verificado: Home pasó de "en revisión" a "aprobado" y el índice lo refleja).
  - **Diff estructural en vivo** del Data JSON actual vs. `publishedData` (añadido/eliminado/cambiado/movido por id estable, incluyendo slots). Reactivo: al cambiar el binding de un testimonio apareció `~ cambiado TestimonialQuote (testimonial)` al instante; al deshacer, volvió a "Sin cambios".
  - Acceso al estado del editor vía `createUsePuck()` con selectores (API pública).
  - Botones Guardar borrador / Deshacer / Rehacer usando `history.back/forward/hasPast/hasFuture`.
- Conclusión: el flujo propose→diff→approve de la plataforma **puede montarse dentro del editor** sin pelearse con Puck.

### 7. Rendimiento (8 páginas, 30+ secciones) — **CUMPLE** (con límites de lo probado)
- Seed: **8 páginas, 62 bloques** (Home con 12 secciones raíz; `legal/terms` con 14 contando slots anidados), 6 testimonios, 6 posts. `npm run seed` tarda ~3 s incluido el push de schema.
- **Data JSON por página: 1,3–5,1 kB** (19,7 kB el sitio entero). Tamaño irrelevante a esta escala.
- **Build de producción: verde en ~10,2 s** de pared desde limpio (compile Turbopack 6,0 s + typecheck 2,6 s), Apple Silicon.
- **Editor montado** (medido con `performance.now` en cliente): **117 ms** con la página de 12 secciones; 140 ms con página vacía — el coste fijo del editor domina, el Data apenas pesa. Dev server: primer compile de `/edit` 2,6 s; cargas siguientes 30–150 ms.
- Fluidez subjetiva: las interacciones probadas (seleccionar, cambiar campos, cambiar viewport, undo) responden sin lag perceptible. Puck virtualiza listas (tanstack-virtual) y usa dnd-kit.
- **Límite de lo probado:** no se estresó una página de 100+ secciones ni se midió el drag con instrumentación; el drag & drop en sí no se ejercitó programáticamente (los clicks sintéticos no emulan dnd-kit de forma fiable) — queda para verificación manual en navegador.

---

## Fragilidades observadas en el API de Puck (honesto)

1. **El botón Publish del header es un `<span>`, no `<button>`** — fricción para tests E2E y accesibilidad; nuestro selector "button:Publish" falló hasta buscar por texto.
2. **Error de consola puntual** `NaN is an invalid value for the "top" css style property` al seleccionar un componente mediante click sintético (posicionamiento del overlay). No se reprodujo en cargas limpias ni en uso normal, pero indica que el overlay es sensible a eventos no estándar. Vigilar en E2E.
3. **`usePuck()` sin selector** dispara warnings ruidosos y re-renders; la forma correcta (`createUsePuck()` + selector) funciona bien pero está poco destacada en la doc.
4. **`ExternalField<T>`:** el genérico es el *valor mapeado del prop*, no el doc del CMS; `fetchList`/`mapRow` reciben `any`. El error de tipos hasta entenderlo es críptico.
5. **Undo/redo:** funciona (header + API `history` pública, verificado revirtiendo un binding). El historial es en memoria por sesión de editor; no persiste — para la plataforma, la persistencia de versiones debe vivir en el Artifact Model (como ya está diseñado), no en Puck.
6. Versionado: 0.21.3 con canaries 0.22 activos — el proyecto se mueve rápido; **pin de versión + smoke tests del editor** obligatorios. Existe `migrate`/`transformProps` para migrar Data JSON entre versiones (no probado).

## Fricciones del stack (no son de Puck)

7. **`payload run` + tsx:** (a) un script `.ts` sin top-level await muere **silenciosamente con exit 0** sin ejecutar las promesas pendientes — el seed debe ser `.mts` con TLA; (b) al importar `payload.config.ts` desde el script, el default export llega **doblemente envuelto** (`mod.default`) y hay que desenvolverlo. Ambas cosas costaron ~30 min de depuración y son trampas para CI.
8. **Turbopack + lockfiles múltiples:** al vivir el spike dentro del repo de la plataforma, `next build` adoptó la raíz del monorepo e intentó compilar `src/proxy.ts` de la plataforma. Se arregla con `turbopack.root` en `next.config.ts`. Relevante para la decisión "repo por proyecto" (§18.3): los proyectos generados DEBEN fijar root o vivir en repos propios (que es el plan).
9. **RSC:** `<Render>` de `@puckeditor/core/rsc` funciona, pero obliga a que los componentes del registry sean RSC-safe (sin hooks/efectos). Para el registry real es una restricción de diseño sana pero hay que documentarla. El campo `richtext` no se probó por esta razón (riesgo RSC desconocido).

## Riesgos para el MVP

- **R1 — Velocidad de cambio de Puck** (0.21→0.22): pin + smoke tests; presupuestar medio día por upgrade.
- **R2 — Admin UI de Payload sin validar** junto al editor (solo Local API validada). Si Studio necesita el admin embebido, hacer mini-spike de medio día.
- **R3 — Editor solo client-side:** todo `<Puck>` es client component; el bundle del editor es grande (tiptap entero viene como dependencia aunque no uses richtext). Aceptable para una herramienta interna; vigilar TTI en máquinas modestas.
- **R4 — Concurrencia:** SQLite = un writer; suficiente para CMS-por-proyecto del MVP, no probado bajo concurrencia. En producción la spec ya prevé Postgres por proyecto (mismo adapter API).
- **R5 — Estrés real no medido:** páginas de 50-100+ secciones, fotos reales (aquí placeholders), drag continuo. Programar una sesión de QA manual con el seed ampliado antes de comprometer el Studio.

## Plan B (editor propio sobre el mismo data model) — coste estimado

El Data JSON de Puck es portable y simple (`root` + `content[]` + slots como arrays anidados en props, ids estables). El registry y la config son nuestros. Si Puck cayera, habría que construir: canvas drag & drop entre slots (dnd-kit), panel de campos generado por schema, preview iframe multi-viewport con inyección de estilos, overlay de selección/acciones e historial undo/redo. Estimación honesta: **4–8 semanas de un design engineer senior para llegar a algo claramente peor** que lo que Puck da gratis (virtualización, auto-scroll en drag, overlay pulido, plugin rail). El lock-in real es bajo (MIT, data model documentado, componentes propios); el coste de salida es UI, no datos. Conclusión: el plan B es viable pero caro; no hay motivo para activarlo con lo visto.

## Limitaciones de lo probado (resumen)

- Drag & drop no ejercitado programáticamente (verificar a mano).
- Admin UI de Payload no montada.
- `richtext` field no usado.
- Sin test de carga (100+ secciones / multiusuario).
- `resolveAllData`/`resolveData` de Puck no usados para el render (resolución propia server-side).
- Auth/roles fuera de alcance del spike (las transiciones de aprobación no comprueban rol — en la plataforma eso lo impone el Artifact Model, restricción §19).

## Cómo correr la demo

```bash
cd spikes/puck
npm install
npm run seed     # crea .data/puck-spike.db: 8 páginas, 6 testimonios, 6 posts
npm run dev      # http://localhost:3000
#   /            índice (listado + crear página)
#   /edit/home   editor Puck (12 secciones; panel "Aprobación" en el rail izquierdo)
#   /home        render publicado (nota: el seed deja un diff intencionado home draft vs publicado)
#   /edit/customers  → componente "Testimonio destacado (CMS)" para probar el campo external
npm run build    # verde (~10 s)
```

(También hay una entrada `spike-puck` en `.claude/launch.json` del repo raíz que lo arranca en el puerto 3018.)
