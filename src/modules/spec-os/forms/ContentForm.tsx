"use client";

import { useMemo } from "react";

import type { ContentPagePayload } from "@/modules/artifacts/types";
import { Field, Input, Textarea } from "@/ui";

import { asArray, asObject, asString, asStringArray, optionalString } from "./coerce";
import { AddButton, FormSection, RowControls, StringListEditor } from "./controls";
import { moveItem, removeAt, replaceAt } from "./list-utils";
import { issueAt, pathKey, type ArtifactFormProps, type IssueMap } from "./types";

interface SectionDraft {
  id: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}

interface PageDraft {
  slug: string;
  title: string;
  sections: SectionDraft[];
  seo: { title: string; description: string; keywords: string[] };
}

interface ContentDraft {
  keyMessages: string[];
  pages: PageDraft[];
}

function coerceSection(value: unknown): SectionDraft {
  const v = asObject(value);
  const cta = asObject(v.cta);
  return {
    id: asString(v.id),
    heading: asString(v.heading),
    body: asString(v.body),
    ctaLabel: asString(cta.label),
    ctaHref: asString(cta.href),
  };
}

function coercePage(value: unknown): PageDraft {
  const v = asObject(value);
  const seo = asObject(v.seo);
  return {
    slug: asString(v.slug),
    title: asString(v.title),
    sections: asArray(v.sections).map(coerceSection),
    seo: {
      title: asString(seo.title),
      description: asString(seo.description),
      keywords: asStringArray(seo.keywords),
    },
  };
}

function coerce(value: unknown): ContentDraft {
  const v = asObject(value);
  return {
    keyMessages: asStringArray(v.keyMessages),
    pages: asArray(v.pages).map(coercePage),
  };
}

function toPayload(draft: ContentDraft): ContentPagePayload {
  return {
    keyMessages: draft.keyMessages,
    pages: draft.pages.map((page) => ({
      slug: page.slug,
      title: page.title,
      sections: page.sections.map((section) => ({
        id: section.id,
        heading: optionalString(section.heading),
        body: optionalString(section.body),
        // El CTA solo existe si alguno de sus campos tiene contenido; Zod
        // exigirá entonces ambos (label y href).
        cta:
          section.ctaLabel.trim() !== "" || section.ctaHref.trim() !== ""
            ? { label: section.ctaLabel, href: section.ctaHref }
            : undefined,
      })),
      seo: {
        title: page.seo.title,
        description: page.seo.description,
        keywords: page.seo.keywords,
      },
    })),
  };
}

export function createEmptyContentPayload(): ContentPagePayload {
  return toPayload(coerce(null));
}

/** Identificador estable para secciones nuevas (alinea diffs entre versiones). */
function newSectionId(): string {
  return `sec-${Math.random().toString(36).slice(2, 7)}`;
}

function SectionEditor({
  section,
  index,
  count,
  basePath,
  readOnly,
  issues,
  onChange,
  onMove,
  onRemove,
}: {
  section: SectionDraft;
  index: number;
  count: number;
  basePath: string;
  readOnly: boolean;
  issues: IssueMap;
  onChange: (section: SectionDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const idError = issues[pathKey(basePath, "id")];
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-start gap-1.5">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Field
            label="ID de sección"
            required
            error={idError}
            hint="Identificador estable (alinea diffs)."
          >
            <Input
              value={section.id}
              disabled={readOnly}
              invalid={!!idError}
              className="font-mono"
              onChange={(event) => onChange({ ...section, id: event.target.value })}
            />
          </Field>
          <Field label="Encabezado" error={issues[pathKey(basePath, "heading")]}>
            <Input
              value={section.heading}
              disabled={readOnly}
              onChange={(event) => onChange({ ...section, heading: event.target.value })}
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
      <div className="mt-3 flex flex-col gap-3">
        <Field label="Cuerpo" error={issues[pathKey(basePath, "body")]}>
          <Textarea
            value={section.body}
            disabled={readOnly}
            className="min-h-16"
            onChange={(event) => onChange({ ...section, body: event.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CTA — texto" error={issues[pathKey(basePath, "cta", "label")]}>
            <Input
              value={section.ctaLabel}
              disabled={readOnly}
              invalid={!!issues[pathKey(basePath, "cta", "label")]}
              placeholder="p.ej. Agenda una demo"
              onChange={(event) => onChange({ ...section, ctaLabel: event.target.value })}
            />
          </Field>
          <Field label="CTA — enlace" error={issues[pathKey(basePath, "cta", "href")]}>
            <Input
              value={section.ctaHref}
              disabled={readOnly}
              invalid={!!issues[pathKey(basePath, "cta", "href")]}
              className="font-mono"
              placeholder="/contacto"
              onChange={(event) => onChange({ ...section, ctaHref: event.target.value })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

/** `content.page` — mensajes clave, copies por página y SEO básico (§7.2). */
export function ContentForm({ value, onChange, readOnly, issues }: ArtifactFormProps) {
  const draft = useMemo(() => coerce(value), [value]);
  const emit = (next: ContentDraft) => onChange(toPayload(next));

  return (
    <div className="flex flex-col gap-4">
      <FormSection title="Mensajes clave" description="Transversales a todo el proyecto.">
        <StringListEditor
          label="Mensajes clave"
          values={draft.keyMessages}
          readOnly={readOnly}
          basePath="keyMessages"
          issues={issues}
          addLabel="Añadir mensaje"
          onChange={(keyMessages) => emit({ ...draft, keyMessages })}
        />
      </FormSection>

      {issueAt(issues, "pages") ? (
        <p role="alert" className="text-xs text-accent-danger">
          {issueAt(issues, "pages")}
        </p>
      ) : null}

      {draft.pages.map((page, pageIndex) => {
        const pagePath = pathKey("pages", pageIndex);
        const updatePage = (next: PageDraft) =>
          emit({ ...draft, pages: replaceAt(draft.pages, pageIndex, next) });
        return (
          <FormSection
            key={pageIndex}
            title={`Página ${pageIndex + 1}${page.slug ? ` · /${page.slug}` : ""}`}
          >
            <div className="flex items-start gap-1.5">
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Slug"
                  required
                  error={issues[pathKey(pagePath, "slug")]}
                  hint="Debe corresponder a una página del sitemap."
                >
                  <Input
                    value={page.slug}
                    disabled={readOnly}
                    invalid={!!issues[pathKey(pagePath, "slug")]}
                    className="font-mono"
                    onChange={(event) => updatePage({ ...page, slug: event.target.value })}
                  />
                </Field>
                <Field label="Título" required error={issues[pathKey(pagePath, "title")]}>
                  <Input
                    value={page.title}
                    disabled={readOnly}
                    invalid={!!issues[pathKey(pagePath, "title")]}
                    onChange={(event) => updatePage({ ...page, title: event.target.value })}
                  />
                </Field>
              </div>
              <RowControls
                index={pageIndex}
                count={draft.pages.length}
                disabled={readOnly}
                onMove={(delta) =>
                  emit({ ...draft, pages: moveItem(draft.pages, pageIndex, delta) })
                }
                onRemove={() => emit({ ...draft, pages: removeAt(draft.pages, pageIndex) })}
              />
            </div>

            <p className="font-mono text-[11px] tracking-widest text-faint uppercase">
              Secciones
            </p>
            {page.sections.map((section, sectionIndex) => (
              <SectionEditor
                key={sectionIndex}
                section={section}
                index={sectionIndex}
                count={page.sections.length}
                basePath={pathKey(pagePath, "sections", sectionIndex)}
                readOnly={readOnly}
                issues={issues}
                onChange={(next) =>
                  updatePage({ ...page, sections: replaceAt(page.sections, sectionIndex, next) })
                }
                onMove={(delta) =>
                  updatePage({ ...page, sections: moveItem(page.sections, sectionIndex, delta) })
                }
                onRemove={() =>
                  updatePage({ ...page, sections: removeAt(page.sections, sectionIndex) })
                }
              />
            ))}
            <AddButton
              label="Añadir sección"
              disabled={readOnly}
              onClick={() =>
                updatePage({
                  ...page,
                  sections: [...page.sections, { ...coerceSection(null), id: newSectionId() }],
                })
              }
            />

            <p className="font-mono text-[11px] tracking-widest text-faint uppercase">SEO</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="SEO — título"
                required
                error={issues[pathKey(pagePath, "seo", "title")]}
              >
                <Input
                  value={page.seo.title}
                  disabled={readOnly}
                  invalid={!!issues[pathKey(pagePath, "seo", "title")]}
                  onChange={(event) =>
                    updatePage({ ...page, seo: { ...page.seo, title: event.target.value } })
                  }
                />
              </Field>
              <Field
                label="SEO — descripción"
                required
                error={issues[pathKey(pagePath, "seo", "description")]}
              >
                <Input
                  value={page.seo.description}
                  disabled={readOnly}
                  invalid={!!issues[pathKey(pagePath, "seo", "description")]}
                  onChange={(event) =>
                    updatePage({
                      ...page,
                      seo: { ...page.seo, description: event.target.value },
                    })
                  }
                />
              </Field>
            </div>
            <StringListEditor
              label="SEO — keywords"
              values={page.seo.keywords}
              readOnly={readOnly}
              basePath={pathKey(pagePath, "seo", "keywords")}
              issues={issues}
              addLabel="Añadir keyword"
              onChange={(keywords) => updatePage({ ...page, seo: { ...page.seo, keywords } })}
            />
          </FormSection>
        );
      })}

      <AddButton
        label="Añadir página"
        disabled={readOnly}
        onClick={() => emit({ ...draft, pages: [...draft.pages, coercePage(null)] })}
      />
    </div>
  );
}
