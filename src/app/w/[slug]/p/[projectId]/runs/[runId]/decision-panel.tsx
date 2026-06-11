"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";

import type { ActionResult } from "@/modules/artifacts/actions";
import {
  approveArtifactAction,
  rejectArtifactAction,
  submitForReviewAction,
} from "@/modules/artifacts/actions";
import { Button, Field, Modal, Textarea, type ArtifactStatus } from "@/ui";

/**
 * DECISIÓN sobre la propuesta del run (§13 paso 5, §19): este panel es donde
 * se demuestra que el humano decide. REUSA las server actions del módulo
 * artifacts — el actor es SIEMPRE el usuario de sesión con rol; no existe
 * ningún camino por el que el run se apruebe a sí mismo.
 *
 * La propuesta vive como draft del artefacto target (§8.6). Aprobar un draft
 * propuesto = `submitForReviewAction` (si aún está en draft) +
 * `approveArtifactAction`: el sellado lleva origin `agent_run` + agentRunId
 * (§8.3) y la fila del run registra decididor/fecha/versión, todo en la
 * transacción de artifacts. Rechazar registra el feedback en el run (§9.6).
 */

export interface DecisionPanelProps {
  /** Artefacto target cuya draft ES la propuesta. */
  artifactId: string;
  artifactLabel: string;
  /** Estado actual del artefacto (draft = falta enviar a revisión al aprobar). */
  artifactStatus: ArtifactStatus;
  /** Versión que sellará la aprobación (currentVersion + 1). */
  nextVersion: number;
  /** Editor del target: editar-y-aprobar (§13) — Spec OS o Studio según tipo. */
  editorHref: string;
}

export function DecisionPanel({
  artifactId,
  artifactLabel,
  artifactStatus,
  nextVersion,
  editorHref,
}: DecisionPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveComment, setApproveComment] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");

  /** El draft propuesto debe estar `in_review` para decidir (§8.2). */
  async function ensureInReview(): Promise<string | null> {
    if (artifactStatus !== "draft") return null;
    const result: ActionResult<unknown> = await submitForReviewAction(artifactId);
    return result.ok ? null : result.error;
  }

  const handleApprove = () => {
    setError(null);
    startTransition(async () => {
      const submitError = await ensureInReview();
      if (submitError) {
        setError(submitError);
        router.refresh();
        return;
      }
      const result = await approveArtifactAction(
        artifactId,
        approveComment.trim() || undefined,
      );
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      setApproveOpen(false);
      router.refresh();
    });
  };

  const handleReject = () => {
    setError(null);
    startTransition(async () => {
      const submitError = await ensureInReview();
      if (submitError) {
        setError(submitError);
        router.refresh();
        return;
      }
      const result = await rejectArtifactAction(artifactId, rejectFeedback.trim());
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      setRejectOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-xs text-accent-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => setApproveOpen(true)}>
          Aprobar propuesta…
        </Button>
        <Button variant="danger" size="sm" disabled={pending} onClick={() => setRejectOpen(true)}>
          Rechazar…
        </Button>
        <Link
          href={editorHref}
          className="inline-flex h-7 items-center gap-1.5 rounded border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-raised"
        >
          <PencilLine size={13} strokeWidth={1.75} aria-hidden />
          Abrir en editor
        </Link>
      </div>
      <p className="text-[11px] text-faint">
        Aprobar sella la versión inmutable{" "}
        <span className="font-mono tabular-nums">v{nextVersion}</span> con origen{" "}
        <span className="font-mono">agent_run</span> y tu firma como decisión humana (§8.3).
        «Abrir en editor» permite editar-y-aprobar (§13).
      </p>

      <Modal
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={`Aprobar la propuesta para «${artifactLabel}»`}
        description={`Se sellará la versión inmutable v${nextVersion} (origen: agent_run + id del run) y los dependientes se marcarán como desactualizados — nunca se regeneran solos (§8.4).`}
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setApproveOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={pending} onClick={handleApprove}>
              {pending ? "Aprobando…" : `Aprobar v${nextVersion}`}
            </Button>
          </>
        }
      >
        <Field
          label="Comentario"
          htmlFor="run-approve-comment"
          hint="Opcional; queda en el registro de aprobaciones."
        >
          <Textarea
            id="run-approve-comment"
            value={approveComment}
            disabled={pending}
            className="min-h-16"
            onChange={(event) => setApproveComment(event.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Rechazar la propuesta para «${artifactLabel}»`}
        description="El artefacto vuelve a borrador con el flag de rechazo y el run queda registrado como rechazado con tu feedback (§9.6)."
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setRejectOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={pending || rejectFeedback.trim() === ""}
              onClick={handleReject}
            >
              {pending ? "Rechazando…" : "Rechazar con feedback"}
            </Button>
          </>
        }
      >
        <Field
          label="Feedback"
          htmlFor="run-reject-feedback"
          required
          hint="Explica qué falla en la propuesta; queda asociado al run y guía la siguiente iteración."
        >
          <Textarea
            id="run-reject-feedback"
            value={rejectFeedback}
            disabled={pending}
            className="min-h-20"
            onChange={(event) => setRejectFeedback(event.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}
