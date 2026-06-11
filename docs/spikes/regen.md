# Spike §18.2 — Generación y regeneración parcial idempotente

**Fecha:** 2026-06-10 · **Código:** `spikes/regen/` (desechable, independiente del monolito) · **Estado de verificación:** typecheck limpio, 20/20 tests en verde, demo scriptada con todos los pasos PASS.

## Qué se construyó

Un programa TypeScript (tsx + zod, sin framework) que simula el ciclo generar → editar → regenerar del generador (§7.3) sobre los **tipos reales de la plataforma**: los schemas Zod de `cms.collections`, `page.composition` y `spec.sitemap` se copiaron byte a byte desde `src/modules/artifacts/types/` a `spikes/regen/src/schemas.ts` (divergencias anotadas en el header de ese archivo: se elimina el plumbing de `defineArtifactType`/registry y se consolida en un archivo; las formas, refinements y mensajes son idénticos). Toda entrada a `generate()`/`regenerate()` pasa por `specArtifactsSchema.parse()` — la misma regla de validación-en-escritura del monolito.

- **Generador** (`src/generator.ts` + `src/render.ts`): produce `payload.config.ts`, `collections/*.ts` y `types/generated.ts` desde `cms.collections`; rutas `app/**/page.tsx` y `navigation.ts` desde `spec.sitemap` (árbol anidado → carpetas); `compositions/page-*.json` desde `page.composition` (con bindings `prop → coleccion.campo`). Escribe `ownership.manifest.json`: cada archivo es `owned-by-codegen` (con sha256 del contenido generado) u `owned-by-human` (sin hash: codegen no vuelve a compararlo jamás). Los archivos codegen llevan header `@generated … content-hash: sha256:<hash-del-body>`.
- **Regenerador** (`src/regenerate.ts`): re-renderiza el set codegen deseado y lo reconcilia contra disco + manifest. Reporta conflictos estructurados (`src/conflicts.ts`), nunca los resuelve.
- **Demo** (`npm run demo`) y **tests** (`npm test`, `node:test`, cero deps extra).

## Criterio de salida §18.2, punto por punto

> "generar proyecto con colecciones desde la spec → usuario modifica páginas compuestas → se regenera el CMS schema → las páginas compuestas no se sobrescriben → si un campo eliminado está usado por un binding, el sistema marca conflicto"

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Generar proyecto con colecciones desde la spec | **CUMPLE** | Demo paso 1: 14 archivos generados (collections, config, types, 4 rutas, 4 composiciones, nav, manifest); test "generate produces codegen files with @generated header and content hash" verifica que el hash del header coincide con el body real. |
| 2 | Usuario modifica páginas compuestas | **CUMPLE** (simulado) | Demo paso 2 edita `page-home.json` (sección `cta` añadida + prop cambiada) escribiendo el JSON directamente — simulación fiel de lo que haría el Studio. |
| 3 | Se regenera el CMS schema (campo añadido + campo eliminado) | **CUMPLE** | Demo paso 3: `written=[collections/posts.ts, types/generated.ts]` — `heroImage` presente, `subtitle` ausente; `collections/authors.ts` (sin cambios de spec) queda en `unchanged`, no se reescribe. |
| 4 | Las páginas compuestas no se sobrescriben | **CUMPLE** | Demo paso 4: `page-home.json` byte-idéntico (sha256 antes/después) tras regenerar, incluida la edición humana. Test extra: composiciones de páginas eliminadas del sitemap se preservan (solo se borra la ruta codegen prístina). |
| 5 | Campo eliminado usado por binding → conflicto | **CUMPLE** | Conflicto `binding-missing-field` con página (`home`), sección (`intro`), prop (`subtitle`), colección (`posts`) y campo (`subtitle`); la página NO se modifica. Cubre además: binding a colección eliminada, bindings añadidos por el humano después de generar, y JSON roto a mano (`composition-unreadable` en vez de crash). |
| + | Edición humana en zona codegen → conflicto | **CUMPLE** | Demo paso 6: hack manual en `collections/authors.ts` → `human-edit-in-codegen-zone` con hashes esperado/actual; archivo intacto. Al revertir el hack, la siguiente regeneración aplica el cambio pendiente (`avatar`) — el conflicto bloquea solo ese archivo, no la regeneración entera. |
| + | Doble regeneración → idempotencia | **CUMPLE** | Demo paso 7: segunda regeneración con la misma spec = 0 written, 0 created, árbol completo byte-idéntico (hash por archivo, manifest incluido). Tests adicionales: `generate` es determinista entre directorios distintos, y la idempotencia se mantiene con conflictos pendientes (se re-reportan estables, sin tocar nada). |

**Decisiones de diseño que el spike valida y que deberían trasladarse a la versión real:**

- **Manifest de ownership como fuente de verdad, no el header.** El header `@generated` es señalización para el humano; la detección de ediciones usa el hash del manifest. Si el humano borra el header, sigue detectándose (hash mismatch).
- **Determinismo total del render** (sin timestamps, sin ids aleatorios, ordenación estable) es lo que hace la idempotencia verificable por hash. Cualquier render no determinista en la versión real rompe la garantía.
- **Conflicto = skip por archivo, no abort global.** La regeneración aplica todo lo aplicable y reporta el resto; un archivo en conflicto no se actualiza hasta resolución manual (revertir o adoptar). Coherente con "marca, nunca regenera" (§8.4).
- **Huérfanos:** un archivo codegen que la spec ya no produce se borra solo si está prístino; con ediciones manuales → `orphan-codegen-modified`, no se borra. Un archivo codegen borrado a mano → conflicto, no se recrea en silencio.
- **Páginas nuevas en la spec** reciben ruta codegen + scaffold de composición; el scaffold se crea UNA vez y pasa a ser humano para siempre (nunca se sobrescribe, ni aunque el artefacto `page.composition` cambie después — la composición viva es la del Studio, no la del artefacto).

## Riesgos para la versión real (lo que este spike NO prueba)

1. **Granularidad zona-dentro-de-archivo vs. archivo completo.** El spike usa ownership por archivo entero. Es suficiente porque el layout generado separa limpio (collections codegen / composiciones humanas). Pero §16 habla de "zonas de archivo": en cuanto un archivo real necesite mezclar (p.ej. `payload.config.ts` con hooks humanos + colecciones codegen), harán falta marcadores de región (`// <codegen:begin id>…// <codegen:end>`) con hash por región, y la detección de ediciones se vuelve frágil ante movimientos de texto, ediciones del marcador mismo y formateadores (Prettier reordenando = falso conflicto). **Recomendación: diseñar el layout del proyecto generado para que ownership por archivo baste casi siempre** (archivos "slots" humanos importados desde archivos codegen), y dejar zonas intra-archivo como excepción tardía, no como base.
2. **Formateadores y tooling del proyecto generado.** Cualquier `prettier --write`, `eslint --fix` o save-hook del editor sobre un archivo codegen cambia bytes → falso conflicto `human-edit-in-codegen-zone`. La versión real necesita o (a) emitir output ya formateado con el formatter del template y versión pineada, o (b) comparar AST/contenido normalizado en vez de bytes. El spike compara bytes puros.
3. **Merge de tipos TS generados.** Aquí `types/generated.ts` se regenera entero (es 100% derivable). Si la versión real permite que el proyecto extienda tipos generados (augmentation, generics de Payload), regenerar-entero deja de valer y aparece el problema de merge real. Mantener los tipos generados como archivo cerrado + un archivo de extensión humano separado evita el merge por completo.
4. **Migraciones de datos destructivas (§10.3 / R4) — explícitamente FUERA de este spike.** Eliminar `posts.subtitle` aquí solo reescribe un `.ts`; en producción es un `ALTER TABLE` con contenido real de cliente detrás. El conflicto de binding detecta el impacto en páginas, pero NO el impacto en datos (filas que pierden la columna, relaciones huérfanas). El flujo de migración con preview de impacto, confirmación y backup pre-migración es trabajo de diseño separado y sigue siendo el riesgo gordo de la regeneración real.
5. **Git como capa de escritura.** En la plataforma real la escritura va vía commits a un repo por proyecto (§16). El modelo manifest+hash se traslada bien (los hashes pueden vivir en el propio repo y el diff de conflicto se vuelve un diff git legible), pero el spike no prueba concurrencia (humano pusheando mientras la plataforma regenera) ni resolución vía PR. La detección hash-mismatch es equivalente a un dirty working tree; la versión real debería regenerar sobre una rama limpia.
6. **Bindings con formas más ricas.** El spike asume binding `coleccion.campo` (string plana, como documenta `page-composition.ts`). Bindings anidados (campos de relación: `posts.author.name`), arrays o transformaciones requerirán un resolutor de paths contra el schema, no un `Set.has()`. La estructura del conflicto (página/sección/prop/campo) sí es la correcta y es lo que la UI necesita.
7. **Escala del set de archivos.** Probado con 2 colecciones, 4 páginas, 14 archivos. El render completo + reconciliación es O(archivos) y barato, pero con cientos de páginas conviene render perezoso por subconjunto afectado (el grafo de dependencias de artefactos §8.4 ya dice qué cambió).

## Limitaciones de lo probado

- Proyecto **simulado**: los `.ts` generados imitan la forma de Payload CollectionConfig pero no se compilan contra Payload real ni se ejecuta Next. El spike valida el **modelo de ownership/regeneración**, no la calidad del codegen Payload (eso pertenece al entregable generator del MVP y, en parte, al spike §18.1).
- "Usuario modifica páginas" es una escritura directa de JSON, no una sesión de Puck; la equivalencia es razonable porque el Studio persiste exactamente ese JSON, pero queda asumido.
- No se probó concurrencia (dos regeneraciones simultáneas) ni recuperación de versiones anteriores ("versiones anteriores siempre recuperables" de §18.2 lo cubre el Artifact Model + git de la plataforma, no este spike).

## Recomendación

**GO, con condiciones.** El modelo ownership-por-archivo + manifest con hash + render determinista + conflicto-como-dato cumple todas las garantías de §18.2 con un mecanismo pequeño y verificable (~600 líneas). Condiciones para el build real: (1) diseñar el layout del proyecto generado para que el ownership por archivo entero sea la norma (slots humanos en archivos separados) y posponer zonas intra-archivo; (2) fijar la estrategia anti-formatter (output pre-formateado con versión pineada o comparación normalizada) antes de generar proyectos reales; (3) tratar la migración de datos destructiva (§10.3) como un flujo aparte con preview/confirmación/backup — el conflicto de binding de este spike es necesario pero no suficiente; (4) regenerar siempre sobre working tree/rama limpia cuando la escritura sea vía git.

## Cómo correr

```bash
cd /Users/michelleai/MVPDMXTool/spikes/regen
npm install
npm test        # 20/20 node:test
npm run demo    # secuencia §18.2 con PASS/FAIL por paso; salida en .data/demo-out/
npm run build   # tsc --noEmit
```
