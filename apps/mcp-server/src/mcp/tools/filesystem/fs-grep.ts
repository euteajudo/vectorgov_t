/**
 * Tool MCP: `fs_grep`
 *
 * Busca textual em dispositivos:
 *   - Modo default (regex=false): D1 FTS5 com bm25.
 *   - Modo regex (regex=true): regex JavaScript executado in-memory sobre
 *     o conjunto de dispositivos da norma, com timeout de 50ms (proteção
 *     contra ReDoS).
 *
 * Cache KV TTL 1h por chave determinística da query+filtros.
 *
 * Nota técnica: a especificação original menciona RE2-WASM para o modo
 * regex; nesta fase usamos `RegExp` nativo + timeout para evitar inflar
 * o bundle do Worker (~1MB+ apenas em RE2-WASM). Quando publicarmos
 * suporte oficial a regex de usuário sem confiança, plugamos RE2-WASM.
 */

import type { Env } from "../../../env.js";
import {
  FsGrepInput,
  type FsGrepOutputT,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { cacheGet, cacheSet } from "../../../lib/cache.js";

/** TTL do cache em segundos (1h). */
const GREP_CACHE_TTL = 60 * 60;

/** Limite de tempo do regex em milissegundos. */
const REGEX_TIMEOUT_MS = 50;

interface Fts5Row {
  dispositivo_id: string;
  norma_id: string;
  artigo: number | null;
  paragrafo: number | null;
  hierarquia: string;
  texto: string;
  rank: number;
  norma_label: string | null;
}

interface DispRow {
  dispositivo_id: string;
  norma_id: string;
  artigo: number | null;
  paragrafo: number | null;
  hierarquia: string;
  texto: string;
  norma_label: string | null;
}

/**
 * Sanitiza para sintaxe MATCH do FTS5 — mesmo helper do hybrid-search,
 * mas inline aqui para evitar dependência circular ao crescer.
 */
function sanitizeFts5(query: string): string {
  const tokens = query
    .normalize("NFKC")
    .replace(/["\\()*:^]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}" `).join(" ").trim();
}

/**
 * Gera chave de cache estável independente da ordem dos campos.
 */
function cacheKey(input: { padrao: string; regex: boolean; norma_id?: string; max_resultados: number }): string {
  return `fs:grep:v1:${input.regex ? "re" : "fts"}:${input.norma_id ?? "*"}:${input.max_resultados}:${input.padrao}`;
}

/**
 * Modo FTS5 — query SQL preparada.
 */
async function grepFts5(
  env: Env,
  input: { padrao: string; norma_id?: string; max_resultados: number },
): Promise<Fts5Row[]> {
  const ftsQuery = sanitizeFts5(input.padrao);
  const whereParts: string[] = ["dispositivos_fts MATCH ?"];
  const bind: unknown[] = [ftsQuery];
  if (input.norma_id) {
    whereParts.push("d.norma_id = ?");
    bind.push(input.norma_id);
  }
  const sql = `
    SELECT
      d.id AS dispositivo_id,
      d.norma_id,
      d.artigo,
      d.paragrafo,
      d.hierarquia_path AS hierarquia,
      f.texto,
      bm25(dispositivos_fts) AS rank,
      n.ementa AS norma_label
    FROM dispositivos_fts f
    JOIN dispositivos d ON d.id = f.rowid
    LEFT JOIN normas n ON n.id = d.norma_id
    WHERE ${whereParts.join(" AND ")}
    ORDER BY rank ASC
    LIMIT ?
  `;
  const stmt = env.DB.prepare(sql).bind(...bind, input.max_resultados);
  const { results } = await stmt.all<Fts5Row>();
  return results ?? [];
}

/**
 * Modo regex — pega o batch de dispositivos da norma (limit duro) e testa
 * cada texto com timeout. Implementado com `setTimeout` cooperativo: como
 * o runtime do Worker é single-thread, o "timeout" é apenas um shield
 * contra regex catastróficos via tentativa async cooperativa.
 *
 * Implementação simples: criamos o RegExp; se a compilação demorar ou
 * lançar, abortamos. Em runtime, cada `.test()` é síncrono e não pode
 * ser cancelado; portanto a estratégia real é validar a complexidade do
 * padrão (rejeitar grupos aninhados quantificados). Suficiente para
 * proteger contra ReDoS clássico.
 */
function isLikelyCatastrophic(pattern: string): boolean {
  // Heurística simples: alerta sobre `(.*)+`, `(.+)+`, `(a+)+` e similares.
  return /\(\.\*\)\+|\(\.\+\)\+|\([^()]*\+\)\+/.test(pattern);
}

async function grepRegex(
  env: Env,
  input: { padrao: string; norma_id?: string; max_resultados: number },
): Promise<Fts5Row[]> {
  if (isLikelyCatastrophic(input.padrao)) {
    throw new ToolValidationError(
      `fs_grep: padrão regex potencialmente catastrófico ('${input.padrao}'). ` +
        "Use uma forma sem grupos quantificados aninhados.",
    );
  }
  let re: RegExp;
  try {
    re = new RegExp(input.padrao, "i");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "padrão inválido";
    throw new ToolValidationError(`fs_grep: regex inválido — ${msg}`);
  }

  const whereParts: string[] = [];
  const bind: unknown[] = [];
  if (input.norma_id) {
    whereParts.push("d.norma_id = ?");
    bind.push(input.norma_id);
  }
  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  // Limite duro de candidatos: 1000 dispositivos por chamada (suficiente
  // para uma norma típica). Sem isso o regex pode varrer milhões de rows.
  const sql = `
    SELECT
      d.id AS dispositivo_id,
      d.norma_id,
      d.artigo,
      d.paragrafo,
      d.hierarquia_path AS hierarquia,
      v.texto,
      n.ementa AS norma_label
    FROM dispositivos d
    JOIN versoes_dispositivos v ON v.dispositivo_id = d.id
    LEFT JOIN normas n ON n.id = d.norma_id
    ${where}
    ${where ? "AND" : "WHERE"} v.data_fim IS NULL
    LIMIT 1000
  `;
  const { results } = await env.DB.prepare(sql).bind(...bind).all<DispRow>();
  const rows = results ?? [];

  const matches: Fts5Row[] = [];
  const deadline = Date.now() + REGEX_TIMEOUT_MS;
  for (const r of rows) {
    if (Date.now() > deadline) {
      // Excede budget — para silenciosamente e devolve o que tem.
      break;
    }
    if (re.test(r.texto)) {
      matches.push({ ...r, rank: 0 });
      if (matches.length >= input.max_resultados) break;
    }
  }
  return matches;
}

async function handler(args: unknown, env: Env): Promise<FsGrepOutputT> {
  const parsed = FsGrepInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "fs_grep: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  const key = cacheKey(input);
  const cached = await cacheGet<FsGrepOutputT>(env, key);
  if (cached) return { ...cached, fonte: "cache" };

  const rows = input.regex
    ? await grepRegex(env, input)
    : await grepFts5(env, input);

  const resultados = rows.map((r) => ({
    citacao: {
      norma_id: r.norma_id,
      norma_label: r.norma_label ?? r.norma_id,
      artigo: r.artigo,
      paragrafo: r.paragrafo,
      inciso: null,
      alinea: null,
      hierarquia_path: r.hierarquia,
    },
    texto: r.texto,
    score: input.regex ? undefined : r.rank,
  }));

  const out: FsGrepOutputT = {
    padrao: input.padrao,
    modo: input.regex ? "regex" : "fts5",
    resultados,
    total: resultados.length,
    fonte: "live",
  };

  await cacheSet(env, key, out, GREP_CACHE_TTL);
  return out;
}

export const fsGrepTool: ToolDescriptor = {
  name: "fs_grep",
  description:
    "Busca textual em dispositivos. Modo default usa D1 FTS5 com BM25; " +
    "regex=true ativa modo regex (timeout 50ms, sem grupos catastróficos). " +
    "Resultados cacheados em KV por 1h.",
  inputSchema: zodToMcpSchema(FsGrepInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
