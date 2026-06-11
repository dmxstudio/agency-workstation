"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCheck, CornerDownRight, TriangleAlert } from "lucide-react";

import {
  addTeamCommentAction,
  resolveCommentAction,
} from "@/modules/review/actions";
import { Badge, Button, Textarea, cn } from "@/ui";

/**
 * Hilos de una página dentro de una ronda (cara interna, §7.7): responder
 * como equipo y resolver comentarios. Resolver cierra la tarea derivada del
 * comentario de cliente (§12.2) — la tarea refleja estado real, nunca miente.
 * Responder exige ronda abierta; resolver se permite también con la ronda
 * cerrada (el feedback pendiente sigue siendo trabajo real).
 */

export interface InternalComment {
  id: string;
  sectionId: string | null;
  /** Etiqueta humana de la sección sellada (si se pudo resolver). */
  sectionLabel: string | null;
  authorKind: "client" | "team";
  authorName: string;
  body: string;
  status: "open" | "resolved";
  createdAtLabel: string;
}

export interface InternalThread {
  root: InternalComment;
  /** Descendientes aplanados en orden cronológico. */
  replies: InternalComment[];
}

function ErrorLine({ error }: { error: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-accent-danger">
      <TriangleAlert size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
      <span>{error}</span>
    </p>
  );
}

function ResolveButton({
  commentId,
  onError,
}: {
  commentId: string;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const resolve = () => {
    startTransition(async () => {
      const result = await resolveCommentAction(commentId);
      if (!result.ok) {
        onError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={resolve}
      disabled={pending}
      aria-busy={pending}
      title="Marca el comentario como resuelto y cierra su tarea derivada (§12.2)"
    >
      <CheckCheck size={13} strokeWidth={2} aria-hidden />
      {pending ? "Resolviendo…" : "Resolver"}
    </Button>
  );
}

function CommentRow({
  comment,
  isReply,
  canResolve,
  onError,
}: {
  comment: InternalComment;
  isReply: boolean;
  canResolve: boolean;
  onError: (message: string) => void;
}) {
  return (
    <div className={cn("flex flex-col gap-1", isReply && "pl-5")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {isReply ? (
          <CornerDownRight size={12} strokeWidth={2} className="-ml-5 text-faint" aria-hidden />
        ) : null}
        <span className="text-xs font-medium text-foreground">{comment.authorName}</span>
        {comment.authorKind === "team" ? (
          <Badge tone="action">Equipo</Badge>
        ) : (
          <Badge>Cliente</Badge>
        )}
        <span className="text-[11px] text-faint">{comment.createdAtLabel}</span>
        {comment.status === "resolved" ? (
          <Badge tone="success">Resuelto</Badge>
        ) : (
          <Badge tone="warning">Abierto</Badge>
        )}
        {comment.status === "open" && canResolve ? (
          <span className="ml-auto">
            <ResolveButton commentId={comment.id} onError={onError} />
          </span>
        ) : null}
      </div>
      {comment.sectionId ? (
        <span className="inline-flex max-w-full items-center gap-1 self-start rounded-sm border border-border bg-surface-raised px-1.5 py-px text-[11px] leading-4 text-muted">
          {comment.sectionLabel ? (
            <span className="truncate">{comment.sectionLabel}</span>
          ) : null}
          <code className="shrink-0 font-mono text-[10px] text-faint">
            #{comment.sectionId}
          </code>
        </span>
      ) : null}
      <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
        {comment.body}
      </p>
    </div>
  );
}

function ThreadCard({
  requestId,
  pageKey,
  thread,
  canEdit,
  roundOpen,
}: {
  requestId: string;
  pageKey: string;
  thread: InternalThread;
  canEdit: boolean;
  roundOpen: boolean;
}) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submitReply = () => {
    startTransition(async () => {
      const result = await addTeamCommentAction(requestId, {
        pageKey,
        parentId: thread.root.id,
        sectionId: null,
        body,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
      setError(null);
      setReplying(false);
      router.refresh();
    });
  };

  return (
    <article className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised/50 p-3">
      <CommentRow
        comment={thread.root}
        isReply={false}
        canResolve={canEdit}
        onError={setError}
      />
      {thread.replies.map((reply) => (
        <CommentRow
          key={reply.id}
          comment={reply}
          isReply
          canResolve={canEdit}
          onError={setError}
        />
      ))}

      {error ? <ErrorLine error={error} /> : null}

      {canEdit && roundOpen ? (
        replying ? (
          <div className="flex flex-col gap-2 border-t border-border pt-2">
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Responder como equipo…"
              aria-label="Respuesta del equipo"
              className="min-h-14"
            />
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={submitReply}
                disabled={pending || body.trim() === ""}
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
            Responder como equipo
          </button>
        )
      ) : null}
    </article>
  );
}

export function PageThreads({
  requestId,
  pageKey,
  threads,
  canEdit,
  roundOpen,
}: {
  requestId: string;
  pageKey: string;
  threads: InternalThread[];
  canEdit: boolean;
  roundOpen: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {threads.map((thread) => (
        <ThreadCard
          key={thread.root.id}
          requestId={requestId}
          pageKey={pageKey}
          thread={thread}
          canEdit={canEdit}
          roundOpen={roundOpen}
        />
      ))}
    </div>
  );
}
