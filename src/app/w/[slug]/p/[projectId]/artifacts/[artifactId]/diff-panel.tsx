"use client";

import { useState, useTransition } from "react";
import { GitCompareArrows, RotateCcw } from "lucide-react";

import { computeDiffAction } from "@/modules/artifacts/actions";
import type { ComputedDiff } from "@/modules/artifacts/service";
import { Button, DiffView, Field, Select } from "@/ui";

function refLabel(ref: ComputedDiff["from"] | ComputedDiff["to"]): string {
  if (ref.kind === "version") return `v${ref.version}`;
  if (ref.kind === "draft") return "borrador actual";
  return "sin versión aprobada";
}

export interface DiffPanelProps {
  artifactId: string;
  /** Diff por defecto: última versión aprobada vs borrador (calculado en servidor). */
  initialDiff: ComputedDiff;
  /** Números de versión disponibles, descendente. */
  versionNumbers: number[];
}

/**
 * Diff estructural (§8.3) — componente firma del producto. Por defecto
 * compara la última versión aprobada con el borrador actual; el selector
 * permite comparar dos versiones selladas cualesquiera.
 */
export function DiffPanel({ artifactId, initialDiff, versionNumbers }: DiffPanelProps) {
  const [override, setOverride] = useState<ComputedDiff | null>(null);
  const [fromVersion, setFromVersion] = useState<string>(() =>
    String(versionNumbers[1] ?? versionNumbers[0] ?? ""),
  );
  const [toVersion, setToVersion] = useState<string>(() => String(versionNumbers[0] ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const diff = override ?? initialDiff;

  const compare = () => {
    setError(null);
    startTransition(async () => {
      const result = await computeDiffAction(artifactId, {
        fromVersion: Number(fromVersion),
        toVersion: Number(toVersion),
      });
      if (result.ok) {
        setOverride(result.data);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {versionNumbers.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface p-3">
          <Field label="Desde" htmlFor="diff-from" className="w-28">
            <Select
              id="diff-from"
              value={fromVersion}
              disabled={pending}
              className="font-mono"
              onChange={(event) => setFromVersion(event.target.value)}
            >
              {versionNumbers.map((version) => (
                <option key={version} value={String(version)}>
                  v{version}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hasta" htmlFor="diff-to" className="w-28">
            <Select
              id="diff-to"
              value={toVersion}
              disabled={pending}
              className="font-mono"
              onChange={(event) => setToVersion(event.target.value)}
            >
              {versionNumbers.map((version) => (
                <option key={version} value={String(version)}>
                  v{version}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="md" disabled={pending} onClick={compare}>
            <GitCompareArrows size={14} aria-hidden />
            Comparar versiones
          </Button>
          {override ? (
            <Button variant="ghost" disabled={pending} onClick={() => setOverride(null)}>
              <RotateCcw size={13} aria-hidden />
              Volver al diff del borrador
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted">
          Aún no hay versiones selladas: el diff compara contra el borrador actual.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-xs text-accent-danger">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-muted">
        Comparando{" "}
        <span className="font-mono text-foreground">{refLabel(diff.from)}</span>
        {" → "}
        <span className="font-mono text-foreground">{refLabel(diff.to)}</span>
      </p>

      <DiffView changes={diff.changes} emptyLabel="Sin cambios entre las referencias comparadas." />
    </div>
  );
}
