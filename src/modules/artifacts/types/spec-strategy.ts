import { z } from "zod";

import { defineArtifactType } from "./definition";
import { nonEmptyString, stringList } from "./common";

/**
 * `spec.strategy` — §7.2 Strategy: audiencia, posicionamiento, propuesta de valor.
 */
export const specStrategyPayloadSchema = z.object({
  audiences: z
    .array(
      z.object({
        name: nonEmptyString,
        description: z.string().optional(),
        needs: stringList.default([]),
      }),
    )
    .min(1, "Define al menos una audiencia."),
  positioning: nonEmptyString,
  valueProposition: nonEmptyString,
  differentiators: stringList.default([]),
  toneOfVoice: z.object({
    attributes: stringList.default([]),
    notes: z.string().optional(),
  }),
});

export type SpecStrategyPayload = z.infer<typeof specStrategyPayloadSchema>;

export const specStrategyDefinition = defineArtifactType<SpecStrategyPayload>({
  type: "spec.strategy",
  schemaVersion: "1.0",
  label: "Estrategia",
  description: "Audiencias, posicionamiento, propuesta de valor y tono.",
  phase: "strategy",
  // §8.4: spec.intake → spec.strategy
  dependsOn: ["spec.intake"],
  requiredForGate: true,
  payloadSchema: specStrategyPayloadSchema,
});
