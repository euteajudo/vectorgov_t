/**
 * Tool MCP `buscar_catalogo_semantico` (Track D).
 *
 * Resolve "descrição do objeto → código CATMAT/CATSER" por busca híbrida
 * (semântica bge-m3 + FTS5/BM25, RRF + rerank) sobre o repositório de catálogo.
 * Pré-requisito da pesquisa de preço (`consultar_precos_praticados`).
 */
import type { Env } from "../../../env.js";
import {
  BuscarCatalogoInputSchema,
  type CatalogoBuscaResultado,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { buscarCatalogoHibrido } from "../../../lib/catalogo-search.js";

async function handler(args: unknown, env: Env): Promise<CatalogoBuscaResultado> {
  const parsed = BuscarCatalogoInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "buscar_catalogo_semantico: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  return buscarCatalogoHibrido(env, parsed.data);
}

export const buscarCatalogoSemanticoTool: ToolDescriptor = {
  name: "buscar_catalogo_semantico",
  description:
    "Resolve a descrição de um objeto no código de catálogo CATMAT/CATSER por " +
    "busca semântica + lexical (RRF + rerank). Use antes de consultar_precos_praticados.",
  inputSchema: zodToMcpSchema(BuscarCatalogoInputSchema),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
