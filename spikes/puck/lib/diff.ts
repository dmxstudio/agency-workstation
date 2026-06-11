import type { ComponentData, Data } from "@puckeditor/core";

/**
 * Cheap structural diff between two Puck Data trees (draft vs last published).
 * Flattens content + nested slots into a map keyed by component id, then
 * compares JSON-serialized props. This is the same approach the platform's
 * artifact diff uses (structural, by stable id), so it proves the
 * propose→diff→approve loop can live inside the editor.
 */

export type DiffEntry = {
  id: string;
  type: string;
  kind: "added" | "removed" | "changed" | "moved";
  detail?: string;
};

export type PuckDiff = {
  entries: DiffEntry[];
  rootChanged: boolean;
  clean: boolean;
};

type FlatItem = { type: string; props: Record<string, unknown>; order: number };

function flatten(data: Data | null | undefined): Map<string, FlatItem> {
  const map = new Map<string, FlatItem>();
  let order = 0;

  const visitItem = (item: ComponentData) => {
    const { id, ...props } = (item.props ?? {}) as Record<string, unknown> & {
      id?: string;
    };
    map.set(id ?? `anon-${order}`, { type: item.type as string, props, order: order++ });
    // recurse into slot props (arrays of { type, props })
    for (const value of Object.values(props)) {
      visitSlots(value);
    }
  };

  const visitSlots = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          "type" in entry &&
          "props" in entry
        ) {
          visitItem(entry as ComponentData);
        } else {
          visitSlots(entry);
        }
      }
    } else if (typeof value === "object" && value !== null) {
      for (const v of Object.values(value)) visitSlots(v);
    }
  };

  for (const item of data?.content ?? []) visitItem(item);
  // legacy zones support (the spike only uses slots, but be safe)
  for (const zone of Object.values(data?.zones ?? {})) {
    for (const item of zone) visitItem(item);
  }
  return map;
}

function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}

export function diffPuckData(
  baseline: Data | null | undefined,
  current: Data | null | undefined
): PuckDiff {
  const before = flatten(baseline);
  const after = flatten(current);
  const entries: DiffEntry[] = [];

  for (const [id, item] of after) {
    const prev = before.get(id);
    if (!prev) {
      entries.push({ id, type: item.type, kind: "added" });
    } else {
      const keys = changedKeys(prev.props, item.props);
      if (keys.length > 0) {
        entries.push({ id, type: item.type, kind: "changed", detail: keys.join(", ") });
      } else if (prev.order !== item.order) {
        entries.push({ id, type: item.type, kind: "moved" });
      }
    }
  }
  for (const [id, item] of before) {
    if (!after.has(id)) entries.push({ id, type: item.type, kind: "removed" });
  }

  const rootChanged =
    JSON.stringify(baseline?.root ?? {}) !== JSON.stringify(current?.root ?? {});

  return { entries, rootChanged, clean: entries.length === 0 && !rootChanged };
}
