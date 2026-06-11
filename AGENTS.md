<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Guía para agentes de código

**Lee `CLAUDE.md` antes de tocar nada** — es la guía completa y canónica para
agentes en este repo (cualquier agente, no solo Claude): comandos, mapa de
módulos con límites explícitos, restricciones no negociables (§19 de la spec)
y convenciones. La spec de producto vive en `docs/product-spec-v1.2.md` y es
la fuente de verdad de alcance; el roadmap en `docs/ROADMAP.md`.

Gotchas que muerden rápido:

- **PGlite es mono-proceso** y está protegido por lockfile (`src/db/pglite-lock.ts`):
  con `next dev` corriendo, cualquier script que toque la DB falla con un error
  claro. Para el dev server antes de correr seeds/e2e/smokes.
- Los e2e `e2e-generator.ts` y `e2e-studio.ts` **re-crean el repo demo** y
  destruyen los tags `release-N`. Demo limpia: `rm -rf .data && npm run db:migrate && npm run db:seed`.
- Verifica con los smokes (`scripts/smoke-*.ts`) — son aislados y se limpian solos.
- UI solo con tokens del design system; el violeta es EXCLUSIVO de actividad de
  agentes; ninguna ruta de código permite a un agent run aprobar artefactos.
