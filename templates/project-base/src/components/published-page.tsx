import type { Metadata } from "next";
import type { Data } from "@puckeditor/core";
import { Render } from "@puckeditor/core/rsc";
import { puckConfig } from "@/puck/config";
import { resolveExternalBindings } from "@/lib/bindings";
import type { PageRecord } from "@/lib/payload-client";

/**
 * Shared published-page renderer (RSC). Renders the last published snapshot
 * (or the draft, behind a notice, when the page was never published) and
 * re-resolves CMS bindings against Payload on every request.
 */

export function pageData(page: PageRecord | null): Data | null {
  if (!page) return null;
  return (page.publishedData ?? page.puckData) as Data | null;
}

export function pageMetadata(page: PageRecord | null): Metadata {
  const data = pageData(page);
  const rootProps = (data?.root?.props ?? {}) as { title?: string; description?: string };
  return {
    title: rootProps.title || page?.title || undefined,
    description: rootProps.description || undefined,
  };
}

export async function PublishedPage({ page }: { page: PageRecord }) {
  const data = pageData(page);
  if (!data) return null;

  const resolved = await resolveExternalBindings(data);

  return (
    <>
      {!page.publishedData ? (
        <div className="bg-amber-100 px-6 py-2 text-center text-xs font-medium text-amber-800">
          Vista previa del borrador — esta página aún no se ha publicado
        </div>
      ) : null}
      <Render config={puckConfig} data={resolved} />
    </>
  );
}
