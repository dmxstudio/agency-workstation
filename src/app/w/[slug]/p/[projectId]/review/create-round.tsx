"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { MessageSquarePlus, TriangleAlert } from "lucide-react";

import { createReviewRequestAction } from "@/modules/review/actions";
import { Button, Field, Input, Modal, Select } from "@/ui";

/**
 * Crear ronda de revisión (§7.7): selecciona un release SELLADO y acuña el
 * token del cliente. El selector muestra qué releases están desplegados
 * ahora mismo (idealmente preview, §16) y avisa si el elegido no corre en
 * ningún slot — la ronda se puede crear igual, pero el cliente no verá la
 * página embebida hasta que se arranque el deployment.
 */

export interface ReleaseOption {
  /** Número de release = versión sellada del artefacto `release`. */
  number: number;
  notes: string;
  pageCount: number;
  createdAtLabel: string;
  /** Slots sirviendo este release AHORA (realidad del DeployProvider). */
  runningSlots: ("production" | "preview")[];
}

function slotsLabel(slots: ReleaseOption["runningSlots"]): string {
  if (slots.length === 0) return "sin desplegar";
  return slots
    .map((slot) => (slot === "preview" ? "preview activo" : "producción activa"))
    .join(" · ");
}

export function CreateRoundControl({
  projectId,
  basePath,
  releases,
  canCreate,
}: {
  projectId: string;
  basePath: string;
  /** Releases sellados, el más reciente primero. */
  releases: ReleaseOption[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Preselección: el release más reciente con preview corriendo; si ninguno
  // está desplegado, el más reciente a secas.
  const defaultRelease = useMemo(() => {
    const withPreview = releases.find((release) =>
      release.runningSlots.includes("preview"),
    );
    return (withPreview ?? releases[0])?.number ?? 0;
  }, [releases]);
  const [releaseNumber, setReleaseNumber] = useState(defaultRelease);

  const selected = releases.find((release) => release.number === releaseNumber) ?? null;
  const undeployed = selected != null && selected.runningSlots.length === 0;

  const submit = () => {
    startTransition(async () => {
      const result = await createReviewRequestAction(projectId, releaseNumber, label);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
      setLabel("");
      router.push(`${basePath}/review/${result.data.id}`);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        disabled={!canCreate || releases.length === 0}
        title={
          !canCreate
            ? "Tu rol no permite crear rondas: requiere admin o member."
            : releases.length === 0
              ? "Crea primero un release en Deploy."
              : undefined
        }
      >
        <MessageSquarePlus size={14} strokeWidth={1.75} aria-hidden />
        Nueva ronda
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nueva ronda de revisión"
        description="Genera un enlace con token para que el cliente comente y apruebe esta versión, sin cuenta."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={pending || label.trim() === "" || selected == null}
              aria-busy={pending}
            >
              {pending ? "Creando…" : "Crear ronda"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field
            label="Etiqueta de la ronda"
            htmlFor="round-label"
            required
            hint="Identifica el enlace; el cliente la ve en su cabecera."
          >
            <Input
              id="round-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="P. ej. Cliente Acme — ronda 1"
            />
          </Field>

          <Field label="Release a revisar" htmlFor="round-release" required>
            <Select
              id="round-release"
              value={String(releaseNumber)}
              onChange={(event) => setReleaseNumber(Number(event.target.value))}
            >
              {releases.map((release) => (
                <option key={release.number} value={release.number}>
                  {`Versión ${release.number} — ${slotsLabel(release.runningSlots)} · ${release.pageCount} página${release.pageCount === 1 ? "" : "s"} · ${release.createdAtLabel}`}
                </option>
              ))}
            </Select>
          </Field>

          {selected?.notes ? (
            <p className="text-xs text-muted">
              Notas del release: <span className="text-foreground">{selected.notes}</span>
            </p>
          ) : null}

          {undeployed ? (
            <p className="flex items-start gap-1.5 text-xs text-accent-warning">
              <TriangleAlert size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
              <span>
                Este release no está desplegado en ningún slot. El cliente podrá comentar,
                pero no verá la página embebida hasta que arranques el deployment
                (idealmente el slot preview) desde Deploy.
              </span>
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-xs text-accent-danger">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
