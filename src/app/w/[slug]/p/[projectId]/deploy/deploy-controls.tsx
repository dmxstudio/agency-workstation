"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CircleCheck, OctagonX, PackagePlus, Rocket, TriangleAlert, Undo2 } from "lucide-react";

import type { ReleaseChecklistItem } from "@/modules/artifacts";
import { deployReleaseAction, stopSlotAction } from "@/modules/deploy/actions";
import type { DeploySlot } from "@/modules/deploy";
import { createReleaseAction } from "@/modules/review/actions";
import { Button, Modal, MonoId, Textarea, cn, type ButtonSize, type ButtonVariant } from "@/ui";

/**
 * Islands de mutación de la pantalla Deploy. Todo aquí es ACCIÓN HUMANA
 * (§13, §19): cada botón exige confirmación explícita en modal antes de
 * llamar a la server action (que re-valida sesión + rol admin|member), y la
 * pantalla se refresca vía router.refresh() — el servidor es la verdad.
 *
 * Limitación MVP documentada: `deployReleaseAction` mantiene la petición
 * abierta mientras compila (el primer build de un release tarda minutos). Si
 * se cierra la pestaña, el deploy CONTINÚA en el servidor y queda registrado
 * en `deployments`; al volver a entrar, la fila en «building» + el polling de
 * <AutoRefresh> recuperan el estado real.
 */

function ErrorLine({ error }: { error: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-accent-danger">
      <TriangleAlert size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{error}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// AutoRefresh: polling ligero mientras haya deploys en estado «building»
// ---------------------------------------------------------------------------

export function AutoRefresh({
  enabled,
  intervalMs = 4000,
}: {
  enabled: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, router]);
  return null;
}

// ---------------------------------------------------------------------------
// Crear release: checklist resumido + notas + confirmación humana (§7.8, §19)
// ---------------------------------------------------------------------------

export interface CreateReleaseButtonProps {
  projectId: string;
  /** Número que tendrá el release (currentVersion + 1). */
  nextReleaseNumber: number;
  /** Checklist §7.8 evaluado server-side (se muestra como resumen). */
  checklist: ReleaseChecklistItem[];
  /** Checklist en verde + rol admin|member. */
  enabled: boolean;
  disabledReason: string | null;
}

export function CreateReleaseButton({
  projectId,
  nextReleaseNumber,
  checklist,
  enabled,
  disabledReason,
}: CreateReleaseButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const close = () => {
    if (pending) return; // no cerrar a mitad de sellado
    setOpen(false);
    setError(null);
  };

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await createReleaseAction(projectId, notes);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setNotes("");
      setOpen(false);
      setNotice(
        `Release v${result.data.payload.releaseNumber} creado (tag ${result.data.gitTag}).`,
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="primary"
        onClick={() => {
          setNotice(null);
          setOpen(true);
        }}
        disabled={!enabled}
        title={!enabled ? (disabledReason ?? undefined) : undefined}
      >
        <PackagePlus size={14} strokeWidth={1.75} aria-hidden />
        Crear release
      </Button>
      {!enabled && disabledReason ? (
        <p className="max-w-xs text-right text-xs text-muted">{disabledReason}</p>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-accent-success">
          {notice}
        </p>
      ) : null}

      <Modal
        open={open}
        onClose={close}
        title={`Crear release v${nextReleaseNumber}`}
        description="Confirmación humana del checklist §7.8: el release sella las versiones aprobadas como snapshot inmutable y tagea el repo generado."
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleConfirm} disabled={pending} aria-busy={pending}>
              {pending ? "Sellando…" : `Confirmar y crear v${nextReleaseNumber}`}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[11px] font-medium tracking-wider text-muted uppercase">
              Checklist evaluado
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {checklist.map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-xs">
                  {item.ok ? (
                    <CircleCheck
                      size={13}
                      strokeWidth={2}
                      className="mt-px shrink-0 text-accent-success"
                      aria-hidden
                    />
                  ) : (
                    <TriangleAlert
                      size={13}
                      strokeWidth={2}
                      className="mt-px shrink-0 text-accent-warning"
                      aria-hidden
                    />
                  )}
                  <span className={cn(item.ok ? "text-muted" : "text-accent-warning")}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="release-notes"
              className="text-xs font-medium tracking-wide text-muted"
            >
              Notas del release (opcional)
            </label>
            <Textarea
              id="release-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Qué entra en este release (visible en la ronda de review del cliente)."
              disabled={pending}
            />
          </div>
          <p className="text-xs text-faint">
            Se sellará como tag <code className="font-mono">release-{nextReleaseNumber}</code> en
            el repo generado. La acción queda en el audit log con tu usuario.
          </p>
          {error ? <ErrorLine error={error} /> : null}
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desplegar release vN en un slot (deploy, redeploy o rollback) + confirmación
// ---------------------------------------------------------------------------

export interface DeployReleaseButtonProps {
  projectId: string;
  releaseVersion: number;
  slot: DeploySlot;
  /** «Producción» / «Preview» (texto del modal). */
  slotLabel: string;
  buttonLabel: string;
  /** Rollback solo cambia el texto del modal: ES el mismo deploy (§7.8). */
  intent?: "deploy" | "rollback";
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  disabledReason?: string | null;
}

export function DeployReleaseButton({
  projectId,
  releaseVersion,
  slot,
  slotLabel,
  buttonLabel,
  intent = "deploy",
  variant = "secondary",
  size = "md",
  disabled = false,
  disabledReason = null,
}: DeployReleaseButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (pending) return; // el deploy sigue en el servidor; mantener el contexto
    setOpen(false);
    setError(null);
  };

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await deployReleaseAction(projectId, releaseVersion, slot);
      if (!result.ok) {
        setError(result.error);
        router.refresh(); // la fila «failed» ya existe: mostrar estado real
        return;
      }
      setError(null);
      setOpen(false);
      router.refresh();
    });
  };

  const Icon = intent === "rollback" ? Undo2 : Rocket;

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? (disabledReason ?? undefined) : undefined}
      >
        <Icon size={size === "sm" ? 12 : 14} strokeWidth={1.75} aria-hidden />
        {buttonLabel}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={
          intent === "rollback"
            ? `Rollback a release v${releaseVersion} en ${slotLabel}`
            : `Desplegar release v${releaseVersion} en ${slotLabel}`
        }
        description={
          intent === "rollback"
            ? "El rollback despliega la versión sellada anterior: mismo mecanismo, build inmutable ya existente."
            : "Se activa el build inmutable del release en el slot local."
        }
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleConfirm} disabled={pending} aria-busy={pending}>
              {pending
                ? "Desplegando…"
                : intent === "rollback"
                  ? `Confirmar rollback a v${releaseVersion}`
                  : `Confirmar deploy de v${releaseVersion}`}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-xs text-muted">
          <p>
            Tag <MonoId id={`release-${releaseVersion}`} /> → slot{" "}
            <span className="font-medium text-foreground">{slotLabel}</span>. Si el slot ya está
            sirviendo otro release, su proceso se reemplaza (la plataforma nunca toca procesos
            ajenos al provider).
          </p>
          <p>
            El primer deploy de un release compila su build inmutable y puede tardar{" "}
            <span className="font-medium text-foreground">varios minutos</span>; los siguientes lo
            reutilizan y tardan segundos.
          </p>
          {pending ? (
            <p role="status" className="rounded border border-border bg-surface-raised px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
              Construyendo y arrancando el slot… Esta ventana espera el resultado. Si la cierras,
              el deploy continúa en el servidor y quedará registrado; vuelve a entrar a Deploy para
              ver el estado.
            </p>
          ) : null}
          {error ? <ErrorLine error={error} /> : null}
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Detener slot
// ---------------------------------------------------------------------------

export interface StopSlotButtonProps {
  projectId: string;
  slot: DeploySlot;
  slotLabel: string;
  /** Release que está corriendo (solo para el texto del modal). */
  runningRelease: number | null;
  disabled?: boolean;
  disabledReason?: string | null;
}

export function StopSlotButton({
  projectId,
  slot,
  slotLabel,
  runningRelease,
  disabled = false,
  disabledReason = null,
}: StopSlotButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setError(null);
  };

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await stopSlotAction(projectId, slot);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="danger"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? (disabledReason ?? undefined) : undefined}
      >
        <OctagonX size={14} strokeWidth={1.75} aria-hidden />
        Detener
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={`Detener ${slotLabel}`}
        description="El slot dejará de servir; el build inmutable del release no se borra."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleConfirm} disabled={pending} aria-busy={pending}>
              {pending ? "Deteniendo…" : "Detener slot"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-xs text-muted">
          <p>
            {runningRelease != null
              ? `El release v${runningRelease} dejará de servirse en este slot.`
              : "Se limpia cualquier proceso registrado por el provider en este slot."}{" "}
            Podrás volver a desplegarlo en segundos (el build se reutiliza).
          </p>
          {error ? <ErrorLine error={error} /> : null}
        </div>
      </Modal>
    </>
  );
}
