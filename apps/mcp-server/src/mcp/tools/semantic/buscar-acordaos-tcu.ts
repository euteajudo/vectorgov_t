/**
 * Tool MCP: `buscar_acordaos_tcu`
 *
 * Busca semântica (embedding BGE-M3 → Vectorize `acordaos-tcu` → rerank
 * cross-encoder) na jurisprudência do TCU. Devolve até `top_k` trechos com
 * citação canônica e o texto do chunk.
 *
 * Quando usar: fundamentar a análise de reequilíbrio econômico-financeiro com
 * precedentes do TCU ("manutenção do equilíbrio em álea extraordinária",
 * "reajuste vs. reequilíbrio", "fato do príncipe"...). O agente cita o acórdão
 * pelo `label` retornado — NUNCA inventa número de acórdão.
 */
import { z } from "zod";
import type { Env } from "../../../env.js";
import { buscarAcordaosTcu } from "../../../lib/acordaos-search.js";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

const BuscarAcordaosTcuInput = z.object({
  query: z.string().min(3, "query deve ter ao menos 3 caracteres"),
  top_k: z.number().int().min(1).max(10).default(5),
  filtros: z
    .object({
      colegiado: z
        .enum(["plenario", "primeira_camara", "segunda_camara"])
        .optional(),
      ano: z.number().int().optional(),
      // Só seções presentes no índice SEMÂNTICO (Vectorize). O ingestor
      // (routeChunk no vectorgov-a-mcp) roteia `relatorio` e `cabecalho` para
      // FTS5/D1 apenas (vectorize=false) — filtrar por eles aqui devolveria []
      // silenciosamente. Relatório/termos exatos: usar a busca lexical (FTS5).
      secao: z.enum(["sumario", "voto", "acordao", "enunciado"]).optional(),
    })
    .optional(),
});

type BuscarAcordaosTcuInputT = z.infer<typeof BuscarAcordaosTcuInput>;

async function handler(args: unknown, env: Env): Promise<unknown> {
  const parsed = BuscarAcordaosTcuInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "buscar_acordaos_tcu: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input: BuscarAcordaosTcuInputT = parsed.data;

  const hits = await buscarAcordaosTcu(env, {
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
      score: h.score,
    })),
    total: hits.length,
    query_normalizada: input.query.trim(),
    metodo: "vectorize_rerank",
  };
}

export const buscarAcordaosTcuTool: ToolDescriptor = {
  name: "buscar_acordaos_tcu",
  description:
    "Busca semântica na jurisprudência do TCU (acórdãos) — embedding BGE-M3 no " +
    "índice acordaos-tcu + rerank cross-encoder. Use para fundamentar a análise " +
    "de reequilíbrio com precedentes do TCU. Devolve trechos com citação canônica " +
    "(label: 'Acórdão N/ano-TCU-Colegiado, seção'). Cite SEMPRE pelo label " +
    "retornado — nunca invente número de acórdão. Cobre as seções de tese " +
    "(sumário, voto, acórdão, enunciado); o relatório (recitação fática) fica " +
    "fora do índice semântico. Filtros opcionais: colegiado, ano, seção.",
  inputSchema: zodToMcpSchema(BuscarAcordaosTcuInput),
  handler,
};
