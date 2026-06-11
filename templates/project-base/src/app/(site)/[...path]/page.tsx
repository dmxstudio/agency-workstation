import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPageByPath } from "@/lib/pages";
import { pageData, pageMetadata, PublishedPage } from "@/components/published-page";

export const dynamic = "force-dynamic";

/** Published page render (catch-all). Supports nested paths ("legal/terms"). */

const joinPath = (segments: string[]) => segments.map(decodeURIComponent).join("/");

export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string[] }>;
}): Promise<Metadata> {
  const { path } = await params;
  const page = await getPageByPath(joinPath(path));
  return pageMetadata(page);
}

export default async function CatchAllPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const page = await getPageByPath(joinPath(path));
  if (!page || !pageData(page)) notFound();

  return <PublishedPage page={page} />;
}
