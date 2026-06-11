import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { listKeys } from "@/modules/agents/keys/service";
import { getSessionUser } from "@/modules/platform-core/auth/adapter";
import { getWorkspaceBySlug } from "@/modules/platform-core/workspaces";
import { Badge, MonoId, PageHeader } from "@/ui";

import { LlmKeysSection, type LlmKeyRow } from "./llm-keys-section";

/**
 * Ajustes del workspace (§7.9, §16): gestión BYOK de claves LLM. Solo admins
 * gestionan claves; los demás roles ven un aviso sobrio (la pantalla no
 * existe para clientes). Las claves viven cifradas (AES-256-GCM) y aquí solo
 * llegan id/proveedor/etiqueta/last4 — jamás el valor (§19).
 */

export const metadata: Metadata = { title: "Ajustes del workspace" };

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const path = `/w/${slug}/settings`;

  // El proxy solo comprueba la cookie; la sesión real se valida aquí.
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);

  const membership = await getWorkspaceBySlug(slug, user.id);
  if (!membership || membership.role === "client") notFound();
  const { workspace, role } = membership;

  const isAdmin = role === "admin";
  const keyRows: LlmKeyRow[] = isAdmin
    ? (
        await listKeys(workspace.id, {
          id: user.id,
          role,
          workspaceId: workspace.id,
        })
      )
        // El proveedor mock ya se representa con la fila fija «Proveedor de
        // demostración (incluido)»: una key mock persistida (p.ej. la del
        // seed demo) no añade información y duplicaría la fila.
        .filter((key) => key.provider !== "mock")
        .map((key) => ({
        id: key.id,
        provider: key.provider,
        label: key.label,
        last4: key.last4,
        lastValidatedAtLabel: key.lastValidatedAt
          ? dateFormatter.format(key.lastValidatedAt)
          : null,
        createdAtLabel: dateFormatter.format(key.createdAt),
      }))
    : [];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-surface px-6 py-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link
            href="/w"
            className="font-mono text-[11px] tracking-widest text-faint uppercase transition-colors hover:text-foreground"
          >
            Agency Workstation
          </Link>
          <span className="text-faint" aria-hidden>
            /
          </span>
          <Link
            href={`/w/${slug}`}
            className="truncate text-sm font-medium underline-offset-2 hover:underline"
          >
            {workspace.name}
          </Link>
          <span className="text-faint" aria-hidden>
            /
          </span>
          <span className="text-sm text-muted">Ajustes</span>
        </div>
        <Link
          href={`/w/${slug}`}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={12} aria-hidden />
          Volver a proyectos
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
        <PageHeader
          eyebrow="Workspace"
          title="Ajustes"
          description="Configuración del workspace: claves LLM propias (BYOK) para los agent runs."
          meta={
            <>
              <MonoId id={workspace.id} />
              <Badge>{isAdmin ? "Admin" : "Miembro"}</Badge>
            </>
          }
        />

        {isAdmin ? (
          <LlmKeysSection initialKeys={keyRows} />
        ) : (
          <div className="rounded-md border border-border px-4 py-6 text-center">
            <ShieldCheck size={20} className="mx-auto text-faint" aria-hidden />
            <p className="mt-2 text-sm font-medium text-foreground">
              Solo los admins gestionan los ajustes
            </p>
            <p className="mt-1 text-xs text-muted">
              Las claves LLM del workspace (BYOK) las añade y elimina un admin. Pide a un
              admin que configure las credenciales si las necesitas para lanzar skills.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
