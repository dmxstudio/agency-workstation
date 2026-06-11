import { getPayload } from "payload";
import config from "@payload-config";

/** Payload Local API singleton (embedded, no HTTP). */
export const getPayloadClient = () => getPayload({ config });

export type PageRecord = {
  id: string | number;
  title: string;
  path: string;
  puckData: unknown;
  publishedData: unknown;
  approvalStatus: "draft" | "in_review" | "approved";
  updatedAt: string;
  createdAt: string;
};
