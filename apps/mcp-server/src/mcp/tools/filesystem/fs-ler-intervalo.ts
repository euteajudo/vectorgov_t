/**
 * Tool MCP: `fs_ler_intervalo`
 *
 * Lê em paralelo um intervalo de artigos `[artigo_inicio, artigo_fim]` de
 * uma norma. Limite duro de 20 artigos por chamada (proteção contra
 * estouros de contexto e de subrequest budget do Worker).
 *
 * Para cada artigo tenta R2 primeiro, depois D1 (mesma estratégia do
 * `fs_ler_dispositivo`). Falhas individuais não abortam o lote — o item
 * é simplesmente omitido e `truncado=true` sinaliza que houve perda.
 */

import type { Env } from "../../../env.js";
import {
  FsLerIntervaloInput,
  type FsLerIntervaloOutputT,
  type Citacao,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { buildHierarquiaPath, buildR2Path } from "../../../lib/citation.js";

/** Limite duro do intervalo. */
const MAX_INTERVAL = 20;

interface R2Payload {
  texto: string;
  norma_label?: string;
  hierarquia_path?: string;
}

interface D1ArtigoRow {
  texto: string;
  norma_id: string;
  artigo: number | null;
  paragrafo: number | null;
  inciso: string | null;
  alinea: string | null;
  hierarquia_path: string;
  norma_label: string | null;
}

interface DispositivoResolvido {
  citacao: Citacao;
  texto: string;
  fonte: "r2" | "d1";
}

async function tryR2(env: Env, norma: string, artigo: number): Promise<DispositivoResolvido | null> {
  const ref = { norma_id: norma, artigo, paragrafo: null, inciso: null, alinea: null };
  const key = buildR2Path(ref);
  const obj = await env.R2_LEIS.get(key);
  if (!obj) return null;
  try {
    const data = (await obj.json()) as R2Payload;
    if (!data?.texto) return null;
    return {
      citacao: {
        norma_id: norma,
        norma_label: data.norma_label ?? norma,
        artigo,
        paragrafo: null,
        inciso: null,
        alinea: null,
        hierarquia_path: data.hierarquia_path ?? buildHierarquiaPath(ref),
      },
      texto: data.texto,
      fonte: "r2",
    };
  } catch {
    return null;
  }
}

async function tryD1(env: Env, norma: string, artigo: number): Promise<DispositivoResolvido | null> {
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
      AND d.artigo = ?
      AND d.paragrafo IS NULL
      AND d.inciso IS NULL
      AND d.alinea IS NULL
      AND v.data_fim IS NULL
    ORDER BY v.data_inicio DESC
    LIMIT 1
  `;
  const row = await env.DB.prepare(sql).bind(norma, artigo).first<D1ArtigoRow>();
  if (!row) return null;
  return {
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
    fonte: "d1",
  };
}

async function handler(args: unknown, env: Env): Promise<FsLerIntervaloOutputT> {
  const parsed = FsLerIntervaloInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "fs_ler_intervalo: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;
  if (input.artigo_fim < input.artigo_inicio) {
    throw new ToolValidationError(
      "fs_ler_intervalo: artigo_fim deve ser >= artigo_inicio",
    );
  }

  const tamanho = input.artigo_fim - input.artigo_inicio + 1;
  const truncado = tamanho > MAX_INTERVAL;
  const limite = truncado ? input.artigo_inicio + MAX_INTERVAL - 1 : input.artigo_fim;

  const artigos: number[] = [];
  for (let i = input.artigo_inicio; i <= limite; i++) artigos.push(i);

  const results = await Promise.all(
    artigos.map(async (n) => {
      const fromR2 = await tryR2(env, input.norma_id, n);
      if (fromR2) return fromR2;
      return tryD1(env, input.norma_id, n);
    }),
  );

  const dispositivos = results.filter(
    (r): r is DispositivoResolvido => r !== null,
  );

  return {
    norma_id: input.norma_id,
    dispositivos,
    total: dispositivos.length,
    truncado,
  };
}

export const fsLerIntervaloTool: ToolDescriptor = {
  name: "fs_ler_intervalo",
  description:
    "Lê em paralelo um intervalo de artigos [artigo_inicio, artigo_fim] de uma norma " +
    "(R2 first com fallback D1). Máximo 20 artigos por chamada — excedente é truncado.",
  inputSchema: zodToMcpSchema(FsLerIntervaloInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
