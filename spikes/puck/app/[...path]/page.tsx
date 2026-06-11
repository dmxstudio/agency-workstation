import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Data } from "@puckeditor/core";
import { Render } from "@puckeditor/core/rsc";
import { puckConfig } from "@/lib/puck/config";
import { resolveExternalBindings } from "@/lib/bindings";
import { getPayloadClient, type PageRecord } from "@/lib/payload-client";

export const dynamic = "force-dynamic";

/**
 * Published page render (catch-all). Server Component: uses the RSC build of
 * Puck's <Render> and re-resolves CMS bindings against Payload per request.
 */

async function getPage(pathSegments: string[]): Promise<PageRecord | null> {
  const pagePath = pathSegments.map(decodeURIComponent).join("/");
  const payload = await getPayloadClient();
  const result = await payload.find({
    collection: "pages",
    where: { path: { equals: pagePath } },
    limit: 1,
  });
  return (result.docs[0] as unknown as PageRecord) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string[] }>;
}): Promise<Metadata> {
  const { path } = await params;
  const page = await getPage(path);
  const root = (page?.publishedData ?? page?.puckData) as Data | null;
  const rootProps = (root?.root?.props ?? {}) as { title?: string; description?: string };
  return {
    title: rootProps.title || page?.title || "Página",
    description: rootProps.description || undefined,
  };
}

export default async function PublishedPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const page = await getPage(path);
  if (!page) notFound();

  const data = (page.publishedData ?? page.puckData) as Data | null;
  if (!data) notFound();

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
