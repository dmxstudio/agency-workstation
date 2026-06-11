/**
 * @generated-example — OWNED-BY-CODEGEN
 * Example collection illustrating the shape the generator emits from the
 * `cms.collections` spec artifact. Regenerated on spec changes; do not edit.
 */
import type { CollectionConfig } from "payload";

export const Posts: CollectionConfig = {
  slug: "posts",
  admin: { useAsTitle: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "excerpt", type: "textarea" },
    { name: "category", type: "text" },
    { name: "publishedAt", type: "date" },
  ],
};
