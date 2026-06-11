/**
 * Conflict reporting (§18.2): conflicts are REPORTED, never auto-resolved.
 * Every conflict carries enough structure for the platform UI to point the
 * human at the exact file/page/section/field involved.
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
  | {
      kind: "binding-missing-collection";
      page: string;
      sectionId: string;
      prop: string;
      binding: string;
      collection: string;
      message: string;
    }
  | {
      kind: "binding-missing-field";
      page: string;
      sectionId: string;
      prop: string;
      binding: string;
      collection: string;
      field: string;
      message: string;
    }
  | {
      kind: "composition-unreadable";
      path: string;
      message: string;
    };

export function formatConflict(conflict: Conflict): string {
  return `[${conflict.kind}] ${conflict.message}`;
}
