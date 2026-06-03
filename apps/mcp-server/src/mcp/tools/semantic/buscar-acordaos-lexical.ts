/**
 * Tool MCP: `buscar_acordaos_lexical`
 *
 * Busca LEXICAL (SQLite FTS5 + bm25) na jurisprudência do TCU — D1
 * `vectorgov-a-db`, tabela `itens_fts`. Complementa `buscar_acordaos_tcu`
 * (semântica): cobre TODOS os chunks, incluindo o `relatorio` que fica fora do
 * índice vetorial.
 *
 * Quando usar: termo EXATO, número de processo (ex.: "023.262/2017-6"), nome de
 * relator, expressão literal, ou quando o usuário cita um trecho. Para busca por
 * conceito/significado, use `buscar_acordaos_tcu`. O agente cita pelo `label`
 * retornado — NUNCA inventa número de acórdão.
 */
import { z } from "zod";
import type { Env } from "../../../env.js";
import { buscarAcordaosLexical } from "../../../lib/acordaos-lexical.js";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

const BuscarAcordaosLexicalInput = z.object({
  query: z.string().min(3, "query deve ter ao menos 3 caracteres"),
  top_k: z.number().int().min(1).max(10).default(5),
  filtros: z
    .object({
      colegiado: z
        .enum(["plenario", "primeira_camara", "segunda_camara"])
        .optional(),
      ano: z.number().int().optional(),
      // No FTS5 estão TODAS as seções com fts=true — incluindo `relatorio`
      // (que a busca semântica não cobre). `cabecalho` não vai ao FTS.
      secao: z
        .enum(["sumario", "relatorio", "voto", "acordao", "enunciado"])
        .optional(),
    })
    .optional(),
});

type BuscarAcordaosLexicalInputT = z.infer<typeof BuscarAcordaosLexicalInput>;

async function handler(args: unknown, env: Env): Promise<unknown> {
  const parsed = BuscarAcordaosLexicalInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "buscar_acordaos_lexical: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input: BuscarAcordaosLexicalInputT = parsed.data;

  const hits = await buscarAcordaosLexical(env, {
    query: input.query,
    top_k: input.top_k,
    filtros: input.filtros,
  });

  return {
    resultados: hits.map((h) => ({
      citacao: {
        item_id: h.item_id,
        acordao_id: h.acordao_id,
        numero: h.numero,
        ano: h.ano,
        colegiado: h.colegiado,
        secao: h.secao,
        rotulo: h.rotulo,
        relator: h.relator,
        tipo_dispositivo: h.tipo_dispositivo,
        label: h.label,
        r2_key: h.r2_key,
      },
      texto: h.texto,
      destaque: h.destaque,
      score: h.score,
    })),
    total: hits.length,
    query_normalizada: input.query.trim(),
    metodo: "fts5_bm25",
  };
}

export const buscarAcordaosLexicalTool: ToolDescriptor = {
  name: "buscar_acordaos_lexical",
  description:
    "Busca LEXICAL (texto exato, FTS5 + bm25) na jurisprudência do TCU — D1 " +
    "vectorgov-a-db. Complementa buscar_acordaos_tcu (semântica): cobre TODAS as " +
    "seções, incluindo o relatório (recitação fática). Use para termo exato, " +
    "número de processo, nome de relator ou citação literal. Casamento sem " +
    "acento. Devolve trechos com citação canônica (label) + destaque do termo. " +
    "Cite SEMPRE pelo label retornado — nunca invente número de acórdão. " +
    "Filtros opcionais: colegiado, ano, seção.",
  inputSchema: zodToMcpSchema(BuscarAcordaosLexicalInput),
  handler,
};
