import { getPayloadClient, type PageRecord } from "./payload-client";

/** Looks up a page document by its URL path ("home", "legal/terms", …). */
export async function getPageByPath(pagePath: string): Promise<PageRecord | null> {
  const payload = await getPayloadClient();
  const result = await payload.find({
    collection: "pages",
    where: { path: { equals: pagePath } },
    limit: 1,
  });
  return (result.docs[0] as unknown as PageRecord) ?? null;
}

export async function listPages(): Promise<PageRecord[]> {
  const payload = await getPayloadClient();
  const result = await payload.find({ collection: "pages", limit: 200, sort: "path" });
  return result.docs as unknown as PageRecord[];
}
