"use client";

import { useMemo } from "react";
import { CornerDownRight } from "lucide-react";

import type { SitemapNode, SpecSitemapPayload } from "@/modules/artifacts/types";
import { Field, Input } from "@/ui";

import { asArray, asObject, asString, asStringArray, optionalString } from "./coerce";
import { AddButton, FormSection, RowControls, SlugListEditor } from "./controls";
import { moveItem, removeAt, replaceAt } from "./list-utils";
import { issueAt, pathKey, type ArtifactFormProps } from "./types";

interface NodeDraft {
  title: string;
  slug: string;
  description: string;
  children: NodeDraft[];
}

interface SitemapDraft {
  pages: NodeDraft[];
  navigation: { header: string[]; footer: string[] };
}

function coerceNode(value: unknown): NodeDraft {
  const v = asObject(value);
  return {
    title: asString(v.title),
    slug: asString(v.slug),
    description: asString(v.description),
    children: asArray(v.children).map(coerceNode),
  };
}

function coerce(value: unknown): SitemapDraft {
  const v = asObject(value);
  const navigation = asObject(v.navigation);
  const pages = asArray(v.pages).map(coerceNode);
  return {
    pages: pages.length > 0 ? pages : [coerceNode(null)],
    navigation: {
      header: asStringArray(navigation.header),
      footer: asStringArray(navigation.footer),
    },
  };
}

function nodeToPayload(node: NodeDraft): SitemapNode {
  return {
    title: node.title,
    slug: node.slug,
    description: optionalString(node.description),
    children: node.children.map(nodeToPayload),
  };
}

function toPayload(draft: SitemapDraft): SpecSitemapPayload {
  return {
    pages: draft.pages.map(nodeToPayload),
    navigation: { header: draft.navigation.header, footer: draft.navigation.footer },
  };
}

export function createEmptySitemapPayload(): SpecSitemapPayload {
  return toPayload(coerce(null));
}

function collectSlugs(nodes: NodeDraft[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.slug !== "") out.push(node.slug);
    collectSlugs(node.children, out);
  }
  return out;
}

const MAX_DEPTH = 4;

interface NodeEditorProps {
  node: NodeDraft;
  index: number;
  count: number;
  /** Path de errores hasta este nodo, p.ej. `pages.0.children.1`. */
  basePath: string;
  depth: number;
  readOnly: boolean;
  issues: ArtifactFormProps["issues"];
  onChange: (node: NodeDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

function NodeEditor({
  node,
  index,
  count,
  basePath,
  depth,
  readOnly,
  issues,
  onChange,
  onMove,
  onRemove,
}: NodeEditorProps) {
  const titleError = issues[pathKey(basePath, "title")];
  const slugError = issues[pathKey(basePath, "slug")];
  const descriptionError = issues[pathKey(basePath, "description")];

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-start gap-1.5">
        {depth > 0 ? (
          <CornerDownRight size={13} aria-hidden className="mt-2 shrink-0 text-faint" />
        ) : null}
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Field label="Título" required error={titleError}>
            <Input
              value={node.title}
              disabled={readOnly}
              invalid={!!titleError}
              placeholder="p.ej. Sobre nosotros"
              onChange={(event) => onChange({ ...node, title: event.target.value })}
            />
          </Field>
          <Field label="Slug" required error={slugError} hint="Minúsculas, números y guiones.">
            <Input
              value={node.slug}
              disabled={readOnly}
              invalid={!!slugError}
              className="font-mono"
              placeholder="sobre-nosotros"
              onChange={(event) => onChange({ ...node, slug: event.target.value })}
            />
          </Field>
        </div>
        <RowControls
          index={index}
          count={count}
          disabled={readOnly}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      <div className="mt-3">
        <Field label="Descripción" error={descriptionError}>
          <Input
            value={node.description}
            disabled={readOnly}
            placeholder="Propósito de la página (opcional)"
            onChange={(event) => onChange({ ...node, description: event.target.value })}
          />
        </Field>
      </div>

      {node.children.length > 0 || (!readOnly && depth < MAX_DEPTH) ? (
        <div className="mt-3 flex flex-col gap-2 border-l border-border pl-3">
          {node.children.map((child, childIndex) => (
            <NodeEditor
              key={childIndex}
              node={child}
              index={childIndex}
              count={node.children.length}
              basePath={pathKey(basePath, "children", childIndex)}
              depth={depth + 1}
              readOnly={readOnly}
              issues={issues}
              onChange={(next) =>
                onChange({ ...node, children: replaceAt(node.children, childIndex, next) })
              }
              onMove={(delta) =>
                onChange({ ...node, children: moveItem(node.children, childIndex, delta) })
              }
              onRemove={() =>
                onChange({ ...node, children: removeAt(node.children, childIndex) })
              }
            />
          ))}
          {depth < MAX_DEPTH ? (
            <AddButton
              label="Añadir subpágina"
              disabled={readOnly}
              onClick={() =>
                onChange({ ...node, children: [...node.children, coerceNode(null)] })
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** `spec.sitemap` — árbol de páginas con slugs y navegación (§7.2 IA). */
export function SitemapForm({ value, onChange, readOnly, issues }: ArtifactFormProps) {
  const draft = useMemo(() => coerce(value), [value]);
  const emit = (next: SitemapDraft) => onChange(toPayload(next));
  const slugs = useMemo(() => collectSlugs(draft.pages), [draft.pages]);

  return (
    <div className="flex flex-col gap-4">
      <FormSection
        title="Árbol de páginas"
        description="El primer nivel son las páginas raíz; los slugs deben ser únicos en todo el árbol."
      >
        {issueAt(issues, "pages") ? (
          <p role="alert" className="text-xs text-accent-danger">
            {issueAt(issues, "pages")}
          </p>
        ) : null}
        {draft.pages.map((node, index) => (
          <NodeEditor
            key={index}
            node={node}
            index={index}
            count={draft.pages.length}
            basePath={pathKey("pages", index)}
            depth={0}
            readOnly={readOnly}
            issues={issues}
            onChange={(next) => emit({ ...draft, pages: replaceAt(draft.pages, index, next) })}
            onMove={(delta) => emit({ ...draft, pages: moveItem(draft.pages, index, delta) })}
            onRemove={() => emit({ ...draft, pages: removeAt(draft.pages, index) })}
          />
        ))}
        <AddButton
          label="Añadir página raíz"
          disabled={readOnly}
          onClick={() => emit({ ...draft, pages: [...draft.pages, coerceNode(null)] })}
        />
      </FormSection>

      <FormSection
        title="Navegación"
        description="Referencia slugs existentes del árbol de páginas."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SlugListEditor
            label="Header"
            values={draft.navigation.header}
            options={slugs}
            readOnly={readOnly}
            basePath="navigation.header"
            issues={issues}
            onChange={(header) =>
              emit({ ...draft, navigation: { ...draft.navigation, header } })
            }
          />
          <SlugListEditor
            label="Footer"
            values={draft.navigation.footer}
            options={slugs}
            readOnly={readOnly}
            basePath="navigation.footer"
            issues={issues}
            onChange={(footer) =>
              emit({ ...draft, navigation: { ...draft.navigation, footer } })
            }
          />
        </div>
      </FormSection>
    </div>
  );
}
