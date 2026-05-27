/**
 * Tool MCP: `fs_ler_dispositivo`
 *
 * Lê o texto de um dispositivo específico — R2 first, fallback D1.
 * Suporta paginação por `max_tokens` (default 4000, máx 8000) e `cursor`
 * (offset em caracteres), para não inundar o contexto do agente.
 *
 * Estratégia "R2 first":
 *   1. Tenta `R2_LEIS.get({norma_id}/art{N}/.../*.json)`.
 *   2. Se o objeto não existir, fallback para D1 (`versoes_dispositivos`
 *      vigente).
 *
 * O R2 hospeda o canônico já formatado; o D1 só é usado quando o R2
 * ainda não foi populado para aquele dispositivo (fase de ingestão).
 */

import type { Env } from "../../../env.js";
import {
  FsLerDispositivoInput,
  type FsLerDispositivoOutputT,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { buildHierarquiaPath, buildR2Path } from "../../../lib/citation.js";
import { approxTokenCount, truncateForTokens } from "../../../lib/tokens.js";

interface R2Payload {
  texto: string;
  norma_id?: string;
  norma_label?: string;
  artigo?: number | null;
  paragrafo?: number | null;
  inciso?: string | null;
  alinea?: string | null;
  hierarquia_path?: string;
}

interface D1Row {
  texto: string;
  norma_id: string;
  artigo: number | null;
  paragrafo: number | null;
  inciso: string | null;
  alinea: string | null;
  hierarquia_path: string;
  norma_label: string | null;
}

async function readFromR2(
  env: Env,
  key: string,
): Promise<R2Payload | null> {
  const obj = await env.R2_LEIS.get(key);
  if (!obj) return null;
  try {
    return (await obj.json()) as R2Payload;
  } catch {
    return null;
  }
}

async function readFromD1(
  env: Env,
  normaId: string,
  hierarquia: string,
): Promise<D1Row | null> {
  const sql = `
    SELECT
      v.texto,
      d.norma_id,
      d.artigo,
      d.paragrafo,
      d.inciso,
      d.alinea,
      d.hierarquia_path,
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
  return env.DB.prepare(sql).bind(normaId, hierarquia).first<D1Row>();
}

async function handler(
  args: unknown,
  env: Env,
): Promise<FsLerDispositivoOutputT> {
  const parsed = FsLerDispositivoInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "fs_ler_dispositivo: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  const ref = {
    norma_id: input.norma_id,
    artigo: input.artigo,
    paragrafo: input.paragrafo ?? null,
    inciso: input.inciso ?? null,
    alinea: input.alinea ?? null,
  };
  const hierarquia = buildHierarquiaPath(ref);
  const r2Key = buildR2Path(ref);

  // 1) Tenta R2
  let fonte: "r2" | "d1" = "r2";
  const r2 = await readFromR2(env, r2Key);
  let texto: string;
  let normaLabel = input.norma_id;

  if (r2 && typeof r2.texto === "string" && r2.texto.length > 0) {
    texto = r2.texto;
    normaLabel = r2.norma_label ?? normaLabel;
  } else {
    // 2) Fallback D1
    fonte = "d1";
    const d1 = await readFromD1(env, input.norma_id, hierarquia);
    if (!d1) {
      throw new ToolValidationError(
        `fs_ler_dispositivo: dispositivo '${input.norma_id}#${hierarquia}' não encontrado em R2 nem em D1`,
      );
    }
    texto = d1.texto;
    normaLabel = d1.norma_label ?? normaLabel;
  }

  const { trecho, proximoCursor, truncado } = truncateForTokens(
    texto,
    input.max_tokens,
    input.cursor,
  );

  return {
    citacao: {
      norma_id: input.norma_id,
      norma_label: normaLabel,
      artigo: input.artigo,
      paragrafo: input.paragrafo ?? null,
      inciso: input.inciso ?? null,
      alinea: input.alinea ?? null,
      hierarquia_path: hierarquia,
    },
    texto: trecho,
    tokens_aprox: approxTokenCount(trecho),
    proximo_cursor: proximoCursor,
    truncado,
    fonte,
  };
}

export const fsLerDispositivoTool: ToolDescriptor = {
  name: "fs_ler_dispositivo",
  description:
    "Lê o texto de um dispositivo (R2 com fallback D1). " +
    "Paginação por max_tokens (default 4000, máx 8000) e cursor em caracteres. " +
    "Devolve 'proximo_cursor' quando truncado.",
  inputSchema: zodToMcpSchema(FsLerDispositivoInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
