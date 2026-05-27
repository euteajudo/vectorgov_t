/**
 * Tool MCP: `listar_artigos_por_tema`
 *
 * Recupera dispositivos relevantes para um tema (curado / taxonomia)
 * usando o índice Vectorize com filtro de metadata `tema`.
 *
 * Quando usar: o agente quer panorama temático ("quais artigos tratam
 * de licitação de obras?") em vez de busca livre.
 *
 * Implementação: embed do nome do tema + query Vectorize com filtros.
 * Para temas já cobertos pelo nosso índice de metadata, isso é mais
 * preciso que `buscar_legislacao` (busca textual pura tende a divergir
 * em sinônimos do tema).
 */

import type { Env } from "../../../env.js";
import {
  ListarArtigosPorTemaInput,
  type ListarArtigosPorTemaOutputT,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";

/**
 * Trunca o preview para 280 chars — suficiente para o agente decidir
 * se quer chamar `fs_ler_dispositivo` em seguida.
 */
function preview(texto: string, max = 280): string {
  if (texto.length <= max) return texto;
  return texto.slice(0, max - 3) + "...";
}

async function handler(
  args: unknown,
  env: Env,
): Promise<ListarArtigosPorTemaOutputT> {
  const parsed = ListarArtigosPorTemaInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "listar_artigos_por_tema: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  // Embed do nome do tema — usado como vetor de query.
  const embedResp = (await env.AI.run(EMBEDDING_MODEL, {
    text: [input.tema],
  })) as { data: number[][] };
  const vec = embedResp?.data?.[0];
  if (!Array.isArray(vec)) {
    throw new Error(
      "listar_artigos_por_tema: falha ao gerar embedding do tema",
    );
  }

  const filter: Record<string, unknown> = {};
  if (input.lei) filter.norma_id = input.lei;

  const queryOpts: VectorizeQueryOptions = {
    topK: input.top_k,
    returnMetadata: "all",
  };
  if (Object.keys(filter).length > 0) {
    queryOpts.filter = filter as VectorizeVectorMetadataFilter;
  }

  const res = await env.VECTORIZE.query(vec, queryOpts);

  const artigos = (res.matches ?? []).map((m) => {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const norma_id = (meta.norma_id as string) ?? "";
    return {
      citacao: {
        norma_id,
        norma_label: (meta.norma_label as string) ?? norma_id,
        artigo: (meta.artigo as number | null) ?? null,
        paragrafo: (meta.paragrafo as number | string | null) ?? null,
        inciso: (meta.inciso as string | null) ?? null,
        alinea: (meta.alinea as string | null) ?? null,
        hierarquia_path:
          (meta.hierarquia_path as string | undefined) ??
          (meta.hierarquia as string | undefined) ??
          "",
      },
      score: m.score,
      preview: preview(
        ((meta.texto as string | undefined) ??
          (meta.texto_preview as string | undefined) ??
          ""),
      ),
    };
  });

  return {
    tema: input.tema,
    artigos,
    total: artigos.length,
  };
}

export const listarArtigosPorTemaTool: ToolDescriptor = {
  name: "listar_artigos_por_tema",
  description:
    "Lista dispositivos cujo metadata 'tema' bate com o tema informado, " +
    "ordenados por similaridade. " +
    "Use para visão temática (ex.: 'todos os artigos sobre microempresas em licitação').",
  inputSchema: zodToMcpSchema(ListarArtigosPorTemaInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
