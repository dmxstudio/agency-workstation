import type { NextRequest } from "next/server";
import type { CollectionSlug } from "payload";
import { getPayloadClient } from "@/lib/payload-client";

export const dynamic = "force-dynamic";

/**
 * Feeds the Puck "external" field modal with documents from any generated
 * CMS collection (GET /api/external/<collection>?query=…). The collection
 * must exist in the Payload config and not be a reserved template collection.
 * Search runs over the collection's text/textarea/email fields.
 */

const RESERVED = new Set(["users", "pages"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ collection: string }> }
) {
  const { collection } = await params;
  const payload = await getPayloadClient();

  const collectionConfig = payload.config.collections.find((c) => c.slug === collection);
  if (!collectionConfig || RESERVED.has(collection)) {
    return Response.json({ error: "Colección no disponible" }, { status: 404 });
  }

  const query = req.nextUrl.searchParams.get("query")?.trim() ?? "";
  const searchableFields = collectionConfig.fields.flatMap((field) =>
    "name" in field &&
    "type" in field &&
    (field.type === "text" || field.type === "textarea" || field.type === "email")
      ? [field.name]
      : []
  );

  const result = await payload.find({
    collection: collection as CollectionSlug,
    limit: 20,
    sort: "-updatedAt",
    ...(query && searchableFields.length > 0
      ? {
          where: {
            or: searchableFields.map((name) => ({ [name]: { like: query } })),
          },
        }
      : {}),
  });
  return Response.json(result.docs);
}
