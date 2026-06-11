import type { CollectionConfig } from "payload";

/**
 * Static template collections — NOT touched by codegen.
 *
 * - `users`: admin/editor accounts of the generated site (Payload auth).
 * - `pages`: one document per routed page; Puck Data JSON lives here
 *   (`puckData` = working draft, `publishedData` = snapshot served at the
 *   public URL). Approval/versioning governance lives in the platform's
 *   Artifact Model, not in this project.
 */

export const Users: CollectionConfig = {
  slug: "users",
  auth: true,
  admin: { useAsTitle: "email" },
  fields: [{ name: "name", type: "text" }],
};

export const Pages: CollectionConfig = {
  slug: "pages",
  admin: { useAsTitle: "title", defaultColumns: ["title", "path", "updatedAt"] },
  fields: [
    { name: "title", type: "text", required: true },
    // URL path of the page, no leading slash. Supports nesting ("legal/terms").
    { name: "path", type: "text", required: true, unique: true, index: true },
    // Puck Data JSON — working draft
    { name: "puckData", type: "json" },
    // Puck Data JSON — last published snapshot (what the public URL renders)
    { name: "publishedData", type: "json" },
  ],
};

export const baseCollections: CollectionConfig[] = [Users, Pages];
