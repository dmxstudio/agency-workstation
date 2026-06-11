"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Data } from "@puckeditor/core";
import { getPayloadClient } from "./payload-client";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\/{2,}/g, "/");

export async function createPage(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const rawPath = String(formData.get("path") ?? "").trim();
  const path = slugify(rawPath || title);
  if (!path) return;

  const payload = await getPayloadClient();
  const existing = await payload.find({
    collection: "pages",
    where: { path: { equals: path } },
    limit: 1,
  });
  if (existing.totalDocs > 0) {
    redirect(`/edit/${path}`);
  }

  await payload.create({
    collection: "pages",
    data: {
      title,
      path,
      approvalStatus: "draft",
      puckData: { root: { props: { title, description: "" } }, content: [], zones: {} },
      publishedData: null,
    },
  });
  revalidatePath("/");
  redirect(`/edit/${path}`);
}

export async function savePageDraft(pageId: string | number, data: Data) {
  const payload = await getPayloadClient();
  await payload.update({
    collection: "pages",
    id: pageId,
    data: { puckData: data },
  });
  revalidatePath("/");
  return { ok: true as const, savedAt: new Date().toISOString() };
}

export async function publishPage(pageId: string | number, data: Data) {
  const payload = await getPayloadClient();
  await payload.update({
    collection: "pages",
    id: pageId,
    data: { puckData: data, publishedData: data },
  });
  revalidatePath("/");
  return { ok: true as const, publishedAt: new Date().toISOString() };
}

export async function setApprovalStatus(
  pageId: string | number,
  status: "draft" | "in_review" | "approved"
) {
  const payload = await getPayloadClient();
  await payload.update({
    collection: "pages",
    id: pageId,
    data: { approvalStatus: status },
  });
  revalidatePath("/");
  return { ok: true as const, status };
}
