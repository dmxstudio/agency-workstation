import { createPage } from "@/lib/actions";
import { hasEditAccess } from "@/lib/edit-auth";
import { listPages } from "@/lib/pages";
import { EditAccessForm } from "@/components/edit-access-form";

export const dynamic = "force-dynamic";

/**
 * Standalone editor index: lists pages and creates new ones. Protected by the
 * same EDIT_TOKEN gate as the editor itself.
 */
export default async function EditIndexPage() {
  if (!(await hasEditAccess())) {
    return <EditAccessForm to="/edit" />;
  }

  const pages = await listPages();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 font-sans">
      <header className="border-b border-neutral-200 pb-6">
        <h1 className="text-2xl font-bold tracking-tight">Páginas</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {pages.length} páginas · editor visual con secciones gobernadas
        </p>
      </header>

      <section className="mt-8">
        {pages.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-500">
            No hay páginas. Ejecuta <code className="font-mono">npm run seed</code> o crea
            una abajo.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {pages.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.title}</p>
                  <p className="font-mono text-xs text-neutral-500">
                    /{p.path}
                    {!p.publishedData ? " · sin publicar" : ""}
                  </p>
                </div>
                <a
                  href={`/edit/${p.path}`}
                  className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700"
                >
                  Editar
                </a>
                <a
                  href={`/${p.path}`}
                  className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-50"
                >
                  Ver
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Crear página
        </h2>
        <form action={createPage} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
            Título
            <input
              name="title"
              required
              placeholder="Página de servicios"
              className="w-64 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
            Ruta (opcional, admite anidado: legal/aviso)
            <input
              name="path"
              placeholder="servicios"
              className="w-64 rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
          >
            Crear y abrir editor
          </button>
        </form>
      </section>
    </main>
  );
}
