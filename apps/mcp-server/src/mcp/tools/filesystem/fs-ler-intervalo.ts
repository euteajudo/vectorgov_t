/**
 * Tool MCP: `fs_ler_intervalo`.
 *
 * Le artigos raiz em intervalo [artigo_inicio, artigo_fim]. Para cada artigo,
 * resolve a versao vigente no D1 e tenta carregar o Markdown em R2 pela chave
 * `r2_path_versao` gravada pelo pipeline.
 */

import type { Env } from "../../../env.js";
import {
  FsLerIntervaloInput,
  type FsLerIntervaloOutputT,
  type Citacao,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

const MAX_INTERVAL = 20;

interface D1ArtigoRow {
  texto: string;
  r2_path_versao: string | null;
  norma_id: string;
  artigo: number | null;
  paragrafo: number | string | null;
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

function markdownBody(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized;
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return normalized;
  return normalized.slice(end + 4).replace(/^\n+/, "");
}

async function readTextFromR2(env: Env, key: string | null): Promise<string | null> {
  if (!key) return null;
  const obj = await env.R2_LEIS.get(key);
  if (!obj) return null;
  return markdownBody(await obj.text());
}

async function tryD1(env: Env, norma: string, artigo: number): Promise<D1ArtigoRow | null> {
  const sql = `
    SELECT
      v.texto,
      v.r2_path_versao,
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
  return env.DB.prepare(sql).bind(norma, artigo).first<D1ArtigoRow>();
}

async function resolveArtigo(
  env: Env,
  norma: string,
  artigo: number,
): Promise<DispositivoResolvido | null> {
  const row = await tryD1(env, norma, artigo);
  if (!row) return null;
  const r2Text = await readTextFromR2(env, row.r2_path_versao);
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
    texto: r2Text ?? row.texto,
    fonte: r2Text ? "r2" : "d1",
  };
}

async function handler(args: unknown, env: Env): Promise<FsLerIntervaloOutputT> {
  const parsed = FsLerIntervaloInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "fs_ler_intervalo: argumentos invalidos",
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
    artigos.map((n) => resolveArtigo(env, input.norma_id, n)),
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
    "Le em paralelo um intervalo de artigos [artigo_inicio, artigo_fim]. Maximo 20 artigos por chamada.",
  inputSchema: zodToMcpSchema(FsLerIntervaloInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
