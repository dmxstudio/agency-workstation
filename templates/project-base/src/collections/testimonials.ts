/**
 * @generated-example — OWNED-BY-CODEGEN
 * Example collection illustrating the shape the generator emits from the
 * `cms.collections` spec artifact. Regenerated on spec changes; do not edit.
 */
import type { CollectionConfig } from "payload";

export const Testimonials: CollectionConfig = {
  slug: "testimonials",
  admin: { useAsTitle: "author" },
  fields: [
    { name: "author", type: "text", required: true },
    { name: "role", type: "text" },
    { name: "company", type: "text" },
    { name: "quote", type: "textarea", required: true },
    { name: "rating", type: "number", min: 1, max: 5 },
  ],
};
