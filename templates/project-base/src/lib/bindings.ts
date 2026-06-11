import type { Data } from "@puckeditor/core";
import type { CollectionSlug } from "payload";
import { getPayloadClient } from "./payload-client";

/**
 * Server-side re-resolution of CMS bindings at render time.
 *
 * External-field values store { collection, docId, ...snapshot }. Before a
 * published page renders we re-fetch every referenced doc through the Payload
 * Local API and merge fresh content over the stored snapshot. Editing a doc
 * in the CMS therefore changes the rendered page WITHOUT touching the page
 * composition — the binding is live, not a copy.
 */

type ExternalRef = {
  collection: string;
  docId: string | number;
  [key: string]: unknown;
};

const isExternalRef = (v: unknown): v is ExternalRef =>
  typeof v === "object" &&
  v !== null &&
  "docId" in v &&
  "collection" in v &&
  typeof (v as ExternalRef).collection === "string";

type PayloadClient = Awaited<ReturnType<typeof getPayloadClient>>;

async function resolveValue(
  value: unknown,
  payload: PayloadClient,
  knownCollections: Set<string>
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => resolveValue(v, payload, knownCollections)));
  }
  if (typeof value !== "object" || value === null) return value;

  if (isExternalRef(value) && knownCollections.has(value.collection)) {
    try {
      const doc = await payload.findByID({
        collection: value.collection as CollectionSlug,
        id: value.docId,
      });
      const { id: _id, updatedAt: _u, createdAt: _c, ...fresh } = doc as unknown as Record<
        string,
        unknown
      >;
      return { ...value, ...fresh };
    } catch {
      // doc deleted in CMS → keep snapshot, flag it (the platform surfaces
      // this as an outdated/broken-binding marker)
      return { ...value, _broken: true };
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = await resolveValue(v, payload, knownCollections);
  }
  return out;
}

export async function resolveExternalBindings(data: Data): Promise<Data> {
  const payload = await getPayloadClient();
  const knownCollections = new Set(payload.config.collections.map((c) => c.slug));
  return (await resolveValue(data, payload, knownCollections)) as Data;
}
