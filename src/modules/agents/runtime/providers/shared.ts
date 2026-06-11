/**
 * Shared plumbing for HTTP LLM providers: backoff for the single retry
 * allowed on 429/5xx and safe error-body parsing. No key material ever
 * touches this file.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 10_000;

/**
 * Delay before the single retry: honors `retry-after` (seconds, capped at
 * 10s) when the provider sends it (429), else a fixed 1s backoff.
 */
export function retryDelayMs(response: Response): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
    }
  }
  return DEFAULT_RETRY_DELAY_MS;
}

/** Parses a JSON error body without throwing (providers may return HTML). */
export async function safeParseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Reads `path` (dot-separated) out of an unknown JSON value, or undefined. */
export function pick(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function pickString(value: unknown, path: string): string | undefined {
  const found = pick(value, path);
  return typeof found === "string" ? found : undefined;
}

export function pickNumber(value: unknown, path: string): number {
  const found = pick(value, path);
  return typeof found === "number" && Number.isFinite(found) ? found : 0;
}
