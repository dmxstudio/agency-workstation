import type { NextRequest } from "next/server";
import { getPayloadClient } from "@/lib/payload-client";

export const dynamic = "force-dynamic";

/** Feeds the Puck "external" field modal with testimonials from Payload. */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query")?.trim() ?? "";
  const payload = await getPayloadClient();
  const result = await payload.find({
    collection: "testimonials",
    limit: 20,
    sort: "author",
    ...(query
      ? {
          where: {
            or: [
              { author: { like: query } },
              { company: { like: query } },
              { quote: { like: query } },
            ],
          },
        }
      : {}),
  });
  return Response.json(result.docs);
}
