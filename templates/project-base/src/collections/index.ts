/**
 * @generated-example — OWNED-BY-CODEGEN
 * Barrel of the CMS collections generated from the `cms.collections` spec
 * artifact. The platform generator rewrites this file (and one file per
 * collection in this directory) on regeneration. Do not edit by hand.
 */
import type { CollectionConfig } from "payload";
// Explicit .ts extensions: required by `payload run` (tsx CJS loader).
import { Testimonials } from "./testimonials.ts";
import { Posts } from "./posts.ts";

export const generatedCollections: CollectionConfig[] = [Testimonials, Posts];
