/**
 * Tool MCP: `fs_ler_dispositivo`.
 *
 * Resolve o dispositivo no D1 por campos estruturados e, quando a versao
 * aponta para um artefato R2, le o Markdown gravado pelo pipeline. Se o R2
 * ainda nao estiver disponivel, cai para o texto vigente no D1.
 */

import type { Env } from "../../../env.js";
import {
  FsLerDispositivoInput,
  type FsLerDispositivoOutputT,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { approxTokenCount, truncateForTokens } from "../../../lib/tokens.js";

interface D1Row {
  texto: string;
  norma_id: string;
  artigo: number | null;
  paragrafo: number | string | null;
  inciso: string | null;
  alinea: string | null;
  hierarquia_path: string;
  norma_label: string | null;
  r2_path_versao: string | null;
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
  const raw = await obj.text();
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed) as { texto?: unknown };
      if (typeof json.texto === "string" && json.texto.length > 0) {
        return json.texto;
      }
    } catch {
      // Nao era JSON legado; continua como texto.
    }
  }
  return markdownBody(raw);
}

async function readFromD1(
  env: Env,
  input: {
    norma_id: string;
    artigo: number;
    paragrafo?: string | number;
    inciso?: string;
    alinea?: string;
  },
): Promise<D1Row | null> {
  const whereParts = ["d.norma_id = ?", "d.artigo = ?", "v.data_fim IS NULL"];
  const bind: unknown[] = [input.norma_id, input.artigo];
  addOptionalField(whereParts, bind, "d.paragrafo", input.paragrafo);
  addOptionalField(whereParts, bind, "d.inciso", input.inciso);
  addOptionalField(whereParts, bind, "d.alinea", input.alinea);

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
    WHERE ${whereParts.join(" AND ")}
    ORDER BY v.data_inicio DESC
    LIMIT 1
  `;
  return env.DB.prepare(sql).bind(...bind).first<D1Row>();
}

async function handler(
  args: unknown,
  env: Env,
): Promise<FsLerDispositivoOutputT> {
  const parsed = FsLerDispositivoInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "fs_ler_dispositivo: argumentos invalidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  const d1 = await readFromD1(env, input);
  if (!d1) {
    throw new ToolValidationError(
      `fs_ler_dispositivo: dispositivo '${input.norma_id}#art${input.artigo}' nao encontrado em D1`,
    );
  }

  const r2Text = await readTextFromR2(env, d1.r2_path_versao);
  const texto = r2Text ?? d1.texto;
  const fonte: "r2" | "d1" = r2Text ? "r2" : "d1";

  const { trecho, proximoCursor, truncado } = truncateForTokens(
    texto,
    input.max_tokens,
    input.cursor,
  );

  return {
    citacao: {
      norma_id: d1.norma_id,
      norma_label: d1.norma_label ?? d1.norma_id,
      artigo: d1.artigo,
      paragrafo: d1.paragrafo,
      inciso: d1.inciso,
      alinea: d1.alinea,
      hierarquia_path: d1.hierarquia_path,
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
    "Le o texto de um dispositivo resolvendo D1 + R2. Paginacao por max_tokens e cursor.",
  inputSchema: zodToMcpSchema(FsLerDispositivoInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
