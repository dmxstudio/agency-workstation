import { newId } from "@/db/ids";

/** Generation IDs (`gen_…`) — platform-wide convention from `src/db/ids.ts`. */
export function newGenerationId(): string {
  return newId.generation();
}
