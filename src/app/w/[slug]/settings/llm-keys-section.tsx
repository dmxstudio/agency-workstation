"use client";

import { useState, useTransition } from "react";
import { KeyRound, Plus, TriangleAlert } from "lucide-react";

import type { LlmProviderKind } from "@/db/schema";
import {
  addLlmKeyAction,
  deleteLlmKeyAction,
} from "@/modules/agents/keys/actions";
import type { LlmKeyPublic } from "@/modules/agents";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Modal,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui";

/**
 * Sección "Claves LLM (BYOK)" de los ajustes del workspace (§7.9, §16):
 * tabla de claves (solo etiqueta + last4 en mono — el valor jamás vuelve al
 * navegador), alta con validación contra el proveedor ANTES de cifrar y
 * guardar, y borrado (soft) con confirmación. El proveedor `mock` es de
 * primera clase y no necesita clave: se muestra como fila fija de demo.
 */

export interface LlmKeyRow {
  id: string;
  provider: LlmProviderKind;
  label: string;
  last4: string;
  /** Fecha formateada de última validación; null = rechazada por el proveedor (401). */
  lastValidatedAtLabel: string | null;
  createdAtLabel: string;
}

const PROVIDER_LABELS: Record<LlmProviderKind, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  mock: "Mock",
};

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

function toRow(key: LlmKeyPublic): LlmKeyRow {
  return {
    id: key.id,
    provider: key.provider,
    label: key.label,
    last4: key.last4,
    lastValidatedAtLabel: key.lastValidatedAt
      ? dateFormatter.format(new Date(key.lastValidatedAt))
      : null,
    createdAtLabel: dateFormatter.format(new Date(key.createdAt)),
  };
}

export function LlmKeysSection({ initialKeys }: { initialKeys: LlmKeyRow[] }) {
  const [keys, setKeys] = useState<LlmKeyRow[]>(initialKeys);
  const [pending, startTransition] = useTransition();

  // --- alta -----------------------------------------------------------------
  const [addOpen, setAddOpen] = useState(false);
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const resetAddForm = () => {
    setProvider("anthropic");
    setLabel("");
    setApiKey("");
    setAddError(null);
  };

  const submitAdd = () => {
    setAddError(null);
    startTransition(async () => {
      const result = await addLlmKeyAction({ provider, label, apiKey });
      // La key en claro no se conserva en ningún estado tras el submit.
      setApiKey("");
      if (result.ok) {
        setKeys((current) => [toRow(result.data), ...current]);
        setAddOpen(false);
        resetAddForm();
      } else {
        setAddError(result.error);
      }
    });
  };

  // --- borrado ---------------------------------------------------------------
  const [keyToDelete, setKeyToDelete] = useState<LlmKeyRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const submitDelete = () => {
    if (!keyToDelete) return;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteLlmKeyAction(keyToDelete.id);
      if (result.ok) {
        setKeys((current) => current.filter((key) => key.id !== keyToDelete.id));
        setKeyToDelete(null);
      } else {
        setDeleteError(result.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claves LLM (BYOK)</CardTitle>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={13} aria-hidden />
          Añadir key
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead>Etiqueta</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Última validación</TableHead>
              <TableHead>Añadida</TableHead>
              <TableHead aria-label="Acciones" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Proveedor de demostración: primera clase, sin clave (§9.3 e2e/demos) */}
            <TableRow>
              <TableCell>
                <Badge>Mock</Badge>
              </TableCell>
              <TableCell className="text-muted">
                Proveedor de demostración (incluido)
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs text-faint">no requiere clave</span>
              </TableCell>
              <TableCell className="text-muted">Siempre disponible</TableCell>
              <TableCell className="text-faint">—</TableCell>
              <TableCell />
            </TableRow>

            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell>
                  <Badge>{PROVIDER_LABELS[key.provider]}</Badge>
                </TableCell>
                <TableCell className="font-medium text-foreground">{key.label}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs">····{key.last4}</span>
                </TableCell>
                <TableCell>
                  {key.lastValidatedAtLabel ? (
                    <span className="text-muted">{key.lastValidatedAtLabel}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-accent-danger">
                      <TriangleAlert size={12} aria-hidden />
                      Rechazada por el proveedor (401)
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted">{key.createdAtLabel}</TableCell>
                <TableCell>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setDeleteError(null);
                      setKeyToDelete(key);
                    }}
                  >
                    Eliminar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-start gap-2 border-t border-border px-4 py-3">
          <KeyRound size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden />
          <p className="text-xs text-muted">
            Las claves se validan contra el proveedor al añadirlas y se guardan cifradas
            (AES-256-GCM). Nunca llegan al navegador ni a los proyectos generados — aquí
            solo se muestran los últimos 4 caracteres — y cada agent run registra una
            referencia a la clave usada, jamás su valor (§19).
          </p>
        </div>
      </CardContent>

      {/* Alta: la key se pega UNA vez, viaja al server y no vuelve a mostrarse */}
      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          resetAddForm();
        }}
        title="Añadir API key"
        description="Se valida contra el proveedor antes de guardarse cifrada. No volverá a mostrarse."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAddOpen(false);
                resetAddForm();
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submitAdd}
              disabled={pending || label.trim().length === 0 || apiKey.trim().length < 4}
            >
              {pending ? "Validando…" : "Validar y guardar"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Proveedor" htmlFor="llm-key-provider" required>
            <Select
              id="llm-key-provider"
              value={provider}
              onChange={(event) =>
                setProvider(event.target.value === "openai" ? "openai" : "anthropic")
              }
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </Select>
          </Field>
          <Field
            label="Etiqueta"
            htmlFor="llm-key-label"
            required
            hint="Nombre interno para distinguirla (p.ej. «Producción», «Equipo contenido»)."
          >
            <Input
              id="llm-key-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Producción"
              maxLength={80}
            />
          </Field>
          <Field
            label="API key"
            htmlFor="llm-key-value"
            required
            error={addError ?? undefined}
            hint="Se envía una sola vez por canal seguro; en reposo queda cifrada."
          >
            <Input
              id="llm-key-value"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        </div>
      </Modal>

      {/* Confirmación de borrado (soft-delete §19.2) */}
      <Modal
        open={keyToDelete != null}
        onClose={() => setKeyToDelete(null)}
        title="Eliminar API key"
        description={
          keyToDelete
            ? `${PROVIDER_LABELS[keyToDelete.provider]} · ${keyToDelete.label} ····${keyToDelete.last4}`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setKeyToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={submitDelete} disabled={pending}>
              {pending ? "Eliminando…" : "Eliminar"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Los nuevos agent runs dejarán de poder usarla. Los runs pasados conservan su
          referencia en el audit log (soft-delete).
        </p>
        {deleteError ? (
          <p role="alert" className="mt-2 text-xs text-accent-danger">
            {deleteError}
          </p>
        ) : null}
      </Modal>
    </Card>
  );
}
