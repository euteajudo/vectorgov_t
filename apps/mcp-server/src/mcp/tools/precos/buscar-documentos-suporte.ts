/**
 * Tool MCP `buscar_documentos_suporte` (Track D) — Módulo C.
 *
 * Lista ARPs (Atas de Registro de Preço) por janela e órgão como documentos de
 * suporte da pesquisa de preço (exigência legal). MVP "por órgão+período": não
 * há vínculo 1:1 entre o idCompra do Compras.gov e o numeroControlePNCP, então
 * a tool devolve candidatas — o agente escolhe a aderente.
 */
import type { Env } from "../../../env.js";
import {
  BuscarDocumentosInputSchema,
  type BuscarDocumentosOutput,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { consultarAtas } from "../../../lib/pncp-consulta.js";

async function handler(args: unknown, env: Env): Promise<BuscarDocumentosOutput> {
  const parsed = BuscarDocumentosInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "buscar_documentos_suporte: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;
  const docs = await consultarAtas(env, {
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    cnpj_orgao: input.cnpj_orgao,
  });
  const documentos = docs.slice(0, input.max);
  return { fonte: "pncp_atas", total: documentos.length, documentos };
}

export const buscarDocumentosSuporteTool: ToolDescriptor = {
  name: "buscar_documentos_suporte",
  description:
    "Lista ARPs (Atas de Registro de Preço) do PNCP por janela e órgão como " +
    "documentos de suporte da pesquisa de preço (exigência legal). Candidatas por " +
    "órgão+período — o agente escolhe a aderente ao objeto.",
  inputSchema: zodToMcpSchema(BuscarDocumentosInputSchema),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
