import { z } from "zod";

import { defineArtifactType } from "./definition";
import { nonEmptyString, stringList } from "./common";

/**
 * `spec.intake` — §7.2 Intake: objetivo, cliente, alcance y restricciones.
 * Brand & Identity se reduce en MVP a "brand inputs": el cliente trae su marca.
 */
export const specIntakePayloadSchema = z.object({
  /** Objetivo de negocio del proyecto, en una o pocas frases. */
  objective: nonEmptyString,
  client: z.object({
    name: nonEmptyString,
    industry: z.string().optional(),
    website: z.string().optional(),
    contactName: z.string().optional(),
    contactEmail: z.string().optional(),
  }),
  scope: z.object({
    /** Entregables dentro del alcance acordado. */
    inScope: stringList,
    /** Exclusiones explícitas (evita scope creep, §17-R1). */
    outOfScope: stringList,
  }),
  constraints: z.object({
    budget: z.string().optional(),
    /** Fecha objetivo (ISO `YYYY-MM-DD`) si existe. */
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida: usa el formato AAAA-MM-DD.")
      .optional(),
    technical: stringList.default([]),
    legal: stringList.default([]),
  }),
  /** Brand inputs (§7.2): la plataforma no genera marca en MVP. */
  brandInputs: z.object({
    hasLogo: z.boolean().default(false),
    hasStyleGuide: z.boolean().default(false),
    assetsUrl: z.string().optional(),
    notes: z.string().optional(),
  }),
  successCriteria: stringList.default([]),
});

export type SpecIntakePayload = z.infer<typeof specIntakePayloadSchema>;

export const specIntakeDefinition = defineArtifactType<SpecIntakePayload>({
  type: "spec.intake",
  schemaVersion: "1.0",
  label: "Intake del proyecto",
  description: "Objetivo, cliente, alcance, restricciones y brand inputs.",
  phase: "intake",
  dependsOn: [],
  requiredForGate: true,
  payloadSchema: specIntakePayloadSchema,
});
