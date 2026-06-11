# Registry del Visual Studio (§7.4) — espejo del template

Este directorio es la copia plataforma del **registry de 34 secciones
gobernadas** del template de proyectos. El Studio compone páginas con estos
componentes dentro del canvas de Puck; el sitio del cliente las renderiza con
el registry del template. **La compatibilidad de render es sagrada**: el Data
JSON que produce el Studio debe renderizar idéntico en el renderer del
template — mismos nombres de componente Puck, mismas props/fields/defaultProps,
mismo formato de bindings.

## Fuente de verdad

**`templates/project-base/src/puck/**`**. Los cambios de componentes nacen en
el template (es lo que corre en producción en cada proyecto generado) y se
portan aquí. Este directorio NUNCA evoluciona por su cuenta: un componente que
solo exista aquí produciría composiciones que el sitio del cliente no sabe
renderizar.

## Mapa de archivos

| Aquí | Template | Tipo de copia |
| --- | --- | --- |
| `primitives.tsx` | `src/puck/primitives.tsx` | **verbatim** (solo header) |
| `sections/structure.tsx` | `src/puck/sections/structure.tsx` | **verbatim** |
| `sections/heroes.tsx` | `src/puck/sections/heroes.tsx` | **verbatim** |
| `sections/content.tsx` | `src/puck/sections/content.tsx` | **verbatim** |
| `sections/marketing.tsx` | `src/puck/sections/marketing.tsx` | **verbatim** |
| `sections/cms.tsx` | `src/puck/sections/cms.tsx` | renders verbatim; **campos `external` → custom field de bindings** (ver abajo) |
| `sections/navigation.tsx` | `src/puck/sections/navigation.tsx` | renders/fields verbatim; **defaultProps por factory** (el template los importa de `site.config.ts` + codegen) |
| `config.tsx` | `src/puck/config.tsx` | misma estructura/categorías/root; **export como factory `createPuckConfig`** |
| `bindings.tsx` | *(no existe — sustituye al campo `external` + `/api/external/*`)* | propio de plataforma |
| `tokens-css.ts` | *(contraparte: `src/modules/generator/render.ts → renderTokensCss`)* | **duplicado sincronizado** del codegen |
| `canvas-css.ts` | *(contraparte: paleta default de Tailwind del build del template)* | propio de plataforma |
| `smoke-render.mts` | — | verificación |

## Divergencias deliberadas (todas retro-compatibles con el Data JSON)

1. **Campos CMS (`external` → custom field).** El template lista documentos
   reales de su Payload (`/api/external/*`), que la plataforma no corre. El
   custom field de `bindings.tsx` ofrece selector de colección + asignación de
   campos **validados contra el artefacto `cms.collections` aprobado** y
   guarda EXACTAMENTE el shape que el runtime del template re-resuelve por
   request (`templates/project-base/src/lib/bindings.ts`):
   `{ collection, docId, ...snapshot }`.
   - En el Studio el snapshot lleva placeholders representativos
     (`[contenido de case-studies.summary]`) que el canvas renderiza tal cual.
   - El runtime del template hace `{ ...snapshot, ...docFresco }` **sin
     remapear nombres**: solo las claves del snapshot cuyo nombre coincide con
     un campo del documento se refrescan. La UI avisa cuando la asignación no
     coincide por nombre, y `validateCompositionBindings`
     (`src/modules/artifacts/bindings.ts`) reporta esas claves huérfanas como
     conflicto `binding-missing-field` — los dos mecanismos aplican la misma
     regla.
   - `docId` apunta a los documentos de ejemplo del seed (1..3 en una DB
     recién sembrada). Si el id no resuelve, el template conserva el snapshot
     y lo marca `_broken: true` (degradación visible, no rotura); re-vincular
     el documento real es tarea del editor del proyecto (`/edit`).
2. **Navbar/Footer.** El template saca sus defaultProps de `site.config.ts` y
   `src/generated/navigation.ts` (codegen). Aquí `createNavigationSections`
   los recibe por parámetro (derivados del sitemap aprobado). Solo afecta a
   inserciones NUEVAS; las páginas compuestas conservan sus props.
3. **Tipos `TestimonialRef`/`PostRef`.** El template tipa `collection` con el
   literal de su colección de ejemplo; aquí se ensancha a `string` (la
   colección del proyecto puede llamarse distinto). Solo tipos; mismos datos.
4. **`tokensCss`** duplica el mapeo de `renderTokensCss` del generator (la
   regla de límites de módulos impide `studio → generator`). Diferencia única:
   sin header `@generated`. **Si cambia el mapeo allí, cambiarlo aquí.**

## Estilos del canvas (contrato para el editor)

El canvas de Puck es un iframe que renderiza el **sitio del cliente**: ahí van
los estilos del proyecto, no los tokens §11.4 de la plataforma (que gobiernan
todo lo demás, incluida la UI del propio custom field de bindings).

- **`brand-*`**: `src/app/globals.css` de la plataforma mapea
  `bg-brand-50..900` etc. a `var(--brand-N, <fallback neutro>)`. Puck copia
  las hojas del documento padre dentro del iframe, así que esas utilities ya
  llegan al canvas. Quedan **prohibidas en la UI de la plataforma** (son del
  sitio del cliente; el lint §11.4 sigue purgando la paleta default).
- **Valores del proyecto**: inyectar `studioCanvasCss(designTokens)` (o
  `tokensCss` a secas) en un `<style>` dentro del iframe vía
  `overrides.iframe` de Puck 0.21 (`{ children, document }` — añadir al
  `document.head` para quedar DESPUÉS de las hojas copiadas y ganar la
  cascada). Con `iframe.waitForStyles` (default) Puck espera a que carguen.
- **`canvasBaseCss`**: las utilities `neutral-*`/`amber-*` que usa el registry
  no existen en el CSS de la plataforma (el design-lint hace
  `--color-*: initial`), así que el iframe debe recibirlas por la misma vía.
  Valores = paleta default de Tailwind v4, idénticos a los del build del
  template.
- Las fuentes del proyecto (`--font-sans` de tokensCss) resuelven si la
  familia está disponible; el template las carga con `next/font` — el canvas
  degrada a la fuente del sistema (aceptable en MVP).

## Checklist de sincronización (cuando el template cambie)

1. `diff` de cada archivo de la tabla contra su contraparte del template
   (ignorando los headers "COPIA SINCRONIZADA" y los puntos de divergencia
   listados arriba).
2. ¿Componente/prop/defaultProp nuevo o renombrado? Portarlo idéntico aquí y a
   `config.tsx` (lista + categoría). Recordar: renombrar un componente rompe
   las composiciones existentes — exige migración de Data JSON
   (`transformProps` de Puck) en AMBOS lados.
3. ¿Clase de color `neutral-*`/`amber-*` nueva en algún render? Añadir la
   regla a `canvasBaseCss` (el build de la plataforma no la emite).
4. ¿Variable `--brand-N` nueva en el contrato de tokens? Añadirla al bloque
   `@theme inline` de `src/app/globals.css` y al mapeo del template
   (`src/app/(site)/globals.css`).
5. ¿Cambió `renderTokensCss` en `src/modules/generator/render.ts`? Replicar en
   `tokens-css.ts`.
6. ¿Cambió el shape de binding del template (`lib/bindings.ts` / `mapProp`)?
   Replicar en `bindings.tsx` y revisar `src/modules/artifacts/bindings.ts`.
7. Correr `npx tsx src/modules/studio/registry/smoke-render.mts` y
   `npx tsc --noEmit`.

## Riesgo asumido

La duplicación template↔plataforma es deliberada (el template no puede
depender de paquetes de la plataforma en runtime, §19, y la plataforma no
compila el template). El coste es divergencia silenciosa; la mitigación es
esta checklist + el smoke test + que toda extensión del registry es tarea de
developer (§11.3) que toca ambos lados en el mismo cambio.
