import { createPage } from "@/lib/actions";
import { getPayloadClient, type PageRecord } from "@/lib/payload-client";
import { REGISTRY_SIZE } from "@/lib/puck/config";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-600 border-neutral-300",
  in_review: "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-green-100 text-green-800 border-green-300",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "borrador",
  in_review: "en revisión",
  approved: "aprobado",
};

function countSections(data: unknown): number {
  let n = 0;
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item && typeof item === "object" && "type" in item) {
        n++;
        const props = (item as { props?: Record<string, unknown> }).props ?? {};
        for (const v of Object.values(props)) walk(v);
      }
    }
  };
  walk((data as { content?: unknown[] } | null)?.content);
  return n;
}

export default async function HomePage() {
  const payload = await getPayloadClient();
  const result = await payload.find({ collection: "pages", limit: 100, sort: "path" });
  const pages = result.docs as unknown as PageRecord[];

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12 font-sans">
      <header className="border-b border-neutral-200 pb-6">
        <h1 className="text-2xl font-bold tracking-tight">Spike §18.1 — Puck Visual Studio</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {pages.length} páginas · registry de {REGISTRY_SIZE} secciones · persistencia en
          Payload 3 (SQLite embebido)
        </p>
      </header>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Páginas
        </h2>
        {pages.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-500">
            No hay páginas. Ejecuta <code className="font-mono">npm run seed</code> o crea una
            abajo.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {pages.map((p) => {
              const sections = countSections(p.puckData);
              const bytes = new Blob([JSON.stringify(p.puckData ?? {})]).size;
              return (
                <li key={p.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.title}</p>
                    <p className="font-mono text-xs text-neutral-500">
                      /{p.path} · {sections} secciones · {(bytes / 1024).toFixed(1)} kB
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[p.approvalStatus] ?? STATUS_BADGE.draft
                    }`}
                  >
                    {STATUS_LABEL[p.approvalStatus] ?? p.approvalStatus}
                  </span>
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
              );
            })}
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
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Crear y abrir editor
          </button>
        </form>
      </section>
    </main>
  );
}
