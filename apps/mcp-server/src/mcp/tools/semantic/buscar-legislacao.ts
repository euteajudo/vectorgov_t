/**
 * Tool MCP: `buscar_legislacao`
 *
 * Busca híbrida (dense + lexical + RRF + rerank) sobre a base de normas.
 * Devolve até `top_k` snippets com citação canônica e score combinado.
 *
 * Quando usar: pesquisas semânticas livres — "como funciona o regime
 * tributário do simples nacional?", "preferência de microempresas em
 * licitações", etc. Para lookup exato de um artigo conhecido, use
 * `consultar_artigo` (mais barato e determinístico).
 */

import type { Env } from "../../../env.js";
import {
  BuscarLegislacaoInput,
  type BuscarLegislacaoInputT,
  type BuscarLegislacaoOutputT,
} from "@vectorgov-t/schemas";
import { hybridSearch } from "../../../lib/hybrid-search.js";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

/**
 * Handler — valida input, dispara `hybridSearch`, monta o output.
 */
async function handler(args: unknown, env: Env): Promise<BuscarLegislacaoOutputT> {
  const parsed = BuscarLegislacaoInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "buscar_legislacao: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input: BuscarLegislacaoInputT = parsed.data;

  const hits = await hybridSearch(env, {
    query: input.query,
    topK: input.top_k,
    filtros: input.filtros,
  });

  const resultados = hits.map((h) => ({
    citacao: h.snippet.citacao,
    texto: h.snippet.texto,
    score: h.scoreFinal,
    tipo_dispositivo: h.snippet.tipo_dispositivo,
  }));

  return {
    resultados,
    total: resultados.length,
    query_normalizada: input.query.trim().toLowerCase(),
    metodo: "hybrid_rrf_rerank",
  };
}

/**
 * Descritor exportado — consumido pelo registry em `mcp/tools/index.ts`.
 */
export const buscarLegislacaoTool: ToolDescriptor = {
  name: "buscar_legislacao",
  description:
    "Busca semântica híbrida (vetorial + BM25 + RRF + re-rank) na base de normas. " +
    "Use para perguntas livres em linguagem natural. " +
    "Aceita filtros opcionais por lei, tema e tipo_dispositivo.",
  inputSchema: zodToMcpSchema(BuscarLegislacaoInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
