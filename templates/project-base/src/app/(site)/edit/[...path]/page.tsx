import { notFound, redirect } from "next/navigation";
import type { Data } from "@puckeditor/core";
import { EditorClient } from "@/components/editor-client";
import { EditAccessForm } from "@/components/edit-access-form";
import { hasEditAccess, isValidEditToken, requiredEditToken } from "@/lib/edit-auth";
import { getPageByPath } from "@/lib/pages";

export const dynamic = "force-dynamic";

/** Puck editor per URL (catch-all, supports nested paths). EDIT_TOKEN gated. */
export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { path } = await params;
  const pagePath = path.map(decodeURIComponent).join("/");

  if (!(await hasEditAccess())) {
    const { token } = await searchParams;
    if (requiredEditToken() && isValidEditToken(token)) {
      // Valid token in the URL → persist it as cookie and drop it from the URL.
      redirect(
        `/api/edit-session?token=${encodeURIComponent(token ?? "")}&to=${encodeURIComponent(
          `/edit/${pagePath}`
        )}`
      );
    }
    return <EditAccessForm to={`/edit/${pagePath}`} />;
  }

  const page = await getPageByPath(pagePath);
  if (!page) notFound();

  return (
    <EditorClient
      page={{
        id: page.id,
        title: page.title,
        path: page.path,
        puckData: (page.puckData as Data) ?? null,
        publishedData: (page.publishedData as Data) ?? null,
      }}
    />
  );
}
