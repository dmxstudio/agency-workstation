import type { Data } from "@puckeditor/core";
import { getPayloadClient } from "./payload-client";

/**
 * Server-side re-resolution of CMS bindings at render time.
 *
 * External-field values store { collection, docId, ...snapshot }. Before the
 * published page renders we re-fetch every referenced doc through the Payload
 * Local API and merge fresh content over the stored snapshot. Editing a
 * testimonial/post in the CMS therefore changes the rendered page WITHOUT
 * touching the page composition — the binding is live, not a copy.
 *
 * Note: Puck also offers `resolveAllData` (used with each component's
 * `resolveData`), but those resolvers are shared with the browser editor and
 * would need fetch-over-HTTP; this walk uses the Local API directly instead.
 */

type ExternalRef = {
  collection: "testimonials" | "posts";
  docId: string | number;
  [key: string]: unknown;
};

const isExternalRef = (v: unknown): v is ExternalRef =>
  typeof v === "object" &&
  v !== null &&
  "docId" in v &&
  "collection" in v &&
  ((v as ExternalRef).collection === "testimonials" ||
    (v as ExternalRef).collection === "posts");

async function resolveValue(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map(resolveValue));
  }
  if (typeof value !== "object" || value === null) return value;

  if (isExternalRef(value)) {
    try {
      const payload = await getPayloadClient();
      const doc = await payload.findByID({
        collection: value.collection,
        id: value.docId,
      });
      const { id: _id, updatedAt: _u, createdAt: _c, ...fresh } = doc as unknown as Record<
        string,
        unknown
      >;
      return { ...value, ...fresh };
    } catch {
      // doc deleted in CMS → keep snapshot, flag it (a real platform would
      // surface this as an `outdated`/broken-binding marker)
      return { ...value, _broken: true };
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = await resolveValue(v);
  }
  return out;
}

export async function resolveExternalBindings(data: Data): Promise<Data> {
  return (await resolveValue(data)) as Data;
}
