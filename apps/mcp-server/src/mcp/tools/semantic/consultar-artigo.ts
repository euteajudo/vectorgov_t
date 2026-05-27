/**
 * Tool MCP: `consultar_artigo`
 *
 * Lookup direto de um dispositivo pela tripla (norma, artigo, [paragrafo,
 * inciso, alinea]). Não usa embedding nem FTS — query SQL pura sobre D1.
 *
 * Quando usar: o agente já sabe o artigo exato ("Art. 5º da CF") e quer
 * o texto vigente sem custo de embedding.
 */

import type { Env } from "../../../env.js";
import {
  ConsultarArtigoInput,
  type ConsultarArtigoOutputT,
} from "@vectorgov-t/schemas";
import { buildHierarquiaPath, buildDispositivoId } from "../../../lib/citation.js";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

/**
 * Estrutura crua devolvida pelo D1 ao juntar `dispositivos` + versão vigente.
 */
interface DispositivoRow {
  dispositivo_id: string;
  norma_id: string;
  artigo: number | null;
  paragrafo: number | null;
  inciso: string | null;
  alinea: string | null;
  hierarquia_path: string;
  texto: string;
  data_inicio: string;
  data_fim: string | null;
  norma_que_alterou: string | null;
  norma_label: string | null;
}

async function handler(args: unknown, env: Env): Promise<ConsultarArtigoOutputT> {
  const parsed = ConsultarArtigoInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "consultar_artigo: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  // Constrói o hierarquia_path canônico para a busca exata.
  const hierarquia = buildHierarquiaPath({
    norma_id: input.norma_id,
    artigo: input.artigo,
    paragrafo: input.paragrafo ?? null,
    inciso: input.inciso ?? null,
    alinea: input.alinea ?? null,
  });

  // Versão vigente: data_fim IS NULL ordenado por data_inicio DESC.
  // JOIN com normas só para pegar `ementa` (usado como label legível).
  const sql = `
    SELECT
      d.id AS dispositivo_id,
      d.norma_id,
      d.artigo,
      d.paragrafo,
      d.inciso,
      d.alinea,
      d.hierarquia_path,
      v.texto,
      v.data_inicio,
      v.data_fim,
      v.norma_que_alterou,
      n.ementa AS norma_label
    FROM dispositivos d
    JOIN versoes_dispositivos v ON v.dispositivo_id = d.id
    LEFT JOIN normas n ON n.id = d.norma_id
    WHERE d.norma_id = ?
      AND d.hierarquia_path = ?
      AND v.data_fim IS NULL
    ORDER BY v.data_inicio DESC
    LIMIT 1
  `;

  const row = await env.DB
    .prepare(sql)
    .bind(input.norma_id, hierarquia)
    .first<DispositivoRow>();

  if (!row) {
    return {
      encontrado: false,
    };
  }

  return {
    encontrado: true,
    citacao: {
      norma_id: row.norma_id,
      norma_label: row.norma_label ?? row.norma_id,
      artigo: row.artigo,
      paragrafo: row.paragrafo,
      inciso: row.inciso,
      alinea: row.alinea,
      hierarquia_path: row.hierarquia_path,
    },
    texto: row.texto,
    versao_vigente: {
      data_inicio: row.data_inicio,
      data_fim: row.data_fim,
      norma_que_alterou: row.norma_que_alterou,
    },
  };
}

export const consultarArtigoTool: ToolDescriptor = {
  name: "consultar_artigo",
  description:
    "Lookup direto de um dispositivo (norma + artigo + opcional parágrafo/inciso/alínea). " +
    "Devolve o texto da versão vigente — sem embedding, custo mínimo. " +
    "Use quando o agente já conhece a referência exata.",
  inputSchema: zodToMcpSchema(ConsultarArtigoInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};

// Export interno usado em testes para verificar a chave canônica gerada.
export const __internal = { buildDispositivoId };
