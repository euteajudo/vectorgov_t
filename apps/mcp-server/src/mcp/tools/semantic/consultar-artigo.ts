/**
 * Tool MCP: `consultar_artigo`.
 *
 * Lookup direto de um dispositivo pela norma, artigo e niveis opcionais.
 * Usa campos estruturados do D1, nao `hierarquia_path`, porque o parser grava
 * um caminho legivel enquanto as chamadas da tool recebem referencias
 * canonicas simples.
 */

import type { Env } from "../../../env.js";
import {
  ConsultarArtigoInput,
  type ConsultarArtigoOutputT,
} from "@vectorgov-t/schemas";
import { buildDispositivoId } from "../../../lib/citation.js";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

interface DispositivoRow {
  dispositivo_id: string;
  norma_id: string;
  artigo: number | null;
  paragrafo: number | string | null;
  inciso: string | null;
  alinea: string | null;
  hierarquia_path: string;
  texto: string;
  data_inicio: string;
  data_fim: string | null;
  norma_que_alterou: string | null;
  norma_label: string | null;
}

function addOptionalField(
  whereParts: string[],
  bind: unknown[],
  column: string,
  value: string | number | undefined,
): void {
  if (value === undefined) {
    whereParts.push(`${column} IS NULL`);
    return;
  }
  whereParts.push(`${column} = ?`);
  bind.push(String(value));
}

async function handler(args: unknown, env: Env): Promise<ConsultarArtigoOutputT> {
  const parsed = ConsultarArtigoInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "consultar_artigo: argumentos invalidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  // Vigência: por padrão a redação ATUAL (data_fim IS NULL). Quando
  // `data_referencia` é informada, resolve a redação em vigor NAQUELA data
  // (transição da Reforma muda a redação por competência).
  const whereParts = ["d.norma_id = ?", "d.artigo = ?"];
  const bind: unknown[] = [input.norma_id, input.artigo];
  if (input.data_referencia) {
    whereParts.push("v.data_inicio <= ?", "(v.data_fim IS NULL OR v.data_fim > ?)");
    bind.push(input.data_referencia, input.data_referencia);
  } else {
    whereParts.push("v.data_fim IS NULL");
  }
  addOptionalField(whereParts, bind, "d.paragrafo", input.paragrafo);
  addOptionalField(whereParts, bind, "d.inciso", input.inciso);
  addOptionalField(whereParts, bind, "d.alinea", input.alinea);

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
    WHERE ${whereParts.join(" AND ")}
    ORDER BY v.data_inicio DESC
    LIMIT 1
  `;

  const row = await env.DB.prepare(sql).bind(...bind).first<DispositivoRow>();

  if (!row) {
    return { encontrado: false };
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
    "Lookup direto de um dispositivo (norma + artigo + opcional paragrafo/inciso/alinea). " +
    "Devolve o texto da versao vigente sem embedding. Aceita `data_referencia` " +
    "(YYYY-MM-DD) para resolver a redacao em vigor por competencia (vigencia historica); " +
    "sem ela, devolve a redacao atual.",
  inputSchema: zodToMcpSchema(ConsultarArtigoInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};

export const __internal = { buildDispositivoId };
