"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Data } from "@puckeditor/core";
import { getPayloadClient } from "./payload-client";
import { assertEditAccess } from "./edit-auth";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\/{2,}/g, "/");

export async function createPage(formData: FormData) {
  await assertEditAccess();
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
      puckData: { root: { props: { title, description: "" } }, content: [], zones: {} },
      publishedData: null,
    },
  });
  revalidatePath("/edit");
  redirect(`/edit/${path}`);
}

export async function savePageDraft(pageId: string | number, data: Data) {
  await assertEditAccess();
  const payload = await getPayloadClient();
  await payload.update({
    collection: "pages",
    id: pageId,
    data: { puckData: data },
  });
  return { ok: true as const, savedAt: new Date().toISOString() };
}

export async function publishPage(pageId: string | number, data: Data) {
  await assertEditAccess();
  const payload = await getPayloadClient();
  await payload.update({
    collection: "pages",
    id: pageId,
    data: { puckData: data, publishedData: data },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, publishedAt: new Date().toISOString() };
}
