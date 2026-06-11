"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Puck,
  type Data,
  type Overrides,
  type Permissions,
} from "@puckeditor/core";
import "@puckeditor/core/puck.css";

import type { ActionResult } from "@/modules/artifacts/actions";
import {
  approveArtifactAction,
  rejectArtifactAction,
  revalidateArtifactAction,
  saveDraftAction,
  submitForReviewAction,
} from "@/modules/artifacts/actions";
import type {
  CmsCollectionsPayload,
  DesignTokensPayload,
  PageCompositionPayload,
} from "@/modules/artifacts";
import type { ComputedDiff } from "@/modules/artifacts/service";
import { Button, Field, Modal, Textarea } from "@/ui";

import {
  createPuckConfig,
  editorViewports,
  studioCanvasCss,
  type StudioNavDefaults,
} from "../registry";
import { createApprovalPlugin, HeaderSaveIndicator } from "./approval-panel";
import { CanvasIframeStyles } from "./canvas-iframe-styles";
import { StudioEditorContext, type StudioEditorContextValue } from "./context";
import { StudioDiffPanel } from "./diff-panel";
import type { DraftSaveState, StudioArtifactView } from "./types";

/**
 * Island client del editor del Visual Studio (§7.4, §11.2): `<Puck>` sobre el
 * registry de la plataforma + ciclo §13 del artefacto `page.composition`.
 *
 * Decisiones clave:
 * - El canvas renderiza EL SITIO DEL CLIENTE: tokens del proyecto inyectados
 *   dentro del iframe (`overrides.iframe` + `studioCanvasCss`). La UI de la
 *   plataforma alrededor sigue el design system §11.4.
 * - Autosave debounced a `saveDraftAction` (valida Zod en cada escritura);
 *   guardar un artefacto `empty|approved` lo transiciona a `draft` (§8.3) y
 *   se refresca el server state para que el estado visible no mienta.
 * - El estado manda sobre el canvas: en `in_review|approved|locked` (o sin
 *   rol) los permisos globales de Puck se apagan (read-only reactivo, sin
 *   remontar). "Editar nueva versión" re-activa la edición sobre `approved`.
 * - Aprobar/Rechazar/Enviar/Revalidar son SIEMPRE las server actions de
 *   artifacts (solo humanos con rol; audit log; §19.1) — el Studio no tiene
 *   camino paralelo de aprobación.
 */

const AUTOSAVE_MS = 1200;

/** Permisos globales de Puck apagados → canvas en solo lectura. */
const READ_ONLY_PERMISSIONS: Partial<Permissions> = {
  drag: false,
  duplicate: false,
  delete: false,
  edit: false,
  insert: false,
};

/**
 * Explícitos (no `{}`): Puck MERGEA el prop `permissions` sobre los permisos
 * globales existentes, así que volver a editable tras un read-only debe
 * re-encender cada flag («Editar nueva versión» sobre `approved`).
 */
const EDITABLE_PERMISSIONS: Partial<Permissions> = {
  drag: true,
  duplicate: true,
  delete: true,
  edit: true,
  insert: true,
};

export interface StudioEditorProps {
  artifact: StudioArtifactView;
  /** draft persistido ?? última versión aprobada ?? Data vacío válido. */
  initialData: PageCompositionPayload;
  /** Rol admin|member del workspace (humano interno, §13/§14). */
  canEdit: boolean;
  /** Payload aprobado de `cms.collections`, o null. */
  cmsCollections: CmsCollectionsPayload | null;
  /** Payload aprobado de `design.tokens`, o null (el canvas cae a grises). */
  designTokens: DesignTokensPayload | null;
  /** Defaults de Navbar/Footer derivados del sitemap aprobado. */
  nav: StudioNavDefaults;
  initialDiff: ComputedDiff;
  /** Números de versión sellados, descendente. */
  versionNumbers: number[];
  /** URL pública de la página en el sitio generado, p.ej. `/servicios`. */
  pagePath: string;
  /** Ruta a la vista de artefacto (historial completo). */
  artifactHref: string;
  /** Ruta al artefacto cms.collections, o null. */
  cmsArtifactHref: string | null;
}

export function StudioEditor({
  artifact,
  initialData,
  canEdit,
  cmsCollections,
  designTokens,
  nav,
  initialDiff,
  versionNumbers,
  pagePath,
  artifactHref,
  cmsArtifactHref,
}: StudioEditorProps) {
  const router = useRouter();

  // --- estado del ciclo §13 --------------------------------------------------
  const [editingNewVersion, setEditingNewVersion] = useState(false);
  const [hasDraft, setHasDraft] = useState(artifact.hasDraft);
  const [saveState, setSaveState] = useState<DraftSaveState>({
    phase: "idle",
    savedAt: null,
    error: null,
    issues: [],
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, startAction] = useTransition();

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveComment, setApproveComment] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);

  /** Remonta el canvas al descartar una edición de nueva versión. */
  const [canvasEpoch, setCanvasEpoch] = useState(0);

  // Al cambiar el estado en el servidor (tras refresh), salir del modo edición
  // y re-sincronizar hasDraft. Patrón "adjust state during render".
  const [prevStatus, setPrevStatus] = useState(artifact.status);
  if (prevStatus !== artifact.status) {
    setPrevStatus(artifact.status);
    setEditingNewVersion(false);
  }
  const [prevHasDraft, setPrevHasDraft] = useState(artifact.hasDraft);
  if (prevHasDraft !== artifact.hasDraft) {
    setPrevHasDraft(artifact.hasDraft);
    setHasDraft(artifact.hasDraft);
  }

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timeout);
  }, [notice]);

  // --- editable: el estado del artefacto manda sobre el canvas ---------------
  const isEditableState = artifact.status === "empty" || artifact.status === "draft";
  const editable =
    canEdit &&
    artifact.status !== "locked" &&
    (isEditableState || (artifact.status === "approved" && editingNewVersion));

  const readOnlyReason = editable
    ? null
    : !canEdit
      ? "Solo lectura: tu rol no permite editar composiciones."
      : artifact.status === "in_review"
        ? "En revisión: apruébala o recházala para seguir editando."
        : artifact.status === "approved"
          ? `Versión aprobada v${artifact.currentVersion} (inmutable). Usa «Editar nueva versión» para proponer cambios.`
          : artifact.status === "locked"
            ? `Bloqueada (${artifact.lockedBy ?? "lock"}). Desbloquéala desde la vista de artefacto; eso marcará sus dependientes como desactualizados.`
            : null;

  // --- autosave del borrador (§8.3: Zod en cada escritura) --------------------
  // Puck llama a onChange con el closure del montaje: el estado vivo se lee
  // por refs para no perder ediciones tras un router.refresh().
  const editableRef = useRef(editable);
  const statusRef = useRef(artifact.status);
  useEffect(() => {
    editableRef.current = editable;
    statusRef.current = artifact.status;
  });

  const dataRef = useRef<Data>(initialData as unknown as Data);
  const mountedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const persistDraft = useCallback(
    async (data: Data) => {
      setSaveState((prev) => ({ ...prev, phase: "saving", error: null }));
      const statusBefore = statusRef.current;
      const result = await saveDraftAction(artifact.id, data);
      if (result.ok) {
        setHasDraft(true);
        setSaveState({ phase: "saved", savedAt: Date.now(), error: null, issues: [] });
        // `empty|approved → draft`: re-render del server state para que el
        // pill/banners no mientan (§12.2: el estado refleja la realidad).
        if (statusBefore !== "draft") router.refresh();
      } else {
        setSaveState((prev) => ({
          phase: "error",
          savedAt: prev.savedAt,
          error: result.error,
          issues: result.issues ?? [],
        }));
      }
    },
    [artifact.id, router],
  );

  const handleChange = useCallback(
    (data: Data) => {
      dataRef.current = data;
      // Puck dispara un onChange inicial al montar: no es una edición.
      if (!mountedRef.current) {
        mountedRef.current = true;
        return;
      }
      if (!editableRef.current) return;
      setSaveState((prev) => ({ ...prev, phase: "dirty" }));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void persistDraft(dataRef.current);
      }, AUTOSAVE_MS);
    },
    [persistDraft],
  );

  // --- acciones del ciclo §13 (server actions de artifacts, gated por rol) ---
  function runAction<T>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T) => void) {
    setActionError(null);
    startAction(async () => {
      const result = await fn();
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      onOk?.(result.data);
      router.refresh();
    });
  }

  const handleSubmitForReview = () =>
    runAction(
      () => submitForReviewAction(artifact.id),
      () => setNotice("Enviado a revisión: el canvas queda en solo lectura hasta la decisión."),
    );

  const handleApprove = () =>
    runAction(
      () => approveArtifactAction(artifact.id, approveComment.trim() || undefined),
      (data) => {
        setApproveOpen(false);
        setApproveComment("");
        const dependents = data.outdatedDependentIds.length;
        setNotice(
          `Versión v${data.version.version} aprobada (inmutable).` +
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
        setNotice("Rechazada: la composición vuelve a borrador con el feedback registrado.");
      },
    );

  const handleRevalidate = () =>
    runAction(
      () => revalidateArtifactAction(artifact.id),
      () => setNotice("Revalidada sin cambios."),
    );

  const handleStartNewVersion = () => {
    setEditingNewVersion(true);
    setNotice("Edición de nueva versión: el primer cambio guardado vuelve a borrador (§13).");
  };

  /** Solo visible mientras NADA se ha guardado aún (status sigue approved). */
  const handleDiscardEditing = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    mountedRef.current = false; // el remonte dispara otro onChange inicial
    dataRef.current = initialData as unknown as Data;
    setCanvasEpoch((epoch) => epoch + 1);
    setEditingNewVersion(false);
    setSaveState({ phase: "idle", savedAt: null, error: null, issues: [] });
  };

  // --- Puck: config, plugin, overrides (objetos estables) --------------------
  const config = useMemo(
    () => createPuckConfig({ cmsCollections, nav }),
    [cmsCollections, nav],
  );
  const plugins = useMemo(() => [createApprovalPlugin()], []);
  const canvasCss = useMemo(() => studioCanvasCss(designTokens), [designTokens]);
  const overrides = useMemo<Partial<Overrides>>(
    () => ({
      // Tokens del proyecto DENTRO del iframe del canvas (después de las
      // hojas copiadas del padre, para ganar la cascada).
      iframe: ({ children, document }) => (
        <CanvasIframeStyles css={canvasCss} document={document}>
          {children}
        </CanvasIframeStyles>
      ),
      // Sustituye el botón Publish de Puck: aquí no existe "publicar" — la
      // única salida es el ciclo §13 del panel de aprobación.
      headerActions: () => <HeaderSaveIndicator />,
    }),
    [canvasCss],
  );
  const permissions = editable ? EDITABLE_PERMISSIONS : READ_ONLY_PERMISSIONS;

  const contextValue = useMemo<StudioEditorContextValue>(
    () => ({
      artifact: { ...artifact, hasDraft },
      canEdit,
      editable,
      readOnlyReason,
      pendingAction,
      actionError,
      notice,
      saveState,
      cmsCollections,
      cmsArtifactHref,
      artifactHref,
      onStartNewVersion: handleStartNewVersion,
      onSubmitForReview: handleSubmitForReview,
      onOpenApprove: () => setApproveOpen(true),
      onOpenReject: () => setRejectOpen(true),
      onRevalidate: handleRevalidate,
      onOpenDiff: () => setDiffOpen(true),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers estables por cierre sobre refs/estado
    [
      artifact,
      hasDraft,
      canEdit,
      editable,
      readOnlyReason,
      pendingAction,
      actionError,
      notice,
      saveState,
      cmsCollections,
      cmsArtifactHref,
      artifactHref,
    ],
  );

  return (
    <StudioEditorContext.Provider value={contextValue}>
      <div className="relative min-h-0 flex-1">
        {/* CTA flotante para descartar la edición de nueva versión mientras
            nada se guardó (después, el estado ya es draft y no hay vuelta). */}
        {artifact.status === "approved" && editingNewVersion ? (
          <div className="absolute right-3 bottom-3 z-10">
            <Button size="sm" variant="ghost" className="bg-surface" onClick={handleDiscardEditing}>
              Descartar edición
            </Button>
          </div>
        ) : null}
        <Puck
          key={`${artifact.id}:${canvasEpoch}`}
          config={config}
          data={initialData as unknown as Data}
          viewports={editorViewports}
          onChange={handleChange}
          permissions={permissions}
          plugins={plugins}
          overrides={overrides}
          headerTitle={artifact.label}
          headerPath={pagePath}
        />
      </div>

      {/* Aprobación: acción humana explícita sobre una versión concreta (§8.5). */}
      <Modal
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={`Aprobar «${artifact.label}»`}
        description={`Se sellará la versión inmutable v${artifact.currentVersion + 1} y sus dependientes se marcarán como desactualizados (nunca se regeneran solos, §8.4). El canvas pasará a solo lectura.`}
        footer={
          <>
            <Button variant="ghost" disabled={pendingAction} onClick={() => setApproveOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={pendingAction} onClick={handleApprove}>
              {pendingAction ? "Aprobando…" : `Aprobar v${artifact.currentVersion + 1}`}
            </Button>
          </>
        }
      >
        <Field
          label="Comentario"
          htmlFor="studio-approve-comment"
          hint="Opcional; queda en el registro de aprobaciones."
        >
          <Textarea
            id="studio-approve-comment"
            value={approveComment}
            disabled={pendingAction}
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
        description="La composición vuelve a borrador con el flag de rechazo; el feedback queda en el registro de actividad."
        footer={
          <>
            <Button variant="ghost" disabled={pendingAction} onClick={() => setRejectOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={pendingAction || rejectFeedback.trim() === ""}
              onClick={handleReject}
            >
              {pendingAction ? "Rechazando…" : "Rechazar con feedback"}
            </Button>
          </>
        }
      >
        <Field
          label="Feedback"
          htmlFor="studio-reject-feedback"
          required
          hint="Explica qué debe corregirse antes de volver a enviar a revisión."
        >
          <Textarea
            id="studio-reject-feedback"
            value={rejectFeedback}
            disabled={pendingAction}
            className="min-h-20"
            onChange={(event) => setRejectFeedback(event.target.value)}
          />
        </Field>
      </Modal>

      {/* Diff estructural draft ↔ aprobada / entre versiones (§8.3). */}
      <Modal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        size="lg"
        title="Diff de la composición"
        description="Compara el borrador guardado con la última versión aprobada, o dos versiones selladas entre sí."
      >
        <StudioDiffPanel
          artifactId={artifact.id}
          initialDiff={initialDiff}
          versionNumbers={versionNumbers}
        />
      </Modal>
    </StudioEditorContext.Provider>
  );
}
