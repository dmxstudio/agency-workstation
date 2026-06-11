import type { BindingConflict } from "@/modules/artifacts";

/**
 * Conflict reporting (§18.2): conflicts are REPORTED, never auto-resolved.
 * Every conflict carries enough structure for the platform UI to point the
 * human at the exact file/page/section/field involved.
 *
 * Binding conflicts (`binding-missing-collection` / `binding-missing-field`)
 * are produced by the SHARED helper `src/modules/artifacts/bindings.ts`
 * (`validateCompositionBindings`) so the generator, the Studio and the CMS
 * usage map always agree on what counts as a broken binding. Their `page`
 * field is the page key of the `page.composition` artifact (or the slug of a
 * legacy on-disk composition file).
 *
 * File-level conflicts ported from `spikes/regen/src/conflicts.ts` (validated
 * spike code).
 */

export type Conflict =
  | {
      kind: "human-edit-in-codegen-zone";
      path: string;
      expectedHash: string;
      actualHash: string;
      message: string;
    }
  | {
      kind: "codegen-file-missing";
      path: string;
      message: string;
    }
  | {
      kind: "orphan-codegen-modified";
      path: string;
      message: string;
    }
  | BindingConflict
  | {
      kind: "composition-unreadable";
      path: string;
      message: string;
    };

export type ConflictKind = Conflict["kind"];

export function formatConflict(conflict: Conflict): string {
  return `[${conflict.kind}] ${conflict.message}`;
}
