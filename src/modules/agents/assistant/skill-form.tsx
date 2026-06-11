"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, PenLine, TriangleAlert } from "lucide-react";

import type { LlmProviderKind } from "@/db/schema";
import { Button, Field, Input, Select, Textarea } from "@/ui";

import {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MODEL_OPTIONS,
  formatPricePerMTok,
} from "../model-catalog";
import { startSkillRunAction } from "./actions";
import type {
  AssistantArtifactInfo,
  AssistantContextData,
  AssistantSkillInfo,
  AssistantSurface,
  AssistantTypeOption,
  RunStatusView,
} from "./types";

/**
 * Formulario tipado de invocación de una skill (§9.1/§9.2): params, contrato
 * lee/escribe como UI de primera clase, selector de proveedor/key BYOK y
 * aviso si el target ya tiene un borrador sin sellar (§8.6).
 */

const PROVIDER_LABELS: Record<LlmProviderKind, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  mock: "Mock (demostración)",
};

export interface SkillFormProps {
  skill: AssistantSkillInfo;
  typeOptions: AssistantTypeOption[];
  context: AssistantContextData;
  surface: AssistantSurface;
  /** Tipo del artefacto abierto en pantalla (Spec OS / Studio). */
  artifactType?: string;
  /** Instance key del artefacto abierto (Studio: pageKey). */
  artifactKey?: string;
  projectId: string;
  settingsHref: string;
  onLaunched: (run: RunStatusView) => void;
  onBack: (() => void) | null;
}

interface ResolvedTarget {
  type: string;
  key: string | null;
}

function findArtifact(
  artifacts: AssistantArtifactInfo[],
  target: ResolvedTarget,
): AssistantArtifactInfo | null {
  return (
    artifacts.find(
      (artifact) => artifact.type === target.type && artifact.key === target.key,
    ) ?? null
  );
}

export function SkillForm({
  skill,
  typeOptions,
  context,
  surface,
  artifactType,
  artifactKey,
  projectId,
  settingsHref,
  onLaunched,
  onBack,
}: SkillFormProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // --- params por skill (lista cerrada §9.3) --------------------------------
  const [specTarget, setSpecTarget] = useState<"strategy" | "sitemap">(
    artifactType === "spec.sitemap" ? "sitemap" : "strategy",
  );
  const pageKeys = useMemo(
    () =>
      context.artifacts
        .filter((artifact) => artifact.type === "page.composition" && artifact.key)
        .map((artifact) => artifact.key as string)
        .sort(),
    [context.artifacts],
  );
  const [pageKey, setPageKey] = useState<string>(
    artifactType === "page.composition" && artifactKey ? artifactKey : (pageKeys[0] ?? ""),
  );
  const [pageScopeText, setPageScopeText] = useState("");
  const [instruction, setInstruction] = useState("");
  const validType = typeOptions.some((option) => option.typeKey === artifactType);
  const [reviseType, setReviseType] = useState<string>(
    validType ? (artifactType as string) : "spec.strategy",
  );
  const reviseTypeOption = typeOptions.find((option) => option.typeKey === reviseType);
  const [reviseKey, setReviseKey] = useState<string>(
    artifactType === "page.composition" && artifactKey ? artifactKey : (pageKeys[0] ?? ""),
  );
  /** En Spec OS / Studio el target de revise-artifact es el artefacto abierto. */
  const reviseTargetLocked = surface !== "cockpit" && validType;

  // --- target resuelto (para el contrato y el aviso de draft, §8.6) ---------
  const target: ResolvedTarget | null = useMemo(() => {
    switch (skill.name) {
      case "generate-spec-draft":
        return {
          type: specTarget === "sitemap" ? "spec.sitemap" : "spec.strategy",
          key: null,
        };
      case "generate-cms-schema":
        return { type: "cms.collections", key: null };
      case "write-page-copy":
        return { type: "content.page", key: null };
      case "compose-page-draft":
        return pageKey ? { type: "page.composition", key: pageKey } : null;
      case "revise-artifact":
        if (reviseTypeOption?.multi) {
          return reviseKey ? { type: reviseType, key: reviseKey } : null;
        }
        return { type: reviseType, key: null };
      default:
        return null;
    }
  }, [skill.name, specTarget, pageKey, reviseType, reviseKey, reviseTypeOption]);

  const targetArtifact = target ? findArtifact(context.artifacts, target) : null;
  const targetBlocked =
    targetArtifact != null &&
    (targetArtifact.status === "locked" || targetArtifact.status === "in_review");

  // --- contrato lee/escribe (§9.1 como UI de primera clase) -----------------
  const reads = useMemo(() => {
    if (skill.name !== "revise-artifact") return skill.reads;
    const upstream = reviseTypeOption?.dependsOn ?? [];
    return [
      {
        typeKey: reviseType,
        label: reviseTypeOption?.label ?? reviseType,
        mode: "current" as const,
        required: true,
      },
      ...upstream.map((dep) => ({
        typeKey: dep.typeKey,
        label: dep.label,
        mode: "approved" as const,
        required: false,
      })),
    ];
  }, [skill, reviseType, reviseTypeOption]);

  const writeLabel = target
    ? `${typeOptions.find((option) => option.typeKey === target.type)?.label ?? target.type}${
        target.key ? ` · ${target.key}` : ""
      }`
    : "—";

  // --- proveedor / key BYOK (§16) --------------------------------------------
  const providersWithKey = useMemo(
    () =>
      (["anthropic", "openai"] as const).filter((provider) =>
        context.keys.some((key) => key.provider === provider),
      ),
    [context.keys],
  );
  const availableProviders: LlmProviderKind[] = [...providersWithKey, "mock"];
  const defaultProvider =
    [skill.preferredProvider, ...skill.fallbackProviders].find((provider) =>
      availableProviders.includes(provider),
    ) ?? "mock";
  const [provider, setProvider] = useState<LlmProviderKind>(defaultProvider);
  const providerKeys = context.keys.filter((key) => key.provider === provider);
  const [keyId, setKeyId] = useState<string>(providerKeys[0]?.id ?? "");
  const selectedKey =
    providerKeys.find((key) => key.id === keyId) ?? providerKeys[0] ?? null;

  // --- modelo por invocación (hoy con elección solo en Anthropic) ------------
  const [modelId, setModelId] = useState<string>(ANTHROPIC_DEFAULT_MODEL);
  const effectiveModelId = provider === "anthropic" ? modelId : null;
  const pricePerMTok = formatPricePerMTok(provider, effectiveModelId);

  const changeProvider = (next: LlmProviderKind) => {
    setProvider(next);
    setKeyId(context.keys.find((key) => key.provider === next)?.id ?? "");
    setModelId(ANTHROPIC_DEFAULT_MODEL);
  };

  // --- validación ligera client-side (la autoridad es el Zod del bind) ------
  const missingParam =
    (skill.name === "compose-page-draft" && pageKey.length === 0) ||
    (skill.name === "revise-artifact" &&
      (instruction.trim().length === 0 ||
        (reviseTypeOption?.multi === true && reviseKey.length === 0)));

  const submit = () => {
    setError(null);
    const params: Record<string, unknown> = {};
    if (skill.name === "generate-spec-draft") params.target = specTarget;
    if (skill.name === "compose-page-draft") params.pageKey = pageKey;
    if (skill.name === "write-page-copy") {
      const scope = pageScopeText
        .split(",")
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0);
      if (scope.length > 0) params.pageScope = scope;
    }
    if (skill.name === "revise-artifact") {
      params.instruction = instruction.trim();
      params.targetType = reviseType;
      if (reviseTypeOption?.multi) params.targetKey = reviseKey;
    }

    startTransition(async () => {
      const result = await startSkillRunAction({
        projectId,
        skillName: skill.name,
        provider,
        params,
        keyId: provider === "mock" ? null : (selectedKey?.id ?? null),
        modelId: effectiveModelId,
      });
      if (result.ok) {
        onLaunched(result.data);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 self-start text-xs text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={12} aria-hidden />
          Todas las skills
        </button>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          {skill.label}
        </h3>
        <p className="mt-0.5 text-xs text-muted">{skill.description}</p>
        <p className="mt-1 font-mono text-[10px] text-faint">
          {skill.name}@{skill.version}
        </p>
      </div>

      {/* Contrato §9.1: qué lee y qué escribe, primera clase en la UI */}
      <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5">
        <div className="flex items-start gap-2">
          <BookOpen size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden />
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-widest text-faint uppercase">Lee</p>
            <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {reads.length === 0 ? (
                <li className="text-xs text-muted">Solo el contexto del proyecto</li>
              ) : (
                reads.map((read) => (
                  <li key={`${read.typeKey}-${read.mode}`} className="text-xs text-muted">
                    {read.label}
                    <span className="ml-1 font-mono text-[10px] text-faint">
                      {read.mode === "approved" ? "aprobado" : "actual"}
                      {read.required ? " · requerido" : ""}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
        <div className="flex items-start gap-2 border-t border-border pt-2">
          <PenLine size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden />
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-widest text-faint uppercase">
              Escribe (como propuesta)
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {writeLabel}
              <span className="ml-1 text-faint">
                — borrador + validaciones + diff; la aprobación siempre es humana.
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Params tipados por skill */}
      {skill.name === "generate-spec-draft" ? (
        <Field label="Artefacto a proponer" htmlFor="assistant-spec-target">
          <Select
            id="assistant-spec-target"
            value={specTarget}
            onChange={(event) =>
              setSpecTarget(event.target.value === "sitemap" ? "sitemap" : "strategy")
            }
          >
            <option value="strategy">Estrategia (spec.strategy)</option>
            <option value="sitemap">Sitemap (spec.sitemap)</option>
          </Select>
        </Field>
      ) : null}

      {skill.name === "write-page-copy" ? (
        <Field
          label="Páginas (opcional)"
          htmlFor="assistant-page-scope"
          hint="Slugs del sitemap separados por comas (p.ej. home, servicios). Vacío = todas."
        >
          <Input
            id="assistant-page-scope"
            value={pageScopeText}
            onChange={(event) => setPageScopeText(event.target.value)}
            placeholder="home, servicios"
            className="font-mono text-xs"
          />
        </Field>
      ) : null}

      {skill.name === "compose-page-draft" ? (
        surface === "studio" && artifactKey ? (
          <p className="text-xs text-muted">
            Página objetivo:{" "}
            <span className="font-mono text-foreground">{artifactKey}</span>
          </p>
        ) : (
          <Field label="Página" htmlFor="assistant-page-key" required>
            <Select
              id="assistant-page-key"
              value={pageKey}
              onChange={(event) => setPageKey(event.target.value)}
            >
              {pageKeys.length === 0 ? <option value="">Sin páginas</option> : null}
              {pageKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </Select>
          </Field>
        )
      ) : null}

      {skill.name === "revise-artifact" ? (
        <>
          <Field label="Instrucción" htmlFor="assistant-instruction" required>
            <Textarea
              id="assistant-instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="P. ej. «haz el tono más premium y acorta los titulares»"
            />
          </Field>
          {reviseTargetLocked ? (
            <p className="text-xs text-muted">
              Artefacto objetivo:{" "}
              <span className="text-foreground">{reviseTypeOption?.label ?? reviseType}</span>
              {reviseTypeOption?.multi && reviseKey ? (
                <span className="ml-1 font-mono text-foreground">{reviseKey}</span>
              ) : null}
            </p>
          ) : (
            <>
              <Field label="Artefacto objetivo" htmlFor="assistant-revise-type">
                <Select
                  id="assistant-revise-type"
                  value={reviseType}
                  onChange={(event) => setReviseType(event.target.value)}
                >
                  {typeOptions.map((option) => (
                    <option key={option.typeKey} value={option.typeKey}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {reviseTypeOption?.multi ? (
                <Field label="Página" htmlFor="assistant-revise-key" required>
                  <Select
                    id="assistant-revise-key"
                    value={reviseKey}
                    onChange={(event) => setReviseKey(event.target.value)}
                  >
                    {pageKeys.length === 0 ? <option value="">Sin páginas</option> : null}
                    {pageKeys.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {/* Proveedor + key BYOK del workspace (§16, §19) */}
      <Field
        label="Proveedor LLM"
        htmlFor="assistant-provider"
        hint={
          provider === "mock"
            ? "Proveedor de demostración: genera una propuesta determinista en local, sin llamar a ningún LLM externo."
            : undefined
        }
      >
        <Select
          id="assistant-provider"
          value={provider}
          onChange={(event) => changeProvider(event.target.value as LlmProviderKind)}
        >
          {availableProviders.map((option) => (
            <option key={option} value={option}>
              {PROVIDER_LABELS[option]}
            </option>
          ))}
        </Select>
      </Field>

      {provider === "anthropic" ? (
        <Field label="Modelo" htmlFor="assistant-model">
          <Select
            id="assistant-model"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          >
            {ANTHROPIC_MODEL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.hint}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {pricePerMTok ? (
        <p className="-mt-2 text-[11px] text-faint">
          Costo por MTok:{" "}
          <span className="font-mono text-muted">{pricePerMTok}</span>
        </p>
      ) : provider === "openai" ? (
        <p className="-mt-2 text-[11px] text-faint">
          Costo por MTok: <span className="font-mono">sin tarifa configurada</span> — el coste
          estimado del run se mostrará como $0.
        </p>
      ) : null}

      {provider !== "mock" && providerKeys.length > 1 ? (
        <Field label="API key del workspace" htmlFor="assistant-key">
          <Select
            id="assistant-key"
            value={selectedKey?.id ?? ""}
            onChange={(event) => setKeyId(event.target.value)}
          >
            {providerKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.label} ····{key.last4}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {provider !== "mock" && selectedKey ? (
        <p className="-mt-2 font-mono text-[11px] text-faint">
          key: {selectedKey.label} ····{selectedKey.last4}
          {!selectedKey.validated ? (
            <span className="ml-1 text-accent-danger">
              (rechazada por el proveedor — revísala en Ajustes)
            </span>
          ) : null}
        </p>
      ) : null}
      {providersWithKey.length === 0 ? (
        <p className="-mt-2 text-xs text-muted">
          El workspace no tiene claves LLM (BYOK). Un admin puede añadirlas en{" "}
          <Link
            href={settingsHref}
            className="text-accent-action underline-offset-2 hover:underline"
          >
            Ajustes
          </Link>
          ; mientras tanto, el proveedor de demostración funciona sin clave.
        </p>
      ) : null}

      {/* Aviso §8.6: el draft es la zona de trabajo y la propuesta lo reemplaza */}
      {targetArtifact?.hasDraft ? (
        <div className="rounded-md border border-accent-warning/40 bg-accent-warning/10 px-3 py-2.5">
          <p className="flex items-start gap-1.5 text-xs font-medium text-accent-warning">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            {targetArtifact.proposedByRun
              ? "El artefacto objetivo ya tiene una propuesta de otro agent run sin decidir. Este run la reemplazará."
              : "El artefacto objetivo tiene un borrador humano sin sellar. La propuesta del run lo reemplazará."}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            El borrador es la zona de trabajo (§8.6): si quieres conservarlo, envíalo a
            revisión y séllalo antes de lanzar la skill. Las versiones selladas nunca se
            tocan.
          </p>
        </div>
      ) : null}

      {targetBlocked ? (
        <p className="text-xs text-accent-danger">
          El artefacto objetivo está{" "}
          {targetArtifact?.status === "locked" ? "bloqueado" : "en revisión"}: resuélvelo
          antes de lanzar la skill.
        </p>
      ) : null}
      {target && !targetArtifact ? (
        <p className="text-xs text-accent-warning">
          No existe el artefacto objetivo ({writeLabel}) en este proyecto.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-accent-danger">
          {error}
        </p>
      ) : null}

      <Button
        variant="primary"
        size="md"
        onClick={submit}
        disabled={pending || missingParam || targetBlocked || target == null}
      >
        {pending ? "Lanzando run…" : "Lanzar skill"}
      </Button>
      <p className="-mt-2 text-[11px] text-faint">
        El run produce una propuesta auditada; ningún agente aprueba artefactos (§19).
      </p>
    </div>
  );
}
