# Roadmap — Agency Workstation

> El MVP (§14 de `product-spec-v1.2.md`) está completo y verificado de punta a punta
> en local. Este roadmap ordena lo que sigue, combinando las fases post-MVP de la
> spec (§15) con la deuda honesta documentada durante el build local. Regla de la
> spec que seguimos respetando: **ninguna fase se abre si la anterior no tiene al
> menos 3 agencias usándola en proyectos reales** (§15), y todo cambio vuelve al
> criterio de §14 ("un proyecto real de punta a punta").

## Fase A — De local a producción (infra tras los adapters ya construidos)

El MVP corre 100 % en local por diseño. Cada pieza cloud llega **detrás de una
interfaz que ya existe** — no hay reescrituras, solo segundos proveedores:

| Pieza | Hoy (local) | Producción | Interfaz ya construida |
|---|---|---|---|
| Auth | Provider local (scrypt + sesiones) | **Clerk** (§18.6) | `platform-core/auth/adapter.ts` |
| DB plataforma | PGlite embebido | **Postgres** (Neon/Supabase) | `getDb()` ya soporta `DATABASE_URL` |
| Deploy | Slots locales :4100/:4200 | **Vercel** (§7.8): previews por release, Instant Rollback | `deploy/provider.ts` (DeployProvider) |
| Repos generados | Git local en `.data/projects/` | **GitHub App** (§16): repo por proyecto | capa git del generator |
| DB por proyecto | SQLite (Payload) | **Postgres dedicado por proyecto** (§18.3) | adapter de DB de Payload |
| Cola de agentes | Runner async in-process | **pg-boss** sobre Postgres (§16) | `AgentRunQueue` |

Además: telemetría de producto desde el día uno (§16 — la tasa de aceptación de
propuestas de agentes es la métrica de salud), y modelar coste de infra a 50/500
proyectos antes de pricing (§18.3).

## Fase B — Confianza y escala del trabajo con IA (Fase 2 de la spec, §15)

1. **`extend-component-variant`** — prioridad #1 reordenada por la validación con
   agencias (§18.7): el agente propone variantes/extensiones de componentes del
   registry como código React real, con diff y aprobación del Design Engineer.
   Es la condición que las agencias pusieron para aceptar el registry sin CSS libre.
2. Skills de auditoría: SEO, accesibilidad, visual QA responsive.
3. `prepare-client-review` (resumen de cambios para el cliente).
4. Mejoras de diff: visual diff de páginas renderizadas.
5. Modelo por workspace (default de gobernanza encima del selector por invocación).

## Fase C — Deuda honesta del MVP (endurecimiento)

Documentada durante el build; ninguna bloquea el uso actual:

- **Upgrade de template**: los repos generados no reciben cambios de archivos
  estáticos del template (§18.2 los considera territorio humano tras la copia
  inicial). Diseñar una historia de upgrade explícita (PR generado, nunca silencioso).
- **Migraciones destructivas de datos** (§10.3 / R4): preview de impacto sobre filas
  reales + confirmación + backup pre-migración. Hoy solo se detecta el impacto en
  bindings de páginas.
- Recuperación de runs huérfanos (`queued`/`running` si el proceso muere) al
  introducir la cola real; saneo de deployments en `building`.
- Tarifas de OpenAI en `model-catalog` (hoy coste estimado $0) y acción
  «descartar borrador» (decisión de producto pendiente, §8.2).
- Re-evaluar el lock de PGlite cuando llegue Postgres (deja de ser necesario).

## Fase D — Apertura (Fase 3 de la spec, §15)

Agent Gateway externo (REST + evaluación **MCP**) sobre la Project Context API
(§9.4, ya diseñada como si fuera pública), API keys con scopes por proyecto y
skill, budgets por workspace, webhooks, registry de componentes extensible por
agencia y export completo del proyecto ("eject").

## Fases E — Superficie y multicanal (Fases 4-5 de la spec, §15)

Branding asistido, multi-idioma, modo freeform acotado, integraciones (Slack,
Figma tokens), self-hosting de plataforma, y nuevos surfaces (email, mobile)
sobre el mismo Artifact Model — solo si reúsan spec, brand, content y CMS.
