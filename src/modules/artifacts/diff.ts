/**
 * Structural (not plain-text) diff between two artifact JSON payloads (§8.3).
 *
 * Produces a flat list of changes structurally compatible with the
 * `DiffChange` interface consumed by `src/ui/DiffView.tsx`:
 * `{ path, type: "added" | "removed" | "changed", before?, after? }`.
 *
 * Rules:
 * - Nested objects are walked recursively; an added/removed subtree is
 *   reported as a single change carrying the whole subtree value.
 * - Arrays align by item identity when every item on both sides is an object
 *   with a unique scalar `id` (or `slug`) — paths read `sections[id=hero]`.
 *   Otherwise they align by index — paths read `sections[2]`.
 */

export type DiffChangeType = "added" | "removed" | "changed";

/** Structurally identical to `DiffChange` in `src/ui/DiffView.tsx`. */
export interface DiffChange {
  path: string;
  type: DiffChangeType;
  before?: unknown;
  after?: unknown;
}

/** Keys tried (in order) to align array items by identity. */
const ALIGNMENT_KEYS = ["id", "slug"] as const;

/** Path label used when the diff root itself is a changed primitive. */
const ROOT_PATH = "$";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep equality for JSON-ish values (objects, arrays, primitives). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
    );
  }
  return false;
}

function joinPath(base: string, key: string): string {
  return base === "" ? key : `${base}.${key}`;
}

/** Union of keys preserving `before` insertion order, then new `after` keys. */
function unionKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = Object.keys(before);
  const seen = new Set(keys);
  for (const key of Object.keys(after)) {
    if (!seen.has(key)) keys.push(key);
  }
  return keys;
}

type AlignmentKey = (typeof ALIGNMENT_KEYS)[number];

/**
 * Returns the first key (`id`, `slug`) usable to align both arrays: every
 * item must be a plain object holding a unique scalar value for that key.
 */
function pickAlignmentKey(before: unknown[], after: unknown[]): AlignmentKey | null {
  outer: for (const key of ALIGNMENT_KEYS) {
    for (const list of [before, after]) {
      const seen = new Set<string>();
      for (const item of list) {
        if (!isPlainObject(item)) continue outer;
        const value = item[key];
        if (typeof value !== "string" && typeof value !== "number") continue outer;
        const normalized = String(value);
        if (seen.has(normalized)) continue outer; // duplicated → unusable
        seen.add(normalized);
      }
    }
    if (before.length > 0 || after.length > 0) return key;
  }
  return null;
}

function diffArrays(before: unknown[], after: unknown[], path: string, out: DiffChange[]): void {
  const alignmentKey = pickAlignmentKey(before, after);

  if (alignmentKey) {
    const keyOf = (item: unknown): string =>
      String((item as Record<string, unknown>)[alignmentKey]);
    const beforeByKey = new Map(before.map((item) => [keyOf(item), item]));
    const afterByKey = new Map(after.map((item) => [keyOf(item), item]));

    for (const [key, item] of beforeByKey) {
      if (!afterByKey.has(key)) {
        out.push({ path: `${path}[${alignmentKey}=${key}]`, type: "removed", before: item });
      }
    }
    for (const [key, item] of afterByKey) {
      const itemPath = `${path}[${alignmentKey}=${key}]`;
      if (!beforeByKey.has(key)) {
        out.push({ path: itemPath, type: "added", after: item });
      } else {
        walk(beforeByKey.get(key), item, itemPath, out);
      }
    }
    return;
  }

  const common = Math.min(before.length, after.length);
  for (let i = 0; i < common; i++) {
    walk(before[i], after[i], `${path}[${i}]`, out);
  }
  for (let i = common; i < before.length; i++) {
    out.push({ path: `${path}[${i}]`, type: "removed", before: before[i] });
  }
  for (let i = common; i < after.length; i++) {
    out.push({ path: `${path}[${i}]`, type: "added", after: after[i] });
  }
}

function walk(before: unknown, after: unknown, path: string, out: DiffChange[]): void {
  if (Object.is(before, after)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of unionKeys(before, after)) {
      const childPath = joinPath(path, key);
      const inBefore = Object.prototype.hasOwnProperty.call(before, key);
      const inAfter = Object.prototype.hasOwnProperty.call(after, key);
      if (inBefore && !inAfter) {
        out.push({ path: childPath, type: "removed", before: before[key] });
      } else if (!inBefore && inAfter) {
        out.push({ path: childPath, type: "added", after: after[key] });
      } else {
        walk(before[key], after[key], childPath, out);
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    diffArrays(before, after, path, out);
    return;
  }

  // Primitives, nulls, or container-type mismatch (object ↔ array ↔ scalar).
  if (!deepEqual(before, after)) {
    out.push({ path: path === "" ? ROOT_PATH : path, type: "changed", before, after });
  }
}

/**
 * Recursive structural diff between two JSON payloads.
 * Returns a flat change list ready for `DiffView` (src/ui).
 */
export function diffPayloads(before: unknown, after: unknown): DiffChange[] {
  const changes: DiffChange[] = [];
  walk(before ?? {}, after ?? {}, "", changes);
  return changes;
}
