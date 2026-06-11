# Agency Workstation — Documento Final de Producto

**Versión:** 1.2 — Decisiones resueltas + validación con agencias completada (gate §18.7 superado)
**Fecha:** 2026-06-10
**Estado:** Gate de validación superado. Handoff técnico (§19) habilitado, condicionado únicamente a los dos spikes técnicos (§18.1, §18.2)
**Autores (rol simulado):** CPO, Principal Product Architect, Design Systems Lead, AI Platform Architect, Technical Lead, Agency Operations Strategist

---

## 1. Executive Summary

Agency Workstation es una plataforma de producción digital para agencias de diseño, branding y desarrollo que convierte briefs en productos web editables, revisables y publicables, con human-in-the-loop como modo operativo central — no como capa de revisión final.

La tesis del producto: **las agencias no necesitan otro generador de sitios con IA; necesitan un sistema de control de producción donde la IA propone y el humano gobierna.** El diferencial no está en ningún módulo individual (spec, editor visual, CMS, deploy — todos existen por separado) sino en el flujo completo conectado por un modelo de artefactos estructurados, versionados y aprobables.

Decisiones principales tomadas en este documento, resolviendo contradicciones de los documentos fuente:

1. **Puck es el núcleo del editor visual, no Webstudio.** Webstudio queda como benchmark de UX. Esta contradicción entre el blueprint ("inspirado/integrado con Webstudio") y la visión de producto (que ya recomendaba Puck) se resuelve a favor de Puck por coherencia arquitectónica con React/Next.js/Payload. Ver §11.
2. **No se construye ni integra un Plane/ClickUp en el MVP.** La "Project Control Layer" se reduce a un sistema de fases, gates y tareas nativo del modelo de artefactos. Un PM tool completo es un producto en sí mismo y diluiría el foco. Ver §12.
3. **Payload cumple dos roles distintos que los documentos fuente confunden:** (a) candidato a capa de administración de la plataforma misma, y (b) CMS embebido en cada proyecto generado. Se confirma (b); (a) se descarta a favor de un backend propio sobre Postgres. Ver §10.
4. **El Agent Gateway externo sale del MVP.** El MVP incluye el runtime de agentes internos con skills, contratos y aprobación humana — que es la infraestructura sobre la que el gateway externo se montará después. Exponer un gateway sin auditoría madura es un riesgo, no una feature. Ver §9 y §14.
5. **La fuente de verdad son artefactos tipados (JSON schemas), nunca el chat ni Markdown.** El chat es una interfaz de lectura/escritura contra artefactos. Ver §8.
6. **El MVP es web-only pero el modelo de artefactos es channel-agnostic** (las páginas son un tipo de "surface"; mobile y branding son surfaces futuros, no reescrituras). Ver §14-15.

El MVP construible (§14) es: Spec OS reducido → generador de proyecto Next.js + Tailwind + Payload + Puck → edición visual con component registry → preview compartible con comentarios de cliente → deploy a Vercel → 5 skills internas con ciclo propose → diff → approve, sobre **BYOK de LLMs por workspace**. Las decisiones bloqueantes de §18 están resueltas y **la validación con agencias está superada** (registry aceptado con ruta agent-assisted, client review demandado, intención de pago confirmada, usuario núcleo = Design Engineer). El único bloqueante restante para el build completo son los dos spikes técnicos de Puck y regeneración parcial.

---

## 2. Product Definition

**Qué es:** una plataforma SaaS (con opción self-hosted futura) donde una agencia gestiona el ciclo completo de un proyecto digital: intake → spec estructurada → generación de proyecto → edición visual gobernada por design system → contenido en CMS → revisión con cliente → deploy. Los agentes de IA operan dentro de este ciclo mediante skills con contratos explícitos, y ningún output crítico avanza sin aprobación humana.

**Qué no es:**
- No es un AI website builder de consumo (tipo "describe tu sitio y publícalo"). El usuario es profesional y el control es el producto.
- No es un chat que genera archivos. El chat existe, pero lee y escribe contra artefactos.
- No es un project management tool. Tiene control de fases y tareas, pero acotado al flujo de producción de artefactos.
- No es un page builder freeform. El editor visual opera sobre componentes aprobados del design system, no sobre HTML/CSS arbitrario.

**Posicionamiento en una frase:** *el sistema operativo de producción de una agencia: de brief a release, con IA gobernada por humanos.*

**Categoría:** no compite frontalmente con Webflow/Framer (diseñadores individuales, diseño libre), ni con v0/Lovable (generación rápida sin gobierno), ni con ClickUp/Plane (gestión genérica). Compite por el flujo completo agencia↔cliente con trazabilidad, que ninguno cubre.

---

## 3. Target Users & Use Cases

### Usuarios primarios

**1. Design Engineer de agencia (usuario núcleo del MVP — confirmado en validación §18.7).** Perfil híbrido diseño-código que dirige la producción: edita specs, compone en el Visual Studio, gobierna el component registry, invoca skills y decide qué se aprueba. La validación con agencias confirmó que este rol —y no un lead puramente estratégico ni un developer puro— es quien vive en la plataforma a diario. Todo el MVP se diseña para que esta persona pueda hacer el trabajo de un equipo pequeño con asistencia de IA. Implicación de diseño: la UI no puede esconder lo técnico (IDs, diffs, schemas, logs son features, no detalles), lo que refuerza la dirección visual "Editorial Engineering" de §11.4.

**2. Design/Product Lead.** Dirige la relación con cliente, aprueba gates de fase, presenta el Cockpit frente al cliente interno. Decide; el Design Engineer ejecuta.

**2. Diseñador/a UI.** Trabaja en el Visual Studio y el design system. Necesita que el canvas sea preciso y que los componentes respeten tokens.

**3. Content designer / estratega.** Trabaja en Spec OS y Content System: copies, mensajes, SEO, tono.

**4. Developer de agencia.** Configura component registry, extiende colecciones Payload, revisa el output generado, gestiona deploys. No vive en la plataforma a diario, pero debe confiar en que el código generado es código real y exportable.

**5. Cliente (rol externo, permisos mínimos).** Ve previews, comenta, aprueba. Nunca toca spec, diseño ni CMS. Su experiencia debe ser tan simple que no requiera onboarding.

### Usuario secundario (post-MVP)

**6. Operador de agentes externos.** Equipos que conectan Claude Code, OpenCode u otros agentes vía gateway para ejecutar skills (auditorías SEO, QA de accesibilidad, generación de variantes). Existe solo cuando el gateway externo se active.

### Casos de uso del MVP

- Agencia recibe brief de sitio corporativo → intake → spec generada y editada → proyecto generado → 5-10 páginas compuestas en Puck → cliente comenta sobre preview → 2-3 rondas de iteración con historial → deploy a producción.
- Rediseño de sitio existente: spec parte de auditoría manual, el resto del flujo es idéntico.
- Landing de campaña: flujo corto (spec mínima → 1-2 páginas → review → deploy), valida que el sistema no obliga a ceremonias innecesarias en proyectos pequeños.

### Casos de uso explícitamente fuera del MVP

Apps mobile, branding generativo (logos, identidad), email marketing, sitios multi-idioma complejos, e-commerce transaccional. El modelo de artefactos los anticipa; el producto no los promete.

---

## 4. Core Pain Points

Dolores reales de agencia que el producto ataca, en orden de severidad:

1. **El conocimiento del proyecto vive disperso** (docs, Figma, Slack, emails, cabezas). Cuando alguien pregunta "¿qué se aprobó?", la respuesta es arqueología. → Artefactos estructurados con estados y versiones.
2. **El feedback del cliente es caótico**: capturas por WhatsApp, PDFs anotados, llamadas sin acta. → Review layer con comentarios anclados a páginas/secciones y resolución rastreable.
3. **El trabajo con IA no es auditable**: outputs de ChatGPT pegados en docs, sin saber qué versión del brief usó, qué cambió, ni quién lo validó. → Agent runs con trazabilidad completa y aprobación obligatoria.
4. **El handoff diseño→desarrollo pierde información**: lo diseñado y lo implementado divergen. → El diseño *es* la implementación: componentes React reales editados visualmente.
5. **Cambios upstream rompen downstream silenciosamente**: cambia el tono de marca y nadie revisa los copies; cambia el sitemap y quedan rutas huérfanas. → Grafo de dependencias que marca artefactos como `outdated`.
6. **El cliente no puede aprobar formalmente nada**: las aprobaciones son emails ambiguos. → Aprobaciones explícitas, versionadas, con responsable.

El punto 1 y el 3 son los que justifican la existencia del producto. Los demás son resolubles parcialmente con herramientas existentes; la combinación no.

---

## 5. Product Principles

1. **Human-in-the-loop es el modo operativo, no un checkbox.** Cada artefacto crítico pasa por: agente propone → sistema valida → humano revisa → humano aprueba/edita/regenera → versión sellada. Sin excepción en el MVP.
2. **Los artefactos son la fuente de verdad. El chat es una interfaz.** Toda conversación con un agente termina en lectura o escritura de artefactos estructurados, con diff visible.
3. **La IA propone, el sistema restringe, el humano decide.** Los agentes operan dentro de contratos de skill: qué leen, qué escriben, qué validaciones pasan, si requieren aprobación.
4. **Manual first, AI accelerated.** Todo lo que hace un agente debe poder hacerse a mano. La plataforma funciona con IA apagada (más lenta, no rota).
5. **El diseño está gobernado por el design system.** El editor visual no permite romper tokens ni componentes aprobados. La libertad creativa vive en el registry, no en el canvas.
6. **El output es código real y exportable.** Next.js + Payload estándar, sin runtime propietario. Si la agencia se va, se lleva el proyecto. Esto es argumento de venta, no debilidad.
7. **Claridad sobre cantidad.** Cada módulo del MVP debe ser usable de punta a punta antes de añadir el siguiente.
8. **Web primero, channel-agnostic por diseño.** Las páginas web son el primer tipo de surface; el modelo de datos no asume que sea el único.

---

## 6. Final Product Architecture

Arquitectura de tres capas conectadas por el modelo de artefactos, con un plano de control transversal:

```text
┌─────────────────────────────────────────────────────────────┐
│  PROJECT COCKPIT  (plano de control transversal)            │
│  fases · gates · estados · tareas · activity · aprobaciones │
└─────────────────────────────────────────────────────────────┘
        │                    │                     │
┌───────▼────────┐  ┌────────▼─────────┐  ┌────────▼─────────┐
│  SPEC LAYER    │  │ COMPOSITION      │  │ PUBLISHING       │
│                │  │ LAYER            │  │ LAYER            │
│  Spec OS       │→ │ Project Generator│→ │ Payload CMS      │
│  · intake      │  │ Visual Studio    │  │ Client Review    │
│  · strategy    │  │  (Puck)          │  │ Deploy & Release │
│  · IA/sitemap  │  │ Component        │  │  (Vercel)        │
│  · content sys │  │  Registry        │  │                  │
│  · CMS model   │  │ Design Tokens    │  │                  │
│  · design sys  │  │                  │  │                  │
└────────────────┘  └──────────────────┘  └──────────────────┘
        │                    │                     │
┌───────▼────────────────────▼─────────────────────▼─────────┐
│  ARTIFACT MODEL  (fuente de verdad)                         │
│  artefactos tipados · versiones · estados · dependencias    │
│  · aprobaciones · locks                                     │
├─────────────────────────────────────────────────────────────┤
│  AGENT RUNTIME                                              │
│  skills · contratos · validaciones · agent runs · auditoría │
│  (interno en MVP; Agent Gateway externo post-MVP encima)    │
├─────────────────────────────────────────────────────────────┤
│  PLATFORM CORE                                              │
│  workspaces · proyectos · usuarios · roles · permisos ·     │
│  auth · audit log · storage                                 │
└─────────────────────────────────────────────────────────────┘
```

Puntos arquitectónicos clave:

- **El Artifact Model es el centro de gravedad.** Spec OS, Visual Studio, CMS y Review no se comunican entre sí directamente: leen y escriben artefactos. Esto es lo que permite que los agentes (internos hoy, externos mañana) operen sobre el mismo sustrato que los humanos.
- **El Agent Runtime es interno al monolito en el MVP.** El Agent Gateway externo es una fachada futura sobre el mismo runtime (mismos contratos de skill, misma auditoría), no un sistema paralelo.
- **Cada proyecto generado es un artefacto desplegable independiente** (repo Next.js + Payload), gestionado por la plataforma pero no atrapado en ella.

---

## 7. Core Modules

### 7.1 Project Cockpit
Dashboard del proyecto. Muestra fases con estados, gates de aprobación, artefactos pendientes/aprobados/desactualizados, activity feed, tareas abiertas y panel de agente contextual. Es la pantalla de inicio de cada proyecto y la que se abre frente al cliente interno.

### 7.2 Spec OS
Editor estructurado de la especificación. Fases del MVP: **Intake** (objetivo, cliente, alcance, restricciones), **Strategy** (audiencia, posicionamiento, propuesta de valor), **Information Architecture** (sitemap, navegación), **Content System** (mensajes clave, copies por página, SEO básico), **Data/CMS Model** (colecciones, campos, relaciones), **Design System** (tokens, tipografía, selección de componentes del registry). Brand & Identity completo (logo, assets, guidelines generativas) se reduce en MVP a "brand inputs": el cliente trae su marca; la plataforma no la genera.

Cada sección de la spec es un artefacto independiente versionable, con campos tipados, validaciones, diffs e historial. La spec completa nunca se aprueba "en bloque": se aprueba por artefacto, y los gates de fase agregan esas aprobaciones.

### 7.3 Project Generator
Toma artefactos aprobados de la spec y genera: proyecto Next.js + Tailwind + Payload configurado, colecciones CMS desde el Data Model, rutas desde el sitemap, páginas template con secciones desde el Content System, component registry instanciado, fixtures de contenido, configuración de Puck. La generación es **idempotente y regenerable por partes**: si cambia el CMS model, se regeneran colecciones sin tocar páginas compuestas (con detección de conflictos, no sobrescritura ciega).

### 7.4 Visual Studio
Editor visual basado en Puck. El canvas compone páginas con componentes del registry; los props editables están definidos por componente; los estilos disponibles son los tokens del design system. Incluye: reordenar/insertar/eliminar secciones, editar variantes, bindings a campos CMS, preview responsive, estados de página (draft/in review/approved). No incluye edición CSS libre — decisión deliberada, ver §11.

### 7.5 Component Registry & Design Tokens
Catálogo de componentes React aprobados (con sus contratos de props, variantes y bindings posibles) y tokens (color, tipografía, spacing, radios). Es la capa que hace que "editable" no signifique "rompible". En MVP el registry parte de una librería base propia (~25-35 componentes de secciones típicas: hero, features, pricing, testimonios, CTA, footer, etc.); la extensión custom por agencia es post-MVP.

### 7.6 CMS (Payload embebido por proyecto)
Cada proyecto generado incluye Payload: colecciones definidas por el Data Model de la spec, contenido editable por el equipo, media library, y los page documents que Puck persiste. Ver §10.

### 7.7 Client Review
Preview compartible por URL con auth ligera de cliente. Comentarios anclados a página y sección, hilos, estados (abierto/resuelto), solicitud de aprobación de versión, historial de rondas. El cliente ve *solo* esto.

### 7.8 Deploy & Release
Deploy a Vercel: preview por versión, staging, production, rollback a versión anterior, checklist de release (validaciones automáticas + confirmación humana). Deploy a servidor propio es post-MVP.

### 7.9 Agent Runtime & Skills (interno)
Ejecución de skills con contrato: lecturas, escrituras, validaciones, aprobación requerida. Agent runs auditados (qué leyó, qué propuso, qué modelo usó, qué validaciones corrió, quién aprobó). Panel de agente contextual en Cockpit, Spec OS y Visual Studio. Model-agnostic vía capa de proveedor (Anthropic/OpenAI/otros) desde el día uno. **BYOK (bring your own key) es requisito de MVP, no opción** — la validación con agencias (§18.7) identificó "sus licencias de LLM" como la única integración imprescindible: cada workspace configura sus propias API keys por proveedor, los agent runs consumen las credenciales del workspace, y la plataforma no revende tokens en v1. Esto simplifica además pricing (sin margen sobre inferencia) y la postura de datos (el DPA relevante es el que la agencia ya tiene con su proveedor).

### 7.10 Project Control (fases, gates, tareas)
Sistema ligero nativo: cada fase tiene gate de aprobación; los artefactos generan tareas implícitas ("revisar X", "resolver comentarios de Y"); tareas manuales simples (título, responsable, estado, vínculo a artefacto). Sin sprints, sin gantt, sin time tracking. Ver §12.

---

## 8. Artifact Model

Es el corazón del sistema. Todo lo demás se diseña alrededor de esto.

### 8.1 Definición

Un **artefacto** es una unidad tipada, versionada y aprobable de conocimiento o construcción del proyecto. Ejemplos: `spec.strategy`, `spec.sitemap`, `content.page.home`, `cms.collections`, `design.tokens`, `page.home.composition`, `release.v3`.

```json
{
  "id": "art_8f2k",
  "projectId": "prj_x1",
  "type": "spec.sitemap",
  "schemaVersion": "1.2",
  "status": "approved",
  "currentVersion": 4,
  "lockedBy": "gate:phase.ia",
  "owner": "usr_lead",
  "dependsOn": ["art_strategy"],
  "dependents": ["art_routes", "art_nav", "page.*"],
  "payload": { "...estructura tipada por type..." }
}
```

### 8.2 Estados

`empty → draft → in_review → approved → locked` más dos estados transversales:

- **`outdated`**: un artefacto del que depende cambió de versión aprobada. No invalida el contenido; exige re-revisión. Un artefacto `approved` puede estar simultáneamente `outdated`.
- **`rejected`**: vuelve a `draft` con feedback adjunto.

Reglas: solo humanos con rol suficiente transicionan a `approved`. `locked` lo aplica un gate de fase o un lock manual; editar un artefacto locked exige desbloquearlo explícitamente, lo cual marca dependientes como `outdated` y queda en el audit log.

### 8.3 Versiones

Cada escritura aprobada crea una versión inmutable (snapshot completo del payload + autor + origen: humano | agent_run_id). Los drafts son mutables hasta entrar a review. Diff estructural entre versiones (no diff de texto plano) es requisito del MVP — es la base de la experiencia de revisión.

### 8.4 Dependencias y propagación

Grafo dirigido declarado en los schemas de tipo de artefacto (no inferido). Cuando se aprueba una nueva versión de A, todos los dependientes pasan a `outdated` y generan tareas de re-revisión. **Decisión importante: la propagación marca, nunca regenera automáticamente.** La regeneración en cascada automática es exactamente el tipo de "IA que decide sola" que el producto promete evitar; además produce tormentas de invalidación. El humano ve qué quedó desactualizado y decide qué regenerar (con un clic, vía skill) o qué revalidar sin cambios.

Grafo del MVP (suficiente y acotado):

```text
spec.intake → spec.strategy → spec.sitemap → routes, nav, page.*
spec.strategy → content.* 
brand.inputs → content.*, design.tokens
cms.collections → page bindings, fixtures
design.tokens → component themes, page.* (visual)
page.*.composition → release.*
```

### 8.5 Aprobaciones y gates

Aprobación = acción explícita de un usuario con rol, sobre una versión concreta, con comentario opcional. Los **phase gates** del Cockpit agregan: una fase se cierra cuando sus artefactos obligatorios están `approved` y sin `outdated` pendientes. Las aprobaciones de cliente (en Review) son un tipo distinto: aprueban *versiones de página/release*, nunca artefactos internos.

### 8.6 Relación con agentes

Los agentes nunca escriben directamente sobre un artefacto aprobado. Un agent run produce una **propuesta** (draft de nueva versión) + diff + resultados de validaciones. El humano la aprueba (se vuelve versión), la edita y aprueba, o la rechaza. Esto unifica el flujo: para el Artifact Model, un humano editando y un agente proponiendo son el mismo tipo de evento con distinto origen.

---

## 9. Agent & Skills Model

### 9.1 Skills como contrato operativo (se confirma el diseño del documento fuente)

```json
{
  "name": "write-homepage-copy",
  "version": "1.0",
  "reads": ["brand.inputs", "spec.strategy", "spec.sitemap", "content.page.home"],
  "writes": ["content.page.home"],
  "requiresApproval": true,
  "validations": ["tone-match", "length-bounds", "seo-basics", "no-empty-fields"],
  "modelPolicy": { "preferred": "claude", "fallbacks": ["openai"] },
  "costBudget": { "maxTokens": 60000 }
}
```

Ajustes sobre la propuesta original: se añade `version` (las skills evolucionan y los agent runs deben referenciar la versión exacta), `modelPolicy` (model-agnostic con preferencias) y `costBudget` (sin límites de coste por run, el gateway futuro es un agujero económico).

### 9.2 Crítica a los "agentes persona" del documento fuente

El documento fuente propone 8 agentes internos con personalidad (Project Strategist, Brand Strategist, Information Architect...). **Esto es packaging, no arquitectura.** La unidad real es la skill; los "agentes" son agrupaciones de skills con un prompt de sistema y un contexto. Mantener 8 personas en el MVP multiplica superficie de prompt-engineering sin valor para el usuario. Decisión: el MVP expone **un asistente contextual único** que invoca skills según dónde esté el usuario (en Spec OS ofrece skills de spec; en Visual Studio, de páginas). Las personas diferenciadas son una decisión de UX post-MVP, montada sobre las mismas skills.

### 9.3 Skills del MVP (lista cerrada)

1. `generate-spec-draft` — de intake a borradores de strategy + sitemap.
2. `generate-cms-schema` — de spec a colecciones propuestas.
3. `write-page-copy` — copies por página dentro del content system.
4. `compose-page-draft` — composición inicial de página con componentes del registry.
5. `revise-artifact` — iteración dirigida sobre cualquier artefacto ("haz el tono más premium") con diff.

Cinco skills que cubren el flujo completo. Auditorías (SEO, accesibilidad, visual QA) son post-MVP: valiosas, pero el flujo funciona sin ellas.

### 9.4 Project Context API

Se confirma, con un matiz: en el MVP es una **API interna** que alimenta a las skills (estado del proyecto, artefactos aprobados, dependencias, criterios). Diseñarla desde el día uno como si fuera a ser pública —recursos limpios, scopes, paginación— hace que el gateway externo posterior sea exposición, no reescritura.

### 9.5 Agent Gateway externo (post-MVP, diseño anticipado)

Cuando se active: autenticación por API keys con scopes por proyecto y por skill, descubrimiento de proyectos/skills disponibles, ejecución de skills idéntica a la interna (mismas validaciones, misma aprobación humana, misma auditoría), rate limits y budgets. **Recomendación técnica a validar: exponerlo como servidor MCP** además de REST — es el estándar emergente para interoperabilidad de agentes y haría la plataforma consumible por Claude Code y similares con esfuerzo mínimo. Marcado para investigación técnica en §18.

### 9.6 Auditoría

Cada agent run registra: skill+versión, modelo/proveedor real usado, artefactos leídos (con versión), propuesta generada, validaciones y resultados, decisión humana, versión resultante, coste. Esto es requisito de MVP aunque el gateway no exista: es la base de la confianza del producto.

---

## 10. CMS Model

### 10.1 La ambigüedad a resolver

"Payload CMS como candidato principal" mezcla dos preguntas distintas:

**A) ¿Payload como backend de la plataforma misma?** **No.** El Artifact Model (estados, versiones, grafo de dependencias, gates, agent runs) es lógica de dominio demasiado específica para modelarse cómodamente como colecciones de un CMS. Forzarlo dentro de Payload produciría un sistema peleado con su herramienta. La plataforma usa Postgres + ORM propio (Drizzle/Prisma) con su propio admin.

**B) ¿Payload como CMS de cada proyecto generado?** **Sí, confirmado.** Es code-first, Next.js-native, open source (MIT), define colecciones en TypeScript (generables desde el Data Model de la spec), incluye auth, media y hooks. Encaja exactamente.

### 10.2 Arquitectura del CMS por proyecto

Cada proyecto generado es una app Next.js con Payload embebido (modo monorepo de Payload 3.x, mismo deployment). La plataforma genera `cms.collections.ts` desde el artefacto `cms.collections` aprobado. El contenido vive en la base de datos del proyecto (Postgres por proyecto o esquema por proyecto — decisión de infraestructura en §16).

División de responsabilidades estricta, confirmando el principio del documento fuente:
- **Payload gestiona contenido**: entradas, campos, media, relaciones.
- **Puck gestiona composición**: qué componentes hay en cada página, en qué orden, con qué variantes, y qué campos CMS se bindean a qué props.
- **El design system gestiona apariencia**: tokens y variantes permitidas.

Los page documents de Puck se persisten como colección dentro del propio Payload del proyecto (patrón soportado y documentado por Puck), lo que da un solo plano de datos por proyecto.

### 10.3 Sincronización spec ↔ CMS

Cuando cambia el artefacto `cms.collections`: la plataforma regenera el schema TypeScript, ejecuta migración en staging del proyecto, y marca bindings afectados como `outdated`. Las migraciones destructivas (borrar campo con contenido) exigen confirmación humana explícita con preview del impacto. Esto debe diseñarse en el handoff técnico — es uno de los puntos de mayor riesgo de pérdida de datos del producto.

---

## 11. Visual Studio Strategy

### 11.1 Resolución de la contradicción Webstudio

El blueprint pide "Visual Studio inspirado/integrado con Webstudio"; la visión de producto ya había concluido Puck. Evaluación de las cinco opciones pedidas:

- **Webstudio como base/fork:** descartado. Webstudio es CSS-first y site-centric: su modelo (estilos visuales libres sobre instancias) contradice el principio de diseño gobernado por component registry. Un fork además carga mantenimiento de un producto entero ajeno. **Riesgo legal adicional: Webstudio es AGPL-3.0; cualquier integración profunda en un SaaS comercial requiere revisión legal — marcado en §18.**
- **Webstudio como integración/módulo externo:** descartado para el core. Integrar un editor con su propia fuente de verdad rompería el Artifact Model (dos verdades sobre las páginas).
- **Webstudio como inspiración/benchmark:** **confirmado.** Su UX de canvas, breakpoints y data bindings es la referencia de calidad a igualar.
- **Puck como núcleo:** **confirmado.** Editor MIT, React-native, basado en componentes propios con contratos de props — es literalmente la arquitectura que el producto necesita. Las páginas que produce son data (JSON de composición), que encaja directo como artefacto `page.*.composition`.
- **GrapesJS:** descartado del core; reconsiderable solo si aparece un caso "freeform HTML/email builder" post-MVP, como módulo aislado.

### 11.2 Qué construir alrededor de Puck

Puck da el canvas y el data model de composición; no da (y hay que construir): versionado de composiciones como artefactos, estados y aprobaciones de página, bindings CMS con validación contra colecciones, panel de agente contextual con propuestas/diff visual, locks de secciones aprobadas, y preview responsive integrado con el flujo de review. **Esto es ~60% del esfuerzo del Visual Studio; Puck es el 40% que no hay que reinventar.** Validar madurez de Puck en escenarios multi-página/multi-tenant es tarea del spike técnico (§18).

### 11.3 Decisión deliberada: sin edición CSS libre — VALIDADA

La validación con agencias (§18.7) confirmó esta línea con un matiz importante: las agencias aceptan el component registry controlado **a condición de que los ajustes visuales puedan resolverse vía agente sobre los componentes** — "si lo puede resolver el agente, está bien; la edición de componentes debe poder resolverlo también, así no movemos CSS directo". Esto convierte el escape hatch en un compromiso de producto con dos niveles:

1. **MVP:** los ajustes viven en variantes, props y tokens, alcanzables manualmente o vía `revise-artifact` y `compose-page-draft` sobre composiciones. Si un componente no tiene la variante necesaria, la extensión del componente es tarea de developer en el registry.
2. **Fase 2 — prioridad #1 (reordenada por la validación):** skill `extend-component-variant` — el agente propone una nueva variante o extensión de props de un componente del registry (código React real, como artefacto con diff, validaciones de tokens y aprobación del Design Engineer). Esto cierra el ciclo que las agencias pidieron: libertad visual sin tocar CSS directo, gobernada por el mismo flujo propose→diff→approve que todo lo demás.

La línea sigue intacta: el canvas nunca edita CSS libre. Lo que cambia es que la ruta de extensión del registry deja de ser solo manual-developer y se vuelve agent-assisted en la primera fase post-MVP.

### 11.4 Traducción de la dirección visual a la UI de la plataforma

La dirección "Editorial Engineering" (Payload-inspired) se traduce a decisiones concretas:

- **Tokens de plataforma:** base monocromática (negro profundo ~`#0B0B0C`, blanco cálido, escala de 8-10 grises neutros), acentos funcionales únicos por semántica (azul eléctrico = acción/foco, verde-lima = aprobado/éxito, ámbar = outdated/warning, rojo-rose = rechazado/error, violeta o cyan **reservado exclusivamente para actividad de agentes** — esto convierte la regla estética del documento fuente en una convención de producto: el usuario aprende que "violeta = lo hizo una IA").
- **Tipografía:** sans técnica (Inter/Geist o similar) para UI; **mono obligatoria** para IDs de artefactos, versiones, diffs, logs y agent runs; labels pequeños con tracking para metadatos.
- **Layout:** navegación lateral por proyecto, vistas densas (tablas y listas con altura de fila contenida), cards discretas con bordes de 1px en lugar de sombras, modales sobrios, soporte de tema claro y oscuro desde el inicio (el oscuro es el "hero theme" estilo Payload).
- **Prohibiciones activas** (lint de diseño, no solo guía): sin gradientes decorativos, sin glassmorphism, sin ilustraciones, sin sombras pesadas, sin morado-AI ambiental.
- **Componentes firma:** el **diff de artefacto** y el **agent run log** deben ser los componentes más cuidados de la UI — son donde el producto demuestra su promesa de control. Merecen tratamiento de "feature de marketing".

Entregable de diseño previo al desarrollo: design system de la plataforma (tokens + ~20 componentes core en Figma o código) construido con estas reglas. La plataforma debe practicar lo que predica: su propia UI gobernada por su propio sistema.

---

## 12. Project Control Strategy

### 12.1 Resolución de la contradicción Plane/ClickUp

El blueprint pide una "Project Control Layer tipo Plane/ClickUp". Evaluación:

- **Integrar Plane (o ClickUp) directamente:** descartado para MVP. Obliga a sincronización bidireccional de estados entre dos fuentes de verdad (sus tareas vs. nuestros artefactos), que es uno de los problemas de integración más frágiles que existen. Además fragmenta la UX justo donde el producto promete unidad.
- **Construir un PM tool propio completo:** descartado siempre. Es un producto entero, con competidores excelentes y gratuitos. Cada hora invertida ahí es una hora robada al diferencial real.
- **Project Control nativo y mínimo, inspirado en Plane:** **confirmado.** El insight correcto del blueprint no es "necesitamos un ClickUp", es "el trabajo debe ser visible y gobernado". Eso ya lo da el Artifact Model casi gratis.

### 12.2 Qué incluye el Project Control del MVP

- **Fases con gates** (ya definidas en §7.2 y §8.5): la columna vertebral del Cockpit.
- **Tareas derivadas automáticamente** del estado del sistema: artefacto en `in_review` → tarea de revisión para su owner; artefacto `outdated` → tarea de re-validación; comentario de cliente abierto → tarea de resolución. Estas tareas no se crean ni se cierran a mano: reflejan estado real, así que nunca mienten.
- **Tareas manuales mínimas:** título, descripción, responsable, estado (open/done), vínculo opcional a artefacto. Nada más.
- **Activity feed** del proyecto: versiones, aprobaciones, agent runs, comentarios, deploys.

### 12.3 Post-MVP

Si las agencias lo piden (lo harán): vistas kanban/tabla de tareas, asignación por carga, integraciones de notificación (Slack), y eventualmente sync *unidireccional* hacia herramientas PM externas (exportar estado, nunca importar verdad). La verdad del trabajo siempre vive en los artefactos.

---

## 13. Human-in-the-loop Workflow

El ciclo canónico, idéntico para trabajo humano y de agente:

```text
1. Trigger          humano edita | humano invoca skill | dependencia marca outdated
2. Propuesta        draft de nueva versión del artefacto (origen: humano o agent run)
3. Validación       validaciones automáticas del tipo de artefacto + de la skill
4. Revisión         diff estructural vs. versión aprobada actual, en contexto
5. Decisión         aprobar | editar-y-aprobar | rechazar con feedback | regenerar
6. Sellado          nueva versión inmutable; dependientes evaluados → outdated
7. Desbloqueo       gates re-evaluados; tareas derivadas actualizadas
```

Garantías no negociables del MVP:

- Ningún agent run escribe una versión aprobada. Jamás.
- Ningún deploy a producción sin checklist confirmado por humano con rol.
- Todo `approved` es atribuible: quién, cuándo, sobre qué versión, con qué diff.
- Regenerar nunca destruye: la versión anterior siempre es recuperable.
- El usuario puede ignorar a la IA por completo y el flujo funciona igual.

Dos flujos de revisión distintos, deliberadamente separados:
- **Revisión interna** (equipo de agencia): sobre artefactos, con diffs, en el Cockpit/Spec OS/Studio.
- **Revisión de cliente**: sobre previews renderizados, con comentarios anclados, sin exposición de artefactos internos. El cliente aprueba resultados, no estructuras.

---

## 14. MVP Scope

Criterio: el MVP debe completar **un proyecto real de agencia de punta a punta** (brief → sitio publicado con aprobación de cliente) con un equipo de 2-4 personas. Todo lo que no sirva a ese recorrido, fuera.

### Dentro del MVP

| Módulo | Alcance MVP |
|---|---|
| Platform core | Workspaces, proyectos, usuarios, 3 roles (admin, member, client), auth, audit log |
| Artifact Model | Completo: tipos, estados, versiones, diffs, dependencias (grafo fijo), aprobaciones, locks por gate |
| Project Cockpit | Fases+gates, lista de artefactos con estados, activity feed, tareas derivadas + manuales mínimas |
| Spec OS | 6 secciones (§7.2), edición manual completa, validaciones por campo |
| Agent Runtime | 5 skills (§9.3), asistente contextual único, capa multi-proveedor con **BYOK por workspace**, agent runs auditados, propose→diff→approve |
| Project Generator | Next.js+Tailwind+Payload+Puck, regeneración parcial idempotente |
| Visual Studio | Puck + registry propio (~25-35 componentes), bindings CMS, responsive preview, estados de página |
| CMS | Payload embebido por proyecto, colecciones generadas, media, migraciones con confirmación |
| Client Review | Preview por URL, comentarios anclados, resolución, aprobación de versión por cliente |
| Deploy | Vercel: preview/staging/production, rollback, checklist de release |

### Fuera del MVP (explícito)

Agent Gateway externo y MCP; agentes-persona múltiples; skills de auditoría (SEO/a11y/visual QA); branding generativo; mobile y otros surfaces; multi-idioma; GrapesJS/modo freeform; integraciones PM externas; self-hosting de la plataforma; marketplace de componentes; deploy a servidor propio; edición CSS libre; real-time multiplayer en el canvas (colaboración por locks y refresh es suficiente en v1 — el multiplayer es un sumidero de complejidad técnica).

### Secuencia de construcción recomendada

1. Platform core + Artifact Model (sin UI bonita, con tests).
2. Spec OS manual + Cockpit básico.
3. Project Generator + proyecto desplegable a mano.
4. Visual Studio + CMS.
5. Client Review + Deploy gobernado.
6. Agent Runtime + las 5 skills (al final: la plataforma ya funciona manual-first, los agentes la aceleran).

Construir los agentes al final es contraintuitivo para un "producto de IA" y es exactamente la secuencia correcta para *este* producto: valida el principio manual-first y evita que el equipo diseñe el sistema alrededor de demos de IA.

---

## 15. Post-MVP Roadmap

**Fase 2 — Confianza y escala del trabajo con IA:** **prioridad #1 (reordenada por la validación §18.7): skill `extend-component-variant`** — extensión agent-assisted del component registry con código React real como artefacto, diff y aprobación del Design Engineer; es la condición expresada por las agencias para sostener el registry sin CSS libre a largo plazo. Después: skills de auditoría (SEO, accesibilidad, visual QA responsive), `prepare-client-review` (resumen de cambios para cliente), agentes-persona como capa de UX, mejoras de diff (visual diff de páginas renderizadas).

**Fase 3 — Apertura:** Agent Gateway externo (REST + evaluación MCP), API keys con scopes, budgets por workspace, webhooks, registry de componentes extensible por agencia, export completo de proyecto ("eject").

**Fase 4 — Superficie y mercado:** branding asistido (de brand inputs a brand system propuesto), multi-idioma, modo freeform acotado (evaluar GrapesJS), integraciones (Slack, Figma import de tokens), deploy a infraestructura propia, self-hosting de plataforma para agencias enterprise.

**Fase 5 — Multicanal:** nuevos surface types sobre el mismo Artifact Model (email, mobile vía React Native/Expo como hipótesis a validar, presentaciones de cliente). Cada surface nuevo debe reusar spec, brand, content system y CMS — si no los reúsa, no pertenece a esta plataforma.

Regla de roadmap: ninguna fase se abre si la anterior no tiene al menos 3 agencias usándola en proyectos reales.

---

## 16. Technical Architecture Recommendations

Para validar y detallar en el handoff técnico; estas son las recomendaciones de partida:

- **Plataforma:** monolito modular Next.js (App Router) + TypeScript estricto. Postgres como base de datos (Drizzle u ORM equivalente). Sin microservicios en MVP — los límites de módulo se expresan en código, no en red.
- **Artifact Model:** tablas `artifacts`, `artifact_versions` (payload JSONB + schema validation con Zod por tipo), `approvals`, `dependencies` (aristas declaradas por tipo), `agent_runs`, `audit_log`. Los diffs se computan estructuralmente (json-diff tipado por schema), no se almacenan.
- **Proyectos generados (resuelto):** un repo Git por proyecto (GitHub vía App), generado desde templates + codegen de artefactos; sin monorepo de proyectos generados. La plataforma escribe vía commits (trazabilidad gratis) y despliega vía Vercel API. Base de datos del proyecto: **Postgres dedicado por proyecto** para Payload/contenido (Neon/Supabase aprovisionado por la plataforma) — aísla datos de cliente, simplifica eject, rollback y entrega profesional. La DB del platform core es compartida y multi-tenant. Validar coste a 50 y 500 proyectos antes del pricing final; si escala mal, introducir tiers (DB dedicada en premium, cluster compartido con schemas separados en low-tier).
- **Generación parcial:** zonas de archivo owned-by-codegen vs. owned-by-human marcadas explícitamente; regeneración solo toca zonas codegen; conflictos se reportan, no se resuelven solos.
- **Agent Runtime:** cola de jobs (pg-boss o equivalente sobre Postgres; sin Redis en MVP), capa de proveedor LLM con interfaz única, prompts versionados en repo, validaciones como funciones puras por tipo de artefacto. **BYOK obligatorio en MVP:** API keys por workspace y por proveedor, cifradas en reposo (KMS o equivalente), nunca expuestas al cliente ni a los proyectos generados, con validación de key al configurar y manejo explícito de errores de cuota/expiración en los agent runs. Proveedores con DPA y política de no-entrenamiento siguen siendo el criterio de la lista soportada; la responsabilidad contractual del dato es del workspace dueño de la key.
- **Auth/roles (resuelto):** auth comprado — **Clerk para MVP, encapsulado detrás de un adapter interno** (login, organizaciones/workspaces, invitaciones, sesiones). WorkOS queda como ruta futura si enterprise SSO se vuelve requisito comercial. Roles por workspace + override por proyecto; el rol `client` solo accede al Review surface.
- **Component registry (resuelto):** primitives propias estilo Radix/shadcn + Tailwind tokens; sin dependencia de librería visual cerrada. Registry inicial de 25-35 componentes.
- **Design system (resuelto):** code-first; la fuente de verdad son tokens en código y artefactos estructurados. Figma solo como referencia o export/import futuro.
- **Preview de cliente:** los previews son deployments reales de Vercel con protección por token — no un render paralelo. Una sola pipeline de render para preview y producción.
- **Telemetría desde el día uno:** eventos de producto (aprobaciones, regeneraciones, rechazos de propuestas de IA) — la tasa de aceptación de propuestas de agentes es la métrica de salud del producto.

---

## 17. Key Risks & Open Questions

**R1 — Scope creep estructural (riesgo #1).** El producto toca cinco categorías (spec tools, page builders, CMS, PM, agent platforms) y cada una invita a expandirse. Mitigación: el criterio de §14 ("un proyecto real de punta a punta") como única vara; este documento como contrato de alcance.

**R2 — Madurez de Puck en uso intensivo.** Multi-página, composiciones grandes, undo/redo, performance del canvas, extensibilidad del panel. Mitigación: spike técnico de 1-2 semanas antes de comprometer (§18). Plan B: editor de composición propio sobre el mismo data model (más caro, mismo artefacto).

**R3 — Complejidad de infraestructura por proyecto.** Repo + DB + deployments por proyecto multiplica superficie operativa. Mitigación: automatizar aprovisionamiento desde el día uno; límites de proyectos por plan; medir coste por proyecto activo.

**R4 — Migraciones CMS destructivas.** Cambios de schema con contenido real pueden perder datos de cliente. Mitigación: diseño explícito del flujo de migración con preview de impacto y confirmación (señalado en §10.3); backups automáticos pre-migración.

**R5 — Calidad de las propuestas de IA.** Si las skills proponen mediocridad, el ciclo propose→review se siente como burocracia sobre ruido. Mitigación: pocas skills muy pulidas (5, no 20); telemetría de tasa de aceptación; manual-first garantiza que el producto vale incluso con IA débil.

**R6 — Tormenta de `outdated`.** Cambios upstream frecuentes pueden inundar de re-validaciones. Mitigación: granularidad de dependencias por sección (no por documento completo) donde duela; agrupación de tareas derivadas; "revalidar sin cambios" en un clic.

**R7 — Licencias.** Payload (MIT) y Puck (MIT) son seguros. Webstudio (AGPL) solo como benchmark — **cualquier tentación futura de integración requiere revisión legal**. daisyUI/React Bits: revisar licencias si se adoptan componentes. **Requiere validación legal antes de cualquier integración profunda de terceros.**

**R8 — Adopción del rol cliente. SEVERIDAD REDUCIDA tras validación §18.7:** las agencias expresaron demanda directa del review link. Riesgo residual: que el entusiasmo de la agencia no se traduzca en hábito del cliente final. Mitigación se mantiene: Review sin fricción absoluta (link, sin cuenta pesada); la agencia puede transcribir feedback externo como comentarios. Medir uso real de clientes en pilotos.

**Preguntas abiertas:** pricing (por workspace, por proyecto activo, por seats — sin definir y afecta arquitectura de límites; depende además de la validación de coste de infraestructura por proyecto); ¿el generador soporta proyectos brownfield (sitios existentes) o solo greenfield en v1? (recomendación: solo greenfield). **Resuelta:** naming — Agency Workstation queda como codename interno de desarrollo; el nombre comercial se decide antes de marketing/lanzamiento (shortlist, dominios, handles, búsqueda de marca, revisión de trademark), no antes de los spikes técnicos.

---

## 18. Decisions to Validate Before Coding — RESUELTAS

Estado: las siete decisiones bloqueantes están resueltas. Dos de ellas (spikes) y una (validación con agencias) son ahora **acciones pendientes de ejecución** con criterios de salida definidos; el resto son decisiones cerradas.

### 18.1 Puck — decidido, sujeto a spike

**Puck es la hipótesis aprobada para el Visual Studio del MVP, no una decisión definitiva de largo plazo.** Spike timeboxed de 1-2 semanas que debe demostrar: composición multi-página, persistencia de page JSON, bindings dinámicos con Payload, registry de 25-35 componentes, preview responsive, extensiones laterales para diff/aprobaciones, y rendimiento con 8 páginas y 30+ secciones. **Criterio de salida:** componer un sitio de 8 páginas con bindings CMS sin hacks estructurales ni edición libre de HTML/CSS. **Plan si falla:** (1) evaluar Webstudio solo como visual layer aislada o benchmark técnico, (2) evaluar capa visual propia sobre component registry + style controls, (3) reconsiderar el alcance de libertad visual del MVP.

### 18.2 Generación y regeneración parcial — decidido, sujeto a spike

**Entra al MVP, limitada a zonas codegen, con conflicto explícito. Nunca autorepara ni sobrescribe trabajo humano.** Ownership explícito (owned-by-codegen vs. owned-by-human), regeneración idempotente, versiones anteriores siempre recuperables. Puede actualizar: colecciones Payload, tipos, sample data, bindings declarativos y archivos generados. No puede tocar composiciones visuales aprobadas ni cambios humanos sin diff y aprobación. **Criterio de salida del spike:** generar proyecto con colecciones desde la spec → usuario modifica páginas compuestas → se regenera el CMS schema → las páginas compuestas no se sobrescriben → si un campo eliminado está usado por un binding, el sistema marca conflicto.

### 18.3 Infraestructura por proyecto — decidido

**Repo Git por proyecto (sin monorepo de proyectos generados) + DB Postgres dedicada por proyecto para Payload/contenido + DB compartida multi-tenant para el platform core.** Justificación: aislamiento de clientes, trazabilidad, eject real, deploy independiente, rollback, seguridad y entrega profesional. **Condición:** modelar coste a 50 y 500 proyectos antes de producción comercial; si escala mal, tiers (DB dedicada en premium, cluster compartido con schemas separados en low-tier).

### 18.4 Licencias y datos — decidido (política conservadora)

**MVP legalmente limpio: Puck (MIT confirmado en la versión elegida) + Payload (MIT confirmado en la versión elegida) + cero código de Webstudio.** Política AGPL por escrito: ningún fork, modificación, self-hosting modificado o integración profunda de código AGPL en el core propietario sin aprobación legal. Webstudio se mantiene exclusivamente como benchmark de UX/producto e investigación separada. Política LLM: antes de usar datos reales de cliente — revisar DPA, política de entrenamiento, retención, disponibilidad de zero-retention/enterprise privacy; proveedor configurable por workspace.

### 18.5 Naming — decidido

**Agency Workstation es codename interno de desarrollo.** El nombre comercial se resuelve antes de marketing, ventas o lanzamiento público (shortlist de 10-20, dominios, handles, búsqueda de marcas, revisión de trademark en mercados objetivo) — no bloquea spikes ni desarrollo.

### 18.6 Auth — decidido

**Comprar, no construir. Clerk para MVP, detrás de un adapter interno de auth.** Clerk cubre login, organizaciones/workspaces, invitaciones, roles básicos, sesiones y los flujos client/member/admin. El adapter evita acoplamiento y deja abierta la migración a WorkOS si enterprise SSO se vuelve requisito comercial. Regla: cero trimestres invertidos en infraestructura de identidad.

### 18.7 Validación con agencias — GATE SUPERADO

Resultados de las entrevistas (consenso entre las agencias consultadas):

1. **Component registry sin CSS libre: aceptado.** Condición expresada: los ajustes visuales deben poder resolverse vía agente y vía edición de componentes en el registry, sin tocar CSS directo. → Incorporado en §11.3: `extend-component-variant` pasa a prioridad #1 de Fase 2.
2. **Libertad visual:** suficiente si el agente y la extensión de componentes la cubren. Confirma la línea de producto.
3. **Client review con comentarios anclados:** demanda entusiasta ("por favor"). El riesgo R8 baja de severidad.
4. **Dolor principal:** brief, alineación de contenido con el producto final, e iteraciones de diseño. Confirma que Spec OS + Content System + ciclo propose→diff→approve son el núcleo de valor — no el deploy ni el PM, lo que respalda las decisiones de alcance de §12 y §14.
5. **Disposición a pagar por el flujo conectado:** afirmativa sin reservas.
6. **Usuario principal: Design Engineer.** → Persona núcleo actualizada en §3; refuerza la dirección visual técnica de §11.4.
7. **Integración imprescindible: sus licencias de LLM.** → **BYOK elevado a requisito de MVP** (§7.9, §14, §16). Ninguna otra integración resultó bloqueante, lo que valida posponer PM externos, Figma y demás a fases posteriores.

**Veredicto: el MVP se construye según §14 sin replanteamiento del Visual Studio.** Los criterios de continuación (3/5 registry, 3/5 review, 2/5 intención de pago) se superan en todos los puntos.

### 18.8 Decisiones tempranas no bloqueantes — también resueltas

- **MCP/Gateway:** no en MVP; la Project Context API se diseña como si fuera pública y compatible con un gateway futuro.
- **Librería base de componentes:** primitives propias estilo Radix/shadcn + Tailwind tokens; registry inicial de 25-35 componentes; sin librería visual cerrada.
- **Design system:** code-first; tokens en código como fuente de verdad; Figma solo como referencia o export/import futuro.

### 18.9 Resumen ejecutivo

| Decisión | Resolución |
|---|---|
| Puck | Hipótesis MVP aprobada, sujeta a spike (1-2 sem) |
| Regeneración parcial | Sí; solo zonas codegen; conflicto explícito; nunca sobrescribe trabajo humano |
| Infra por proyecto | Repo por proyecto + DB Payload por proyecto + core DB compartida; validar coste a 50/500 |
| Licencias | Puck/Payload MIT; cero código Webstudio; política AGPL y LLM por escrito |
| Naming | Agency Workstation = codename; marca comercial antes de lanzamiento |
| Auth | Comprado: Clerk tras adapter interno; WorkOS como ruta enterprise futura |
| Validación agencias | **Gate superado**: registry aceptado (con ruta agent-assisted), review demandado, pago confirmado, usuario = Design Engineer, BYOK obligatorio |

**Cierre de la sección:** el MVP usará Puck como hipótesis visual controlada, Payload como CMS embebido por proyecto, Clerk como auth comprado, BYOK de LLMs por workspace y arquitectura de repo/DB por proyecto para outputs de cliente. Webstudio queda fuera del código del MVP por riesgo AGPL y se mantiene como benchmark. La regeneración parcial será idempotente y limitada a zonas codegen, con conflictos visibles y sin sobrescribir trabajo humano. Agency Workstation queda como codename hasta validación de marca. **La validación con agencias está superada: el único bloqueante restante para el build completo son los dos spikes técnicos (§18.1, §18.2).**

---

## 19. Code-Specialist Handoff Brief

Instrucciones para el modelo/equipo especializado en código que tomará este documento:

**Misión:** diseñar la arquitectura técnica detallada y construir el MVP definido en §14, en la secuencia de §14, respetando las garantías de §13 y las resoluciones de §18.

**Gate previo al build completo:** la validación con agencias (§18.7) está superada. Los dos spikes (§18.1, §18.2) son el único bloqueante restante y se ejecutan de inmediato y en paralelo; los entregables 1-3 y 5 de abajo pueden arrancar hoy mismo.

**Empezar por (en orden):**
1. Esquema de base de datos del platform core + Artifact Model (§8, §16). Entregable: schema SQL/ORM + diagrama ER + decisiones de indexado para el grafo de dependencias.
2. Definición de los JSON Schemas (Zod) de los tipos de artefacto del MVP: `spec.intake`, `spec.strategy`, `spec.sitemap`, `content.page`, `cms.collections`, `design.tokens`, `page.composition`, `release`. Cada uno con sus validaciones y sus aristas de dependencia declaradas.
3. API interna (Project Context API, §9.4): contratos de recursos de proyecto, artefactos, versiones, aprobaciones, agent runs. Diseñarla como si fuera a ser pública.
4. Los dos spikes de §18 (Puck y regeneración) como repos de prueba desechables con informe de conclusiones.
5. Scaffold del monolito Next.js con límites de módulo explícitos (platform-core, artifacts, spec-os, generator, studio, review, deploy, agents).
6. Primeras pantallas, en este orden de prioridad: (a) Project Cockpit, (b) editor de artefacto de Spec OS con diff e historial, (c) vista de agent run con propuesta→diff→aprobar. Estas tres pantallas demuestran el producto; el resto es ejecución.

**Restricciones no negociables:**
- TypeScript estricto; payloads de artefactos validados por schema en cada escritura.
- Ninguna ruta de código permite a un agent run transicionar un artefacto a `approved`.
- Versiones inmutables; soft-delete universal; audit log en toda mutación.
- Los proyectos generados no dependen de ningún paquete propietario de la plataforma en runtime (exportabilidad real).
- Auth vía Clerk siempre detrás del adapter interno: ningún módulo de producto importa Clerk directamente.
- BYOK: las API keys LLM del workspace se cifran en reposo, nunca se loggean, nunca llegan al cliente ni a los proyectos generados, y todo agent run registra qué proveedor/key (por referencia, no por valor) usó.
- Cero código de Webstudio o de cualquier dependencia AGPL en el repositorio.
- La regeneración respeta el ownership codegen/human de §18.2: detecta conflictos, jamás los resuelve sola.
- UI de la plataforma construida sobre los tokens de §11.4 desde el primer commit (configurar lint de diseño: sin colores fuera de tokens).

**Criterio de aceptación del MVP completo:** un usuario admin crea un proyecto, completa la spec (manual o con skills), genera el proyecto, compone 5 páginas, un usuario client comenta y aprueba, se publica a producción en Vercel, y cada paso es auditable y reversible. Demo de este recorrido sin tocar la base de datos a mano = MVP terminado.

**Lo que el code-specialist NO debe hacer:** añadir features fuera de §14 sin volver a este documento; introducir microservicios, Redis, colas externas o real-time multiplayer en MVP; diseñar el gateway externo más allá de mantener limpia la API interna.

---

## 20. Final Product Narrative

Una agencia gana un proyecto. Hoy, eso significa abrir siete herramientas y un canal de Slack donde la verdad se disolverá en tres semanas.

Con Agency Workstation, el lead abre un proyecto y completa el intake en veinte minutos. Invoca al asistente: en una hora tiene borradores de estrategia, sitemap y modelo de contenido — cada uno como artefacto estructurado, con diff, esperando su revisión. Edita lo que la IA entendió mal (porque algo entenderá mal), aprueba sección por sección, y el gate de la fase se cierra con su nombre en el registro.

Genera el proyecto. No es una maqueta: es un Next.js real con Payload configurado y treinta componentes de su design system listos en el canvas. La diseñadora compone las páginas en el Visual Studio; cuando intenta forzar un spacing fuera de tokens, el sistema no se lo permite — y esa restricción es la razón por la que el sitio se verá igual de bien en la página doce que en la home. El copy se escribe con ayuda de una skill que leyó la voz de marca aprobada, y cada propuesta llega como diff, no como sorpresa.

El cliente recibe un link. Comenta sobre la sección exacta que le incomoda. Tres comentarios se resuelven, una versión se aprueba con su nombre, y esa aprobación queda donde las aprobaciones deben quedar: en el sistema, no en un email. Deploy a producción con checklist. Si algo sale mal, rollback en un clic.

Seis meses después, el cliente pide "refrescar el tono". El lead cambia un artefacto de marca, y la plataforma le muestra exactamente qué páginas, copies y componentes quedaron desactualizados. Nada se regenera solo. Todo se puede regenerar en un clic. La diferencia entre esas dos frases es el producto entero.

Esto no es una demo de IA. Es infraestructura de producción donde la IA trabaja como trabaja un buen junior: propone mucho, decide nada, y deja todo documentado.

---

*Fin del documento (v1.2). Decisiones de §18 resueltas y validación con agencias superada. Próximo y único paso antes del build completo: ejecutar los spikes §18.1 y §18.2 en paralelo; los entregables 1-3 y 5 del handoff de §19 pueden arrancar de inmediato.*
