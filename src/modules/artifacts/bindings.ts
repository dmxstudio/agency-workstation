import type { CmsCollectionsPayload } from "./types/cms-collections";
import {
  legacyPageCompositionItemSchema,
  pageCompositionPayloadSchema,
  type LegacyPageCompositionItem,
  type PageCompositionPayload,
} from "./types/page-composition";

/**
 * Bindings CMS de una composición de página — helper COMPARTIDO (§10.2/§11.2).
 *
 * Única fuente de verdad sobre qué cuenta como binding y cómo se valida contra
 * el artefacto `cms.collections`. Lo consumen:
 * - el generator (§18.2): conflictos `binding-missing-*` por página, nunca
 *   auto-resueltos;
 * - el Studio/CMS: `listCompositionBindings` alimenta el mapa de uso
 *   ("qué páginas usan esta colección/campo").
 *
 * Formatos de binding reconocidos (los TRES que existen en el sistema):
 *
 * 1. **Referencia viva** (formato del template, `lib/bindings.ts` +
 *    `mapProp` del campo `external` de Puck): cualquier valor de prop con
 *    forma `{ collection: string, docId: string|number, …snapshot }`. El
 *    snapshot lleva los campos del documento copiados al seleccionar; el
 *    render los re-resuelve por request. Validación: la colección debe
 *    existir y cada clave del snapshot debe seguir siendo un campo de la
 *    colección (clave huérfana = campo eliminado aún referenciado).
 *
 * 2. **Placeholder de seed** (formato del codegen, resuelto por el
 *    `scripts/seed.mts` del template): `{ "$seedRef": { "collection": "…",
 *    "index": n } }`. Validación: solo existencia de la colección (no hay
 *    información de campos antes del seed).
 *
 * 3. **Forma legada 1.0** (archivos `src/compositions/page-*.json` ya
 *    scaffoldeados en repos generados): `bindings: { prop: "colección.campo" }`.
 *    Validación: existencia de colección y campo.
 */

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

export type CompositionBindingKind = "external-ref" | "seed-ref" | "field-path";

export interface CompositionBinding {
  /** Página (key del artefacto `page.composition` o slug del archivo legado). */
  page: string;
  /** Id estable del bloque/sección que contiene el binding. */
  sectionId: string;
  /** Ruta del prop dentro del bloque, p.ej. `testimonial`, `items[0].source`. */
  prop: string;
  kind: CompositionBindingKind;
  collection: string;
  /** Campo concreto (solo `field-path`); null en referencias a documento. */
  field: string | null;
  /** Claves del snapshot copiado (solo `external-ref`). */
  snapshotFields: string[];
  /** Representación humana, p.ej. `case-studies.summary`, `testimonials#3`. */
  binding: string;
}

/** Conflictos de binding — misma forma que consume la pantalla del Generator. */
export type BindingConflict =
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
    };

/** Composición aceptada por los helpers: Data v2 o item legado 1.0. */
export type AnyComposition = PageCompositionPayload | LegacyPageCompositionItem;

// ---------------------------------------------------------------------------
// Detección de refs dentro de props (formato del template)
// ---------------------------------------------------------------------------

interface SeedRefValue {
  $seedRef: { collection: string; index: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSeedRef(value: Record<string, unknown>): SeedRefValue["$seedRef"] | null {
  const ref = value.$seedRef;
  if (!isRecord(ref)) return null;
  if (typeof ref.collection !== "string" || ref.collection.length === 0) return null;
  return { collection: ref.collection, index: typeof ref.index === "number" ? ref.index : 0 };
}

/** Claves de gestión de una referencia viva: no son campos del documento. */
const EXTERNAL_REF_META_KEYS = new Set(["collection", "docId", "_broken", "id"]);

function isExternalRef(value: Record<string, unknown>): boolean {
  return (
    typeof value.collection === "string" &&
    value.collection.length > 0 &&
    "docId" in value &&
    (typeof value.docId === "string" || typeof value.docId === "number")
  );
}

function isLegacyItem(composition: AnyComposition): composition is LegacyPageCompositionItem {
  return "sections" in composition && Array.isArray(composition.sections);
}

// ---------------------------------------------------------------------------
// listCompositionBindings
// ---------------------------------------------------------------------------

function walkValue(
  value: unknown,
  page: string,
  sectionId: string,
  propPath: string,
  out: CompositionBinding[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      // Un slot de Puck es un array de bloques { type, props: { id } } dentro
      // de un prop: cada bloque anidado ancla sus propios bindings a su id.
      if (
        isRecord(entry) &&
        typeof entry.type === "string" &&
        isRecord(entry.props) &&
        typeof entry.props.id === "string"
      ) {
        walkValue(entry.props, page, entry.props.id, "", out);
        return;
      }
      walkValue(entry, page, sectionId, `${propPath}[${index}]`, out);
    });
    return;
  }
  if (!isRecord(value)) return;

  const seedRef = asSeedRef(value);
  if (seedRef) {
    out.push({
      page,
      sectionId,
      prop: propPath || "$seedRef",
      kind: "seed-ref",
      collection: seedRef.collection,
      field: null,
      snapshotFields: [],
      binding: `${seedRef.collection}[$seed ${seedRef.index}]`,
    });
    return;
  }

  if (isExternalRef(value)) {
    const snapshotFields = Object.keys(value)
      .filter((key) => !EXTERNAL_REF_META_KEYS.has(key))
      .sort();
    out.push({
      page,
      sectionId,
      prop: propPath || "(raíz)",
      kind: "external-ref",
      collection: value.collection as string,
      field: null,
      snapshotFields,
      binding: `${value.collection}#${value.docId}`,
    });
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "id" && propPath === "") continue; // id del bloque, no un prop
    walkValue(child, page, sectionId, propPath ? `${propPath}.${key}` : key, out);
  }
}

/**
 * Lista TODOS los bindings CMS de una composición (Data v2 o item legado),
 * en orden estable. `page` etiqueta el origen (key del artefacto o slug).
 */
export function listCompositionBindings(
  composition: AnyComposition,
  page?: string,
): CompositionBinding[] {
  const out: CompositionBinding[] = [];

  if (isLegacyItem(composition)) {
    const pageLabel = page ?? composition.slug;
    for (const section of composition.sections) {
      for (const [prop, binding] of Object.entries(section.bindings)) {
        const dot = binding.indexOf(".");
        out.push({
          page: pageLabel,
          sectionId: section.id,
          prop,
          kind: "field-path",
          collection: dot === -1 ? binding : binding.slice(0, dot),
          field: dot === -1 ? "" : binding.slice(dot + 1),
          snapshotFields: [],
          binding,
        });
      }
      // Las secciones legadas también pueden llevar refs dentro de props.
      walkValue(section.props, pageLabel, section.id, "", out);
    }
    return out;
  }

  const pageLabel = page ?? "(sin página)";
  for (const block of composition.content) {
    walkValue(block.props, pageLabel, block.props.id, "", out);
  }
  for (const blocks of Object.values(composition.zones ?? {})) {
    for (const block of blocks) {
      walkValue(block.props, pageLabel, block.props.id, "", out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// validateCompositionBindings
// ---------------------------------------------------------------------------

/**
 * Valida los bindings de una composición contra el payload `cms.collections`
 * aprobado. Devuelve conflictos DESCRIPTIVOS (página/sección/prop/colección/
 * campo); jamás modifica la composición — el sistema marca, nunca resuelve
 * (§8.4, §18.2).
 */
export function validateCompositionBindings(
  composition: AnyComposition,
  collections: CmsCollectionsPayload,
  page?: string,
): BindingConflict[] {
  const fieldsByCollection = new Map<string, Set<string>>(
    collections.collections.map((collection) => [
      collection.slug,
      new Set(collection.fields.map((field) => field.name)),
    ]),
  );

  const conflicts: BindingConflict[] = [];
  for (const binding of listCompositionBindings(composition, page)) {
    const fields = fieldsByCollection.get(binding.collection);
    if (!fields) {
      conflicts.push({
        kind: "binding-missing-collection",
        page: binding.page,
        sectionId: binding.sectionId,
        prop: binding.prop,
        binding: binding.binding,
        collection: binding.collection,
        message: `La página \`${binding.page}\`, sección \`${binding.sectionId}\`, prop \`${binding.prop}\` está bindeada a \`${binding.binding}\`, pero la colección \`${binding.collection}\` ya no existe en la spec. La página no se modifica; resuelve el binding o restaura la colección.`,
      });
      continue;
    }

    const missingFields =
      binding.kind === "field-path"
        ? [binding.field ?? ""].filter((field) => !fields.has(field))
        : binding.snapshotFields.filter((field) => !fields.has(field));

    for (const field of missingFields) {
      conflicts.push({
        kind: "binding-missing-field",
        page: binding.page,
        sectionId: binding.sectionId,
        prop: binding.prop,
        binding: binding.binding,
        collection: binding.collection,
        field,
        message: `La página \`${binding.page}\`, sección \`${binding.sectionId}\`, prop \`${binding.prop}\` está bindeada a \`${binding.binding}\`, pero el campo \`${field}\` fue eliminado de la colección \`${binding.collection}\`. La página no se modifica; resuelve el binding o restaura el campo.`,
      });
    }
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Parse tolerante de composiciones serializadas (archivos en repos generados)
// ---------------------------------------------------------------------------

/**
 * Parsea una composición serializada en cualquiera de sus dos formas (Data
 * v2 o item legado 1.0). `null` si no es ninguna — el llamador decide cómo
 * reportarlo (p.ej. conflicto `composition-unreadable`).
 */
export function parseAnyComposition(raw: unknown): AnyComposition | null {
  if (!isRecord(raw)) return null;
  if (Array.isArray(raw.content) || isRecord(raw.root)) {
    const parsed = pageCompositionPayloadSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  if (Array.isArray(raw.sections)) {
    const parsed = legacyPageCompositionItemSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  return null;
}
