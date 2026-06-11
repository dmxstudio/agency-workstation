import { notFound } from "next/navigation";
import type { Data } from "@puckeditor/core";
import { EditorClient } from "@/components/editor-client";
import { getPayloadClient, type PageRecord } from "@/lib/payload-client";

export const dynamic = "force-dynamic";

/** §18.1 punto 1 — editor Puck por URL (catch-all, admite rutas anidadas). */
export default async function EditPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const pagePath = path.map(decodeURIComponent).join("/");

  const payload = await getPayloadClient();
  const result = await payload.find({
    collection: "pages",
    where: { path: { equals: pagePath } },
    limit: 1,
  });
  const page = result.docs[0] as unknown as PageRecord | undefined;
  if (!page) notFound();

  return (
    <EditorClient
      page={{
        id: page.id,
        title: page.title,
        path: page.path,
        puckData: (page.puckData as Data) ?? null,
        publishedData: (page.publishedData as Data) ?? null,
        approvalStatus: page.approvalStatus,
      }}
    />
  );
}
