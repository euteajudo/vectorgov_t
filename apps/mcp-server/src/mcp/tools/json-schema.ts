/**
 * Adaptador: converte um schema Zod v4 em JSON Schema Draft 2020-12 plain,
 * adequado para o campo `inputSchema` exposto pelo MCP.
 *
 * Por que custom em vez de só `z.toJSONSchema()`:
 *   - Removemos meta-campos `$schema`/`id` opcionais que poluem o catálogo
 *     visto pelo agente.
 *   - Garantimos `additionalProperties: false` em objetos top-level
 *     (default do Zod v4 é não setar) — o MCP Inspector mostra warning
 *     em schemas "open".
 */

import { z } from "zod";

/**
 * Converte para JSON Schema com normalizações específicas do MCP.
 */
export function zodToMcpSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  // Limpamos meta-keys do envelope que o MCP não usa.
  delete raw["$schema"];
  delete raw["id"];
  // Para `type: object` no topo, forçamos additionalProperties: false
  // a menos que já tenha sido definido como `true` explicitamente.
  if (raw.type === "object" && raw.additionalProperties === undefined) {
    raw.additionalProperties = false;
  }
  return raw;
}
