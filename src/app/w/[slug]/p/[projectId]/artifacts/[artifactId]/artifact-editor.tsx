"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ActionResult } from "@/modules/artifacts/actions";
import {
  approveArtifactAction,
  lockArtifactAction,
  rejectArtifactAction,
  revalidateArtifactAction,
  saveDraftAction,
  submitForReviewAction,
  unlockArtifactAction,
} from "@/modules/artifacts/actions";
import type { ValidationIssue } from "@/modules/artifacts/errors";
import type { ComputedDiff } from "@/modules/artifacts/service";
import { getSpecOsFormEntry, toIssueMap, type IssueMap } from "@/modules/spec-os";
import {
  Button,
  EmptyState,
  Field,
  Modal,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  type ArtifactStatus,
} from "@/ui";

import { DiffPanel } from "./diff-panel";
import {
  HistoryPanel,
  type ApprovalListItem,
  type VersionListItem,
} from "./history-panel";

/** Vista serializable del artefacto para el editor (sin schemas Zod ni Dates). */
export interface EditorArtifact {
  id: string;
  type: string;
  label: string;
  status: ArtifactStatus;
  outdated: boolean;
  rejected: boolean;
  currentVersion: number;
  lockedBy: string | null;
  /** Hay draftPayload persistido en el servidor (requisito para enviar a revisión). */
  hasDraft: boolean;
}

export interface ArtifactEditorProps {
  artifact: EditorArtifact;
  /** draft persistido ?? última versión sellada ?? null (artefacto vacío). */
  initialPayload: unknown;
  /** Rol admin|member del workspace (humano interno, §13/§14). */
  canEdit: boolean;
  initialDiff: ComputedDiff;
  versions: VersionListItem[];
  approvals: ApprovalListItem[];
}

/**
 * Editor de artefacto de Spec OS (§19.6-b): tabs Editar / Diff / Historial y
 * barra de acciones del ciclo humano (§13). Las transiciones de estado las
 * ejecutan server actions del módulo artifacts; tras cada mutación se hace
 * `router.refresh()` para re-renderizar el estado del servidor.
 */
export function ArtifactEditor({
  artifact,
  initialPayload,
  canEdit,
  initialDiff,
  versions,
  approvals,
}: ArtifactEditorProps) {
  const router = useRouter();
  const entry = getSpecOsFormEntry(artifact.type);

  const [payload, setPayload] = useState<unknown>(
    () => initialPayload ?? entry?.createEmptyPayload() ?? {},
  );
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<IssueMap>({});
  const [issueList, setIssueList] = useState<ValidationIssue[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingApproved, setEditingApproved] = useState(false);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveComment, setApproveComment] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);

  const [pending, startTransition] = useTransition();

  // Al cambiar el estado en el servidor (tras refresh), salir del modo edición.
  // Patrón "adjust state during render" (React docs: you might not need an effect).
  const [prevStatus, setPrevStatus] = useState(artifact.status);
  if (prevStatus !== artifact.status) {
    setPrevStatus(artifact.status);
    setEditingApproved(false);
  }

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timeout);
  }, [notice]);

  function runAction<T>(
    fn: () => Promise<ActionResult<T>>,
    onOk?: (data: T) => void,
  ) {
    setActionError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setActionError(result.error);
        if (result.issues) {
          setIssueList(result.issues);
          setIssues(toIssueMap(result.issues));
        }
        return;
      }
      setIssueList([]);
      setIssues({});
      onOk?.(result.data);
      router.refresh();
    });
  }

  const handleSave = () =>
    runAction(
      () => saveDraftAction(artifact.id, payload),
      () => {
        setDirty(false);
        setNotice("Borrador guardado.");
      },
    );

  const handleSubmit = () =>
    runAction(
      () => submitForReviewAction(artifact.id),
      () => setNotice("Enviado a revisión."),
    );

  const handleApprove = () =>
    runAction(
      () => approveArtifactAction(artifact.id, approveComment.trim() || undefined),
      (data) => {
        setApproveOpen(false);
        setApproveComment("");
        const dependents = data.outdatedDependentIds.length;
        setNotice(
          `Versión v${data.version.version} aprobada.` +
            (dependents > 0
              ? ` ${dependents} dependiente${dependents === 1 ? "" : "s"} marcado${dependents === 1 ? "" : "s"} como desactualizado${dependents === 1 ? "" : "s"}.`
              : ""),
        );
      },
    );

  const handleReject = () =>
    runAction(
      () => rejectArtifactAction(artifact.id, rejectFeedback.trim()),
      () => {
        setRejectOpen(false);
        setRejectFeedback("");
        setNotice("Rechazado: el artefacto vuelve a borrador con el feedback registrado.");
      },
    );

  const handleRevalidate = () =>
    runAction(
      () => revalidateArtifactAction(artifact.id),
      () => setNotice("Revalidado sin cambios."),
    );

  const handleLock = () =>
    runAction(
      () => lockArtifactAction(artifact.id),
      () => setNotice("Artefacto bloqueado."),
    );

  const handleUnlock = () =>
    runAction(
      () => unlockArtifactAction(artifact.id),
      () => {
        setUnlockOpen(false);
        setNotice("Desbloqueado: los dependientes quedaron marcados como desactualizados.");
      },
    );

  const handleCancelEditing = () => {
    setPayload(initialPayload ?? entry?.createEmptyPayload() ?? {});
    setDirty(false);
    setEditingApproved(false);
    setIssues({});
    setIssueList([]);
  };

  const isEditableState = artifact.status === "empty" || artifact.status === "draft";
  const formEditable =
    canEdit && (isEditableState || (artifact.status === "approved" && editingApproved));

  const readOnlyReason = !canEdit
    ? "Solo lectura: tu rol no permite editar artefactos."
    : artifact.status === "in_review"
      ? "En revisión: apruébalo o recházalo para seguir editando."
      : artifact.status === "approved" && !editingApproved
        ? `Versión aprobada v${artifact.currentVersion}. Usa «Editar nueva versión» para proponer cambios.`
        : artifact.status === "locked"
          ? `Bloqueado (${artifact.lockedBy ?? "lock"}). Desbloquéalo explícitamente para editar; eso marcará sus dependientes como desactualizados.`
          : null;

  const FormComponent = entry?.Form;

  return (
    <div className="flex flex-col gap-4">
      {actionError ? (
        <div
          role="alert"
          className="rounded-md border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-sm text-accent-danger"
        >
          {actionError}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-md border border-accent-success/40 bg-accent-success/10 px-3 py-2 text-sm text-accent-success"
        >
          {notice}
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {formEditable ? (
            <Button variant="primary" disabled={pending || !dirty} onClick={handleSave}>
              Guardar borrador
            </Button>
          ) : null}
          {artifact.status === "draft" ? (
            <Button
              disabled={pending || dirty || !artifact.hasDraft}
              title={dirty ? "Guarda el borrador antes de enviarlo a revisión." : undefined}
              onClick={handleSubmit}
            >
              Enviar a revisión
            </Button>
          ) : null}
          {artifact.status === "in_review" ? (
            <>
              <Button variant="primary" disabled={pending} onClick={() => setApproveOpen(true)}>
                Aprobar…
              </Button>
              <Button variant="danger" disabled={pending} onClick={() => setRejectOpen(true)}>
                Rechazar…
              </Button>
            </>
          ) : null}
          {artifact.status === "approved" && !editingApproved ? (
            <>
              <Button variant="primary" disabled={pending} onClick={() => setEditingApproved(true)}>
                Editar nueva versión
              </Button>
              <Button variant="ghost" disabled={pending} onClick={handleLock}>
                Bloquear
              </Button>
            </>
          ) : null}
          {artifact.status === "approved" && editingApproved ? (
            <Button variant="ghost" disabled={pending} onClick={handleCancelEditing}>
              Descartar edición
            </Button>
          ) : null}
          {artifact.status === "locked" ? (
            <Button disabled={pending} onClick={() => setUnlockOpen(true)}>
              Desbloquear para editar…
            </Button>
          ) : null}
          {artifact.outdated ? (
            <Button
              disabled={pending}
              className="border-accent-warning/40 text-accent-warning hover:bg-accent-warning/10"
              onClick={handleRevalidate}
            >
              Revalidar sin cambios
            </Button>
          ) : null}
        </div>
      ) : null}

      <Tabs defaultValue="edit">
        <TabsList>
          <TabsTrigger value="edit">Editar</TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="history">
            Historial
            {versions.length > 0 ? (
              <span className="font-mono text-[11px] text-faint">({versions.length})</span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <div className="flex flex-col gap-3">
            {readOnlyReason ? <p className="text-xs text-muted">{readOnlyReason}</p> : null}

            {issueList.length > 0 ? (
              <div
                role="alert"
                className="rounded-md border border-accent-danger/40 bg-accent-danger/10 px-3 py-2"
              >
                <p className="text-xs font-medium text-accent-danger">
                  El contenido no supera la validación:
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {issueList.map((issue, index) => (
                    <li key={index} className="text-xs text-accent-danger">
                      <span className="font-mono">{issue.path || "payload"}</span> —{" "}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {FormComponent ? (
              <FormComponent
                value={payload}
                readOnly={!formEditable}
                issues={issues}
                onChange={(next) => {
                  setPayload(next);
                  setDirty(true);
                }}
              />
            ) : (
              <EmptyState
                title="Tipo de artefacto desconocido"
                description={`No hay formulario registrado para «${artifact.type}».`}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="diff">
          <DiffPanel
            artifactId={artifact.id}
            initialDiff={initialDiff}
            versionNumbers={versions.map((version) => version.version)}
          />
        </TabsContent>

        <TabsContent value="history">
          <HistoryPanel versions={versions} approvals={approvals} />
        </TabsContent>
      </Tabs>

      {/* Aprobación: acción humana explícita sobre una versión concreta (§8.5). */}
      <Modal
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={`Aprobar «${artifact.label}»`}
        description={`Se sellará la versión inmutable v${artifact.currentVersion + 1} y sus dependientes se marcarán como desactualizados (nunca se regeneran solos, §8.4).`}
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setApproveOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={pending} onClick={handleApprove}>
              {pending ? "Aprobando…" : `Aprobar v${artifact.currentVersion + 1}`}
            </Button>
          </>
        }
      >
        <Field label="Comentario" htmlFor="approve-comment" hint="Opcional; queda en el registro de aprobaciones.">
          <Textarea
            id="approve-comment"
            value={approveComment}
            disabled={pending}
            className="min-h-16"
            onChange={(event) => setApproveComment(event.target.value)}
          />
        </Field>
      </Modal>

      {/* Rechazo: vuelve a draft con feedback obligatorio (§8.2, §13). */}
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Rechazar «${artifact.label}»`}
        description="El artefacto vuelve a borrador con el flag de rechazo; el feedback queda en el registro de actividad."
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
          htmlFor="reject-feedback"
          required
          hint="Explica qué debe corregirse antes de volver a enviar a revisión."
        >
          <Textarea
            id="reject-feedback"
            value={rejectFeedback}
            disabled={pending}
            className="min-h-20"
            onChange={(event) => setRejectFeedback(event.target.value)}
          />
        </Field>
      </Modal>

      {/* Desbloqueo explícito (§8.2): marca dependientes outdated y queda auditado. */}
      <Modal
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        title={`Desbloquear «${artifact.label}»`}
        description="Editar un artefacto bloqueado exige desbloquearlo explícitamente."
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setUnlockOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={pending} onClick={handleUnlock}>
              {pending ? "Desbloqueando…" : "Desbloquear"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          El artefacto volverá a <span className="text-foreground">aprobado</span>, sus
          dependientes se marcarán como{" "}
          <span className="text-accent-warning">desactualizados</span> y la operación quedará
          en el audit log (§8.2).
        </p>
      </Modal>
    </div>
  );
}
