import type { NextRequest } from "next/server";
import { getPayloadClient } from "@/lib/payload-client";

export const dynamic = "force-dynamic";

/** Feeds the Puck "external" field modal with posts from Payload. */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query")?.trim() ?? "";
  const payload = await getPayloadClient();
  const result = await payload.find({
    collection: "posts",
    limit: 20,
    sort: "-publishedAt",
    ...(query
      ? {
          where: {
            or: [{ title: { like: query } }, { excerpt: { like: query } }],
          },
        }
      : {}),
  });
  return Response.json(result.docs);
}
