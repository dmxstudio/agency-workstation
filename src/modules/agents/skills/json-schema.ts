import { z } from "zod";

/**
 * Derivación de JSON Schema para structured outputs de proveedores LLM.
 *
 * Reglas (datos verificados de los APIs, junio 2026):
 * - Anthropic (`output_config.format.type: "json_schema"`): exige
 *   `additionalProperties: false` en los objetos y NO soporta
 *   minLength/maxLength/minimum/maximum/pattern/format y compañía.
 * - OpenAI (`response_format.json_schema`): mismo espíritu con `strict`.
 *
 * Estrategia: `z.toJSONSchema` (Zod 4) + post-proceso que ELIMINA los
 * keywords no soportados y fuerza `additionalProperties: false` en los
 * objetos cerrados. La pérdida de precisión es deliberada y segura: el
 * payload SIEMPRE se re-valida con el Zod completo en `parseProposal`
 * (restricción "Zod en cada escritura") — el JSON Schema solo guía al modelo.
 *
 * Caso especial: los records de Zod (p.ej. `design.tokens.colors`) emiten
 * `additionalProperties: <schema de valor>` — se conserva tal cual (es la
 * única forma de expresar un mapa abierto); si un proveedor lo rechaza, el
 * run reporta `invalid_request` y el humano sigue pudiendo editar a mano.
 */

/** Keywords que los structured outputs de los proveedores no soportan. */
const UNSUPPORTED_KEYWORDS = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "pattern",
  "format",
  "propertyNames",
  "default",
] as const;

type JsonSchemaNode = Record<string, unknown>;

function isObjectNode(value: unknown): value is JsonSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeNode(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) sanitizeNode(item);
    return;
  }
  if (!isObjectNode(node)) return;

  for (const keyword of UNSUPPORTED_KEYWORDS) {
    delete node[keyword];
  }

  if (node.type === "object") {
    if (isObjectNode(node.properties)) {
      // Objeto cerrado: additionalProperties: false obligatorio.
      if (node.additionalProperties === undefined || node.additionalProperties === true) {
        node.additionalProperties = false;
      }
    }
    // Records (additionalProperties: <schema>) se conservan; sanear el valor.
    if (isObjectNode(node.additionalProperties)) {
      sanitizeNode(node.additionalProperties);
    }
  }

  for (const key of ["properties", "$defs", "definitions"] as const) {
    const map = node[key];
    if (isObjectNode(map)) {
      for (const child of Object.values(map)) sanitizeNode(child);
    }
  }
  for (const key of ["items", "prefixItems", "anyOf", "oneOf", "allOf", "not"] as const) {
    if (node[key] !== undefined) sanitizeNode(node[key]);
  }
}

/**
 * JSON Schema apto para structured outputs, derivado del Zod del tipo de
 * artefacto. El Zod completo sigue siendo la única verdad de validación.
 */
export function zodToProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    unrepresentable: "any",
    io: "output",
  }) as JsonSchemaNode;
  delete jsonSchema.$schema;
  sanitizeNode(jsonSchema);
  return jsonSchema;
}

/**
 * Auditoría estática de un schema de proveedor (la usa el smoke):
 * devuelve las violaciones encontradas (keywords prohibidos u objetos
 * cerrados sin `additionalProperties: false`).
 */
export function findProviderSchemaViolations(
  schema: Record<string, unknown>,
  path = "$",
): string[] {
  const violations: string[] = [];

  function walk(node: unknown, nodePath: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${nodePath}[${index}]`));
      return;
    }
    if (!isObjectNode(node)) return;

    for (const keyword of UNSUPPORTED_KEYWORDS) {
      if (keyword in node) {
        violations.push(`${nodePath}: keyword no soportado \`${keyword}\``);
      }
    }
    if (node.type === "object" && isObjectNode(node.properties)) {
      if (node.additionalProperties !== false) {
        violations.push(`${nodePath}: objeto cerrado sin additionalProperties:false`);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "enum" || key === "required" || key === "const") continue;
      if (typeof value === "object" && value !== null) {
        walk(value, `${nodePath}.${key}`);
      }
    }
  }

  walk(schema, path);
  return violations;
}
