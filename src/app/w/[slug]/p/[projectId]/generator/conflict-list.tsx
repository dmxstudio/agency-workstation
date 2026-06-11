import { Lightbulb } from "lucide-react";

import type { Conflict, ConflictKind } from "@/modules/generator";
import { Badge, type BadgeTone } from "@/ui";

/**
 * Lista de conflictos de regeneración (§18.2). Los conflictos son EL feature:
 * el sistema marca, nunca resuelve. Cada entrada muestra el tipo, los campos
 * estructurados (archivo/página/sección/prop/colección/campo), el mensaje
 * completo en mono y una guía de resolución concreta.
 */

interface KindMeta {
  label: string;
  tone: BadgeTone;
  guidance: string;
}

const KIND_META: Record<ConflictKind, KindMeta> = {
  "human-edit-in-codegen-zone": {
    label: "Edición humana en zona codegen",
    tone: "warning",
    guidance:
      "El archivo pertenece al generador pero fue editado a mano, así que NO se reescribió. Si quieres conservar el cambio, muévelo a un archivo propio (zona humana) y revierte el generado con `git checkout -- <ruta>`; la siguiente regeneración aplicará el contenido pendiente solo en ese archivo.",
  },
  "codegen-file-missing": {
    label: "Archivo generado ausente",
    tone: "warning",
    guidance:
      "Un archivo del generador fue borrado del repo a mano. Restáuralo con `git checkout -- <ruta>` (o desde el historial git) y vuelve a regenerar.",
  },
  "orphan-codegen-modified": {
    label: "Huérfano con ediciones manuales",
    tone: "warning",
    guidance:
      "El archivo ya no se deriva de la spec actual, pero contiene ediciones manuales, así que no se eliminó automáticamente. Bórralo a mano si ya no lo necesitas, o muévelo fuera de la zona codegen para conservarlo como archivo humano.",
  },
  "binding-missing-collection": {
    label: "Binding a colección inexistente",
    tone: "danger",
    guidance:
      "Una sección compuesta usa un binding hacia una colección que ya no existe en el Data Model. La página NO se modificó: edita la composición para quitar o reapuntar el binding, o vuelve a añadir la colección en cms.collections y regenera.",
  },
  "binding-missing-field": {
    label: "Binding a campo inexistente",
    tone: "danger",
    guidance:
      "Una sección compuesta usa un binding hacia un campo que ya no existe en su colección. La página NO se modificó: edita la composición para quitar o reapuntar el binding, o restaura el campo en cms.collections y regenera.",
  },
  "composition-unreadable": {
    label: "Composición ilegible",
    tone: "danger",
    guidance:
      "El JSON de la composición no se pudo parsear, así que se omitió de la validación de bindings. Corrige el archivo a mano (o restáuralo desde el historial git) y vuelve a regenerar.",
  },
};

interface Fact {
  label: string;
  value: string;
}

/** Campos estructurados por tipo de conflicto (TS estrecha la unión). */
function conflictFacts(conflict: Conflict): Fact[] {
  switch (conflict.kind) {
    case "human-edit-in-codegen-zone":
      return [
        { label: "Archivo", value: conflict.path },
        { label: "Hash esperado", value: conflict.expectedHash.slice(0, 12) },
        { label: "Hash actual", value: conflict.actualHash.slice(0, 12) },
      ];
    case "codegen-file-missing":
    case "orphan-codegen-modified":
    case "composition-unreadable":
      return [{ label: "Archivo", value: conflict.path }];
    case "binding-missing-collection":
      return [
        { label: "Página", value: conflict.page },
        { label: "Sección", value: conflict.sectionId },
        { label: "Prop", value: conflict.prop },
        { label: "Binding", value: conflict.binding },
        { label: "Colección", value: conflict.collection },
      ];
    case "binding-missing-field":
      return [
        { label: "Página", value: conflict.page },
        { label: "Sección", value: conflict.sectionId },
        { label: "Prop", value: conflict.prop },
        { label: "Binding", value: conflict.binding },
        { label: "Colección", value: conflict.collection },
        { label: "Campo", value: conflict.field },
      ];
  }
}

function ConflictItem({ conflict }: { conflict: Conflict }) {
  const meta = KIND_META[conflict.kind];
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <code className="font-mono text-[11px] text-faint">{conflict.kind}</code>
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1">
        {conflictFacts(conflict).map((fact) => (
          <div key={fact.label} className="flex items-baseline gap-1.5">
            <dt className="text-[11px] tracking-wide text-muted uppercase">{fact.label}</dt>
            <dd className="font-mono text-xs break-all text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <pre className="overflow-x-auto rounded border border-border bg-surface-raised px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
        {conflict.message}
      </pre>

      <p className="flex items-start gap-1.5 text-xs text-muted">
        <Lightbulb size={13} strokeWidth={1.75} className="mt-px shrink-0 text-faint" aria-hidden />
        <span>{meta.guidance}</span>
      </p>
    </li>
  );
}

export function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {conflicts.map((conflict, index) => (
        <ConflictItem key={`${conflict.kind}-${index}`} conflict={conflict} />
      ))}
    </ul>
  );
}
