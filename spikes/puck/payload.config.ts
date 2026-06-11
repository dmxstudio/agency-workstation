import path from "path";
import { fileURLToPath } from "url";
import { buildConfig } from "payload";
import { sqliteAdapter } from "@payloadcms/db-sqlite";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Payload 3.x embedded config — SQLite file driver, zero external servers.
 * Admin UI intentionally NOT mounted (out of spike scope); all access goes
 * through the Local API (getPayload) from server code.
 */
export default buildConfig({
  secret: process.env.PAYLOAD_SECRET ?? "puck-spike-local-secret-do-not-use",
  db: sqliteAdapter({
    client: {
      url: `file:${path.resolve(dirname, ".data/puck-spike.db")}`,
    },
  }),
  collections: [
    {
      slug: "pages",
      admin: { useAsTitle: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        // URL path of the page, no leading slash. Supports nesting ("legal/terms").
        { name: "path", type: "text", required: true, unique: true, index: true },
        // Puck Data JSON — working draft
        { name: "puckData", type: "json" },
        // Puck Data JSON — last published snapshot (diff baseline)
        { name: "publishedData", type: "json" },
        {
          name: "approvalStatus",
          type: "select",
          options: ["draft", "in_review", "approved"],
          defaultValue: "draft",
          required: true,
        },
      ],
    },
    {
      slug: "testimonials",
      admin: { useAsTitle: "author" },
      fields: [
        { name: "author", type: "text", required: true },
        { name: "role", type: "text" },
        { name: "company", type: "text" },
        { name: "quote", type: "textarea", required: true },
        { name: "rating", type: "number", min: 1, max: 5 },
      ],
    },
    {
      slug: "posts",
      admin: { useAsTitle: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "excerpt", type: "textarea" },
        { name: "category", type: "text" },
        { name: "publishedAt", type: "date" },
      ],
    },
  ],
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
});
