"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import {
  CheckCircle2,
  CornerDownRight,
  MessageSquareText,
  MonitorOff,
  SquareDashedMousePointer,
  TriangleAlert,
} from "lucide-react";

import {
  addClientApprovalAction,
  addClientCommentAction,
} from "@/modules/review/actions";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  cn,
} from "@/ui";

/**
 * Experiencia del CLIENTE (§3: sin onboarding; §13: revisa resultados, nunca
 * estructuras internas). Una sola isla client: selector de páginas, iframe
 * del deployment real, secciones clicables (ancla `#<sectionId>` en el
 * iframe), hilos de comentarios con estados y aprobación de la versión.
 *
 * El nombre se pide UNA vez y se guarda en localStorage; la identidad del
 * cliente es el label del enlace + el nombre que escribe (R8). Las mutaciones
 * van por server actions públicas validadas por token en la DB.
 */

const NAME_STORAGE_KEY = "aw-review-author-name";

// Nombre guardado como external store (localStorage): así la primera pasada
// SSR/hydration rinde "" sin mismatch y el valor real llega al re-render.
function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readStoredName(): string {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) ?? "";
  } catch {
    return ""; // localStorage no disponible: se pedirá el nombre cada vez
  }
}

export interface PublicSection {
  id: string;
  label: string;
}

export interface PublicPage {
  pageKey: string;
  path: string;
  title: string;
  sections: PublicSection[];
}

export interface PublicComment {
  id: string;
  pageKey: string;
  sectionId: string | null;
  parentId: string | null;
  authorKind: "client" | "team";
  authorName: string;
  body: string;
  status: "open" | "resolved";
  createdAtLabel: string;
}

export interface PublicApproval {
  id: string;
  pageKey: string | null;
  approvedName: string;
  comment: string | null;
  createdAtLabel: string;
}

export interface ReviewClientProps {
  token: string;
  projectName: string;
  round: {
    label: string;
    status: "open" | "closed";
    releaseNumber: number;
    createdAtLabel: string;
    closedAtLabel: string | null;
  };
  /** Slot que sirve el release ahora mismo, o null si no corre ninguno. */
  deployment: { slot: "production" | "preview"; url: string } | null;
  pages: PublicPage[];
  comments: PublicComment[];
  approvals: PublicApproval[];
}

// ---------------------------------------------------------------------------
// Piezas pequeñas
// ---------------------------------------------------------------------------

function CommentStatusBadge({ status }: { status: PublicComment["status"] }) {
  return status === "resolved" ? (
    <Badge tone="success">Resuelto</Badge>
  ) : (
    <Badge tone="warning">Abierto</Badge>
  );
}

function SectionChip({
  sectionId,
  label,
}: {
  sectionId: string;
  label: string | null;
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-surface-raised px-1.5 py-px text-[11px] leading-4 text-muted"
      title={label ?? undefined}
    >
      {label ? <span className="truncate">{label}</span> : null}
      <code className="shrink-0 font-mono text-[10px] text-faint">#{sectionId}</code>
    </span>
  );
}

function ErrorLine({ error }: { error: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-accent-danger">
      <TriangleAlert size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
      <span>{error}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function ReviewClient({
  token,
  projectName,
  round,
  deployment,
  pages,
  comments,
  approvals,
}: ReviewClientProps) {
  const router = useRouter();
  const isOpen = round.status === "open";

  // --- página y sección activas ---------------------------------------------
  const [currentPageKey, setCurrentPageKey] = useState(pages[0]?.pageKey ?? "");
  const [focusSectionId, setFocusSectionId] = useState<string | null>(null);
  // Re-monta el iframe al re-clicar la misma sección (el hash solo no recarga).
  const [iframeBump, setIframeBump] = useState(0);

  const currentPage = pages.find((page) => page.pageKey === currentPageKey) ?? null;

  // --- identidad ligera del cliente (R8) -------------------------------------
  // El nombre se pide UNA vez; localStorage es la fuente de verdad.
  const savedName = useSyncExternalStore(subscribeToStorage, readStoredName, () => "");
  const [editingName, setEditingName] = useState(false);
  const [, bumpNameVersion] = useState(0);
  const authorName = savedName.trim();
  const nameStored = authorName !== "" && !editingName;

  const rememberName = (name: string) => {
    try {
      localStorage.setItem(NAME_STORAGE_KEY, name.trim());
    } catch {
      /* no-op */
    }
    setEditingName(false);
    // El evento `storage` no se emite en la propia pestaña: fuerza re-lectura.
    bumpNameVersion((version) => version + 1);
  };

  // --- hilos por página -------------------------------------------------------
  const { rootsByPage, childrenByParent, openCountByPage } = useMemo(() => {
    const roots = new Map<string, PublicComment[]>();
    const children = new Map<string, PublicComment[]>();
    const openCount = new Map<string, number>();
    for (const comment of comments) {
      if (comment.status === "open") {
        openCount.set(comment.pageKey, (openCount.get(comment.pageKey) ?? 0) + 1);
      }
      if (comment.parentId) {
        const list = children.get(comment.parentId) ?? [];
        list.push(comment);
        children.set(comment.parentId, list);
      } else {
        const list = roots.get(comment.pageKey) ?? [];
        list.push(comment);
        roots.set(comment.pageKey, list);
      }
    }
    return { rootsByPage: roots, childrenByParent: children, openCountByPage: openCount };
  }, [comments]);

  /** Descendientes de un comentario raíz, aplanados en orden cronológico. */
  const collectReplies = (rootId: string): PublicComment[] => {
    const result: PublicComment[] = [];
    const queue = [...(childrenByParent.get(rootId) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift() as PublicComment;
      result.push(next);
      queue.push(...(childrenByParent.get(next.id) ?? []));
    }
    return result;
  };

  const sectionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of pages) {
      for (const section of page.sections) map.set(section.id, section.label);
    }
    return map;
  }, [pages]);

  // --- aprobación global ------------------------------------------------------
  const globalApprovals = approvals.filter((approval) => approval.pageKey == null);
  const lastApproval = globalApprovals[globalApprovals.length - 1] ?? null;
  const [approveOpen, setApproveOpen] = useState(false);

  // --- iframe -----------------------------------------------------------------
  const iframeSrc =
    deployment && currentPage
      ? `${deployment.url}${currentPage.path}${focusSectionId ? `#${focusSectionId}` : ""}`
      : null;

  const goToSection = (sectionId: string) => {
    setFocusSectionId(sectionId);
    setIframeBump((bump) => bump + 1);
  };

  const switchPage = (pageKey: string) => {
    setCurrentPageKey(pageKey);
    setFocusSectionId(null);
    setIframeBump((bump) => bump + 1);
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Header sobrio: proyecto + ronda + versión + aprobar (§13) */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] tracking-widest text-faint uppercase">
            Revisión de proyecto
          </p>
          <h1 className="truncate text-base font-semibold tracking-tight">
            {projectName}
            <span className="ml-2 font-normal text-muted">· {round.label}</span>
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge>Versión {round.releaseNumber}</Badge>
          {deployment ? (
            <Badge tone="action">
              {deployment.slot === "preview" ? "Vista previa en vivo" : "Producción en vivo"}
            </Badge>
          ) : (
            <Badge tone="warning">Vista no disponible</Badge>
          )}
          {!isOpen ? <Badge>Ronda cerrada</Badge> : null}
          {isOpen && !lastApproval ? (
            <Button variant="primary" size="sm" onClick={() => setApproveOpen(true)}>
              <CheckCircle2 size={13} strokeWidth={2} aria-hidden />
              Aprobar esta versión
            </Button>
          ) : null}
        </div>
      </header>

      {/* Banner post-aprobación */}
      {lastApproval ? (
        <div className="flex items-start gap-2 border-b border-accent-success/40 bg-accent-success/10 px-5 py-2.5">
          <CheckCircle2
            size={15}
            strokeWidth={2}
            className="mt-px shrink-0 text-accent-success"
            aria-hidden
          />
          <p className="text-xs text-foreground">
            <span className="font-medium">{lastApproval.approvedName}</span> aprobó esta
            versión el {lastApproval.createdAtLabel}.
            {lastApproval.comment ? (
              <span className="text-muted"> «{lastApproval.comment}»</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {/* Aviso de ronda cerrada (solo lectura) */}
      {!isOpen ? (
        <div className="flex items-start gap-2 border-b border-border bg-surface-raised px-5 py-2.5">
          <TriangleAlert
            size={15}
            strokeWidth={2}
            className="mt-px shrink-0 text-accent-warning"
            aria-hidden
          />
          <p className="text-xs text-muted">
            Esta ronda de revisión se cerró
            {round.closedAtLabel ? ` el ${round.closedAtLabel}` : ""}. Puedes consultar
            todo, pero ya no se aceptan comentarios ni aprobaciones — si necesitas seguir,
            pide a la agencia un enlace nuevo.
          </p>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Vista de la página: tabs + iframe del deployment real (§16) */}
        <main className="flex min-w-0 flex-1 flex-col">
          <nav
            aria-label="Páginas de la revisión"
            className="flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2"
          >
            {pages.map((page) => {
              const active = page.pageKey === currentPageKey;
              const openCount = openCountByPage.get(page.pageKey) ?? 0;
              return (
                <button
                  key={page.pageKey}
                  type="button"
                  onClick={() => switchPage(page.pageKey)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-[13px] transition-colors",
                    active
                      ? "bg-surface-raised font-medium text-foreground"
                      : "text-muted hover:bg-surface-raised hover:text-foreground",
                  )}
                >
                  {page.title}
                  {openCount > 0 ? (
                    <span className="rounded-full border border-accent-warning/40 px-1.5 font-mono text-[10px] leading-4 text-accent-warning tabular-nums">
                      {openCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="relative min-h-0 flex-1 bg-surface-raised">
            {iframeSrc ? (
              <iframe
                key={`${currentPageKey}:${focusSectionId ?? ""}:${iframeBump}`}
                src={iframeSrc}
                title={currentPage ? `Vista de ${currentPage.title}` : "Vista de la página"}
                className="absolute inset-0 h-full w-full border-0 bg-white"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <MonitorOff size={24} strokeWidth={1.5} className="text-faint" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    La vista previa no está disponible ahora mismo
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                    La agencia debe arrancar la vista previa de esta versión. Mientras
                    tanto puedes seguir leyendo y dejando comentarios sobre las páginas y
                    secciones — nada se pierde.
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Sidebar: secciones + comentarios + nuevo comentario */}
        <aside className="flex w-90 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface">
          {currentPage && currentPage.sections.length > 0 ? (
            <section className="border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-muted uppercase">
                <SquareDashedMousePointer size={12} strokeWidth={2} aria-hidden />
                Secciones de esta página
              </h2>
              <ul className="mt-2 flex flex-col gap-0.5">
                {currentPage.sections.map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => goToSection(section.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors",
                        focusSectionId === section.id
                          ? "bg-surface-raised font-medium text-foreground"
                          : "text-muted hover:bg-surface-raised hover:text-foreground",
                      )}
                      title={
                        deployment
                          ? "Ir a esta sección en la vista"
                          : "La vista no está disponible; aun así puedes comentar esta sección"
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">{section.label}</span>
                      <code className="shrink-0 font-mono text-[10px] text-faint">
                        #{section.id}
                      </code>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-muted uppercase">
              <MessageSquareText size={12} strokeWidth={2} aria-hidden />
              Comentarios
              {currentPage ? (
                <span className="font-mono text-[10px] text-faint normal-case">
                  · {currentPage.title}
                </span>
              ) : null}
            </h2>

            <div className="mt-2 flex flex-col gap-3">
              {(currentPage ? (rootsByPage.get(currentPage.pageKey) ?? []) : []).map(
                (root) => (
                  <CommentThread
                    key={root.id}
                    token={token}
                    root={root}
                    replies={collectReplies(root.id)}
                    sectionLabel={
                      root.sectionId ? (sectionLabelById.get(root.sectionId) ?? null) : null
                    }
                    canReply={isOpen}
                    authorName={authorName}
                    nameStored={nameStored}
                    onNameConfirmed={rememberName}
                    onMutated={() => router.refresh()}
                  />
                ),
              )}
              {currentPage && (rootsByPage.get(currentPage.pageKey) ?? []).length === 0 ? (
                <p className="rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted">
                  Esta página aún no tiene comentarios.
                  {isOpen ? " Sé quien rompa el hielo." : ""}
                </p>
              ) : null}
            </div>

            {isOpen && currentPage ? (
              <NewCommentForm
                key={currentPage.pageKey}
                token={token}
                page={currentPage}
                focusSectionId={focusSectionId}
                authorName={authorName}
                nameStored={nameStored}
                onNameConfirmed={rememberName}
                onChangeName={() => setEditingName(true)}
                onCreated={() => router.refresh()}
              />
            ) : null}
          </section>
        </aside>
      </div>

      {/* Modal de aprobación: client_approval GLOBAL de la ronda (§8.5) */}
      <ApproveModal
        key={authorName}
        token={token}
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        releaseNumber={round.releaseNumber}
        defaultName={authorName}
        onApproved={(name) => {
          rememberName(name);
          setApproveOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hilo de comentarios (raíz + respuestas aplanadas)
// ---------------------------------------------------------------------------

function CommentBody({
  comment,
  sectionLabel,
  isReply,
}: {
  comment: PublicComment;
  sectionLabel: string | null;
  isReply: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1", isReply && "pl-5")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {isReply ? (
          <CornerDownRight size={12} strokeWidth={2} className="-ml-5 text-faint" aria-hidden />
        ) : null}
        <span className="text-xs font-medium text-foreground">{comment.authorName}</span>
        {comment.authorKind === "team" ? <Badge tone="action">Agencia</Badge> : null}
        <span className="text-[11px] text-faint">{comment.createdAtLabel}</span>
        {!isReply ? <CommentStatusBadge status={comment.status} /> : null}
      </div>
      {!isReply && comment.sectionId ? (
        <SectionChip sectionId={comment.sectionId} label={sectionLabel} />
      ) : null}
      <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
        {comment.body}
      </p>
    </div>
  );
}

function CommentThread({
  token,
  root,
  replies,
  sectionLabel,
  canReply,
  authorName,
  nameStored,
  onNameConfirmed,
  onMutated,
}: {
  token: string;
  root: PublicComment;
  replies: PublicComment[];
  sectionLabel: string | null;
  canReply: boolean;
  authorName: string;
  nameStored: boolean;
  onNameConfirmed: (name: string) => void;
  onMutated: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [name, setName] = useState(authorName);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // El input local solo manda cuando el nombre aún no está guardado (R8).
  const effectiveName = nameStored ? authorName : name;

  const submitReply = () => {
    startTransition(async () => {
      const result = await addClientCommentAction(token, {
        pageKey: root.pageKey,
        parentId: root.id,
        sectionId: null,
        authorName: effectiveName,
        body,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onNameConfirmed(effectiveName);
      setBody("");
      setError(null);
      setReplying(false);
      onMutated();
    });
  };

  return (
    <article className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised/50 p-3">
      <CommentBody comment={root} sectionLabel={sectionLabel} isReply={false} />
      {replies.map((reply) => (
        <CommentBody key={reply.id} comment={reply} sectionLabel={null} isReply />
      ))}

      {canReply ? (
        replying ? (
          <div className="flex flex-col gap-2 border-t border-border pt-2">
            {!nameStored ? (
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Tu nombre"
                aria-label="Tu nombre"
              />
            ) : null}
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Escribe tu respuesta…"
              aria-label="Respuesta"
              className="min-h-14"
            />
            {error ? <ErrorLine error={error} /> : null}
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={submitReply}
                disabled={pending || body.trim() === "" || effectiveName.trim() === ""}
                aria-busy={pending}
              >
                {pending ? "Enviando…" : "Responder"}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="self-start text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Responder
          </button>
        )
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Nuevo comentario (nombre una sola vez; sección opcional del release)
// ---------------------------------------------------------------------------

function NewCommentForm({
  token,
  page,
  focusSectionId,
  authorName,
  nameStored,
  onNameConfirmed,
  onChangeName,
  onCreated,
}: {
  token: string;
  page: PublicPage;
  /** Sección enfocada en la vista: preselecciona el selector del formulario. */
  focusSectionId: string | null;
  authorName: string;
  nameStored: boolean;
  onNameConfirmed: (name: string) => void;
  onChangeName: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState(authorName);
  const [body, setBody] = useState("");
  const [sectionId, setSectionId] = useState<string>(focusSectionId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // El input local solo manda cuando el nombre aún no está guardado (R8).
  const effectiveName = nameStored ? authorName : name;

  // Enfocar una sección en la vista preselecciona el selector (ajuste de
  // estado durante el render — patrón sin useEffect; el cambio de página
  // resetea por `key={page.pageKey}` en el llamante).
  const [lastFocus, setLastFocus] = useState(focusSectionId);
  if (lastFocus !== focusSectionId) {
    setLastFocus(focusSectionId);
    if (focusSectionId) setSectionId(focusSectionId);
  }

  const submit = () => {
    startTransition(async () => {
      const result = await addClientCommentAction(token, {
        pageKey: page.pageKey,
        sectionId: sectionId === "" ? null : sectionId,
        parentId: null,
        authorName: effectiveName,
        body,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onNameConfirmed(effectiveName);
      setBody("");
      setError(null);
      onCreated();
    });
  };

  return (
    <div className="mt-4 flex flex-col gap-2.5 border-t border-border pt-3">
      <h3 className="text-[11px] font-medium tracking-wider text-muted uppercase">
        Nuevo comentario
      </h3>

      {nameStored ? (
        <p className="text-xs text-muted">
          Comentas como <span className="font-medium text-foreground">{authorName}</span>{" "}
          <button
            type="button"
            onClick={onChangeName}
            className="text-faint underline underline-offset-2 transition-colors hover:text-foreground"
          >
            cambiar
          </button>
        </p>
      ) : (
        <Field label="Tu nombre" htmlFor="review-author-name" required>
          <Input
            id="review-author-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="P. ej. Marta de Acme"
            autoComplete="name"
          />
        </Field>
      )}

      {page.sections.length > 0 ? (
        <Field
          label="Sección (opcional)"
          htmlFor="review-comment-section"
          hint="Ancla el comentario a una parte concreta de la página."
        >
          <Select
            id="review-comment-section"
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
          >
            <option value="">Toda la página</option>
            {page.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Comentario" htmlFor="review-comment-body" required>
        <Textarea
          id="review-comment-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="¿Qué te gustaría cambiar o destacar?"
        />
      </Field>

      {error ? <ErrorLine error={error} /> : null}

      <Button
        variant="primary"
        onClick={submit}
        disabled={pending || body.trim() === "" || effectiveName.trim() === ""}
        aria-busy={pending}
        className="self-end"
      >
        {pending ? "Enviando…" : "Enviar comentario"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal de aprobación de la versión (client_approval global, §8.5)
// ---------------------------------------------------------------------------

function ApproveModal({
  token,
  open,
  onClose,
  releaseNumber,
  defaultName,
  onApproved,
}: {
  token: string;
  open: boolean;
  onClose: () => void;
  releaseNumber: number;
  defaultName: string;
  onApproved: (name: string) => void;
}) {
  // El llamante re-monta el modal cuando cambia el nombre guardado
  // (`key={authorName}`), así que el estado inicial siempre está al día.
  const [name, setName] = useState(defaultName);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await addClientApprovalAction(token, {
        name,
        comment: comment.trim() === "" ? null : comment,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setComment("");
      onApproved(name.trim());
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Aprobar la versión ${releaseNumber}`}
      description="Tu aprobación queda registrada con tu nombre, sobre esta versión exacta del sitio."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={pending || name.trim() === ""}
            aria-busy={pending}
          >
            <CheckCircle2 size={14} strokeWidth={2} aria-hidden />
            {pending ? "Registrando…" : "Aprobar esta versión"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Tu nombre" htmlFor="approve-name" required>
          <Input
            id="approve-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="P. ej. Marta de Acme"
            autoComplete="name"
          />
        </Field>
        <Field label="Comentario (opcional)" htmlFor="approve-comment">
          <Textarea
            id="approve-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Algo que quieras dejar dicho junto a la aprobación…"
            className="min-h-16"
          />
        </Field>
        {error ? <ErrorLine error={error} /> : null}
      </div>
    </Modal>
  );
}
