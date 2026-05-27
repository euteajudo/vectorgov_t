/**
 * Tool MCP: `comparar_redacoes`
 *
 * Compara duas versões de um dispositivo (por data) e devolve um diff
 * estruturado palavra-a-palavra. Quando `data_a`/`data_b` não são
 * informadas, usa a primeira e a última versões registradas.
 *
 * Útil para o agente reportar mudanças entre redações sem precisar
 * mandar todo o texto cru para o LLM.
 */

import type { Env } from "../../../env.js";
import {
  CompararRedacoesInput,
  type CompararRedacoesOutputT,
  type Versao,
} from "@vectorgov-t/schemas";
import { wordDiff, countWords } from "../../../lib/diff.js";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

interface VersaoRow {
  data_inicio: string;
  data_fim: string | null;
  texto: string;
  norma_que_alterou: string | null;
}

/**
 * Busca versão por data (vigente em `data`) ou cai para a mais antiga/recente.
 */
async function fetchVersao(
  env: Env,
  dispositivoId: string,
  data: string | undefined,
  fallback: "primeira" | "ultima",
): Promise<VersaoRow | null> {
  if (data) {
    // Versão vigente na data: data_inicio <= data < (data_fim || infinity).
    const sql = `
      SELECT data_inicio, data_fim, texto, norma_que_alterou
      FROM versoes_dispositivos
      WHERE dispositivo_id = ?
        AND data_inicio <= ?
        AND (data_fim IS NULL OR data_fim > ?)
      ORDER BY data_inicio DESC
      LIMIT 1
    `;
    return env.DB.prepare(sql).bind(dispositivoId, data, data).first<VersaoRow>();
  }
  // Fallback — primeira ou última versão registrada.
  const order = fallback === "primeira" ? "ASC" : "DESC";
  const sql = `
    SELECT data_inicio, data_fim, texto, norma_que_alterou
    FROM versoes_dispositivos
    WHERE dispositivo_id = ?
    ORDER BY data_inicio ${order}
    LIMIT 1
  `;
  return env.DB.prepare(sql).bind(dispositivoId).first<VersaoRow>();
}

function toVersao(row: VersaoRow): Versao {
  return {
    data_inicio: row.data_inicio,
    data_fim: row.data_fim,
    texto: row.texto,
    norma_que_alterou: row.norma_que_alterou,
  };
}

async function handler(args: unknown, env: Env): Promise<CompararRedacoesOutputT> {
  const parsed = CompararRedacoesInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "comparar_redacoes: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  const [a, b] = await Promise.all([
    fetchVersao(env, input.dispositivo_id, input.data_a, "primeira"),
    fetchVersao(env, input.dispositivo_id, input.data_b, "ultima"),
  ]);

  if (!a || !b) {
    throw new ToolValidationError(
      `comparar_redacoes: dispositivo '${input.dispositivo_id}' não possui versões suficientes para comparação`,
    );
  }

  const versaoA = toVersao(a);
  const versaoB = toVersao(b);
  const diffSegs = wordDiff(versaoA.texto, versaoB.texto);
  const totals = countWords(diffSegs);

  return {
    dispositivo_id: input.dispositivo_id,
    versao_a: versaoA,
    versao_b: versaoB,
    diff: diffSegs,
    resumo: {
      palavras_iguais: totals.iguais,
      palavras_adicionadas: totals.adicionadas,
      palavras_removidas: totals.removidas,
    },
  };
}

export const compararRedacoesTool: ToolDescriptor = {
  name: "comparar_redacoes",
  description:
    "Compara duas versões de um dispositivo e devolve diff palavra-a-palavra " +
    "(segmentos igual/adicionado/removido) + resumo de contagens. " +
    "Datas opcionais — sem datas, usa primeira vs. última versão registrada.",
  inputSchema: zodToMcpSchema(CompararRedacoesInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
