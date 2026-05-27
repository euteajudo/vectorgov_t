/**
 * Busca híbrida — combina retrieval denso (Vectorize) com lexical (FTS5/BM25)
 * usando Reciprocal Rank Fusion (RRF) e re-ranking via cross-encoder.
 *
 * Pipeline:
 *   1. Embed da query via Workers AI (`@cf/baai/bge-m3`, 1024 dim).
 *   2. Em paralelo:
 *        a. `VECTORIZE.query(...)` topK=20 com filtros opcionais.
 *        b. D1 FTS5 (`bm25()`) topK=20 com mesmos filtros.
 *   3. RRF (k=60) fundindo os dois rankings → lista única ordenada.
 *   4. Re-rank do top 20 do RRF via `@cf/baai/bge-reranker-base`.
 *   5. Slice final top N (default 5).
 *
 * Referência RRF: Cormack et al. 2009 — "Reciprocal Rank Fusion outperforms
 * Condorcet and individual rank learning methods". A constante k=60 é a
 * recomendação padrão e funciona bem quando os rankers têm qualidade
 * similar.
 *
 * @example Uso típico em uma tool MCP
 * ```ts
 * const resultados = await hybridSearch(env, {
 *   query: "regime tributário do simples nacional",
 *   topK: 5,
 *   filtros: { lei: "lc-123-2006" },
 * });
 * // resultados[0] => { snippet, scoreFinal, scores: { vector, bm25, rrf, rerank } }
 * ```
 */

import type { Env } from "../env.js";
import type { Citacao, Snippet } from "@vectorgov-t/schemas";

/**
 * Modelo de embedding usado para a query. Deve ser o mesmo usado na ingestão.
 */
const EMBEDDING_MODEL = "@cf/baai/bge-m3";

/**
 * Modelo de cross-encoder para re-rank.
 */
const RERANKER_MODEL = "@cf/baai/bge-reranker-base";

/**
 * Constante RRF padrão (Cormack et al. 2009).
 */
const RRF_K = 60;

/**
 * Top-K usado por cada ranker base (denso e lexical).
 * 20 é o sweet-spot: cobre o suficiente para o re-rank refinar sem custo
 * explosivo na chamada do cross-encoder.
 */
const PER_RANKER_TOP_K = 20;

/**
 * Filtros opcionais aceitos pela busca. Mapeiam diretamente para as colunas
 * de metadata indexadas no Vectorize e para as colunas D1.
 */
export interface HybridFilters {
  lei?: string;
  tema?: string;
  tipo_dispositivo?: string;
}

/**
 * Input do `hybridSearch`.
 */
export interface HybridSearchInput {
  query: string;
  topK: number;
  filtros?: HybridFilters;
}

/**
 * Resultado individual da busca híbrida, com scores intermediários
 * preservados para debug e telemetria.
 */
export interface HybridSearchHit {
  snippet: Snippet;
  scoreFinal: number;
  scores: {
    vector?: number;
    bm25?: number;
    rrf: number;
    rerank?: number;
  };
}

/**
 * Estrutura de um hit do Vectorize após `query()`.
 */
interface VectorHit {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Linha bruta vinda do D1 quando rodamos FTS5 com `bm25()`.
 */
interface Fts5Row {
  dispositivo_id: string;
  norma_id: string;
  artigo: number | null;
  paragrafo: number | null;
  hierarquia: string | null;
  texto: string;
  rank: number; // bm25() — quanto menor, mais relevante
}

/**
 * Embed da query — wrapper sobre Workers AI.
 *
 * Workers AI devolve `{ data: number[][] }`. Pegamos `data[0]` porque
 * estamos passando uma única string.
 */
async function embedQuery(env: Env, query: string): Promise<number[]> {
  const response = (await env.AI.run(EMBEDDING_MODEL, {
    text: [query],
  })) as { data: number[][] };
  const vec = response?.data?.[0];
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error(`embedQuery: resposta inesperada do modelo ${EMBEDDING_MODEL}`);
  }
  return vec;
}

/**
 * Consulta o índice Vectorize, aplicando filtros se houver.
 *
 * O Vectorize aceita `filter` como objeto JSON-like quando os campos
 * estão indexados como metadata (configurado em F1.A).
 */
async function queryVectorize(
  env: Env,
  vector: number[],
  filtros: HybridFilters | undefined,
): Promise<VectorHit[]> {
  const filter: Record<string, unknown> = {};
  if (filtros?.lei) filter.lei = filtros.lei;
  if (filtros?.tema) filter.tema = filtros.tema;
  if (filtros?.tipo_dispositivo) filter.tipo_dispositivo = filtros.tipo_dispositivo;

  const queryOpts: VectorizeQueryOptions = {
    topK: PER_RANKER_TOP_K,
    returnMetadata: "all",
  };
  if (Object.keys(filter).length > 0) {
    queryOpts.filter = filter as VectorizeVectorMetadataFilter;
  }

  const res = await env.VECTORIZE.query(vector, queryOpts);
  return (res.matches ?? []).map((m) => ({
    id: m.id,
    score: m.score,
    metadata: (m.metadata ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Consulta o FTS5 usando `bm25()` como ranking. A query é sanitizada para
 * o subset MATCH do FTS5 — remove caracteres especiais e usa `OR` implícito.
 */
function sanitizeFts5Query(query: string): string {
  // Mantém apenas letras (com diacríticos) + dígitos + espaço.
  const tokens = query
    .normalize("NFKC")
    .replace(/["\\()*:^]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return '""';
  // Aspas duplas por token: tratamento literal, ignora operadores FTS.
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

async function queryFts5(
  env: Env,
  query: string,
  filtros: HybridFilters | undefined,
): Promise<Fts5Row[]> {
  const ftsQuery = sanitizeFts5Query(query);

  // Constrói WHERE dinâmico — bind params seguros (anti-injection).
  const whereParts: string[] = ["dispositivos_fts MATCH ?"];
  const bind: unknown[] = [ftsQuery];

  if (filtros?.lei) {
    whereParts.push("d.norma_id = ?");
    bind.push(filtros.lei);
  }
  if (filtros?.tipo_dispositivo) {
    whereParts.push("d.tipo_dispositivo = ?");
    bind.push(filtros.tipo_dispositivo);
  }
  // `tema` não é coluna em `dispositivos` — Vectorize cuida desse filtro.

  const sql = `
    SELECT
      d.id AS dispositivo_id,
      d.norma_id AS norma_id,
      d.artigo AS artigo,
      d.paragrafo AS paragrafo,
      d.hierarquia_path AS hierarquia,
      f.texto AS texto,
      bm25(dispositivos_fts) AS rank
    FROM dispositivos_fts f
    JOIN dispositivos d ON d.id = f.rowid
    WHERE ${whereParts.join(" AND ")}
    ORDER BY rank ASC
    LIMIT ${PER_RANKER_TOP_K}
  `;

  const stmt = env.DB.prepare(sql).bind(...bind);
  const { results } = await stmt.all<Fts5Row>();
  return results ?? [];
}

/**
 * Aplica Reciprocal Rank Fusion sobre N listas ordenadas.
 *
 * RRF(d) = Σ 1 / (k + rank_i(d))   onde rank começa em 1.
 *
 * Esta função é exportada porque agentes podem querer reaproveitá-la para
 * fundir resultados de buscas adicionais (ex.: jurisprudência).
 */
export function reciprocalRankFusion(
  rankings: Array<Array<{ id: string }>>,
  k: number = RRF_K,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((item, idx) => {
      const rank = idx + 1;
      const current = scores.get(item.id) ?? 0;
      scores.set(item.id, current + 1 / (k + rank));
    });
  }
  return scores;
}

/**
 * Re-rank via cross-encoder (`bge-reranker-base`).
 *
 * O modelo recebe pares (query, passage) e devolve uma pontuação de
 * relevância. Aqui mandamos batch de até `PER_RANKER_TOP_K` passagens.
 */
async function rerank(
  env: Env,
  query: string,
  candidatos: Array<{ id: string; texto: string }>,
): Promise<Map<string, number>> {
  if (candidatos.length === 0) return new Map();

  // Workers AI bge-reranker aceita `{ query, contexts: [{ text }] }`.
  const response = (await env.AI.run(RERANKER_MODEL, {
    query,
    contexts: candidatos.map((c) => ({ text: c.texto })),
  })) as { response?: Array<{ id?: number; score: number }> };

  const out = new Map<string, number>();
  const arr = response?.response ?? [];
  for (const entry of arr) {
    // O modelo usa o índice posicional dentro de `contexts`.
    const idx = typeof entry.id === "number" ? entry.id : -1;
    if (idx >= 0 && idx < candidatos.length) {
      out.set(candidatos[idx]!.id, entry.score);
    }
  }
  return out;
}

/**
 * Constrói uma `Citacao` a partir de uma linha D1 ou metadata Vectorize.
 */
function buildCitacao(opts: {
  norma_id: string;
  artigo?: number | null;
  paragrafo?: number | null;
  inciso?: string | null;
  alinea?: string | null;
  hierarquia_path?: string | null;
  norma_label?: string;
}): Citacao {
  return {
    norma_id: opts.norma_id,
    norma_label: opts.norma_label ?? opts.norma_id,
    artigo: opts.artigo ?? null,
    paragrafo: opts.paragrafo ?? null,
    inciso: opts.inciso ?? null,
    alinea: opts.alinea ?? null,
    hierarquia_path: opts.hierarquia_path ?? "",
  };
}

/**
 * Função principal — orquestra a pipeline RRF + rerank.
 *
 * Falha rápido (throw) se um dos rankers explodir; o handler MCP converte
 * para erro JSON-RPC -32603 (internal error).
 */
export async function hybridSearch(
  env: Env,
  input: HybridSearchInput,
): Promise<HybridSearchHit[]> {
  const { query, topK, filtros } = input;

  // 1) Embed
  const vector = await embedQuery(env, query);

  // 2) Paralelo: Vectorize + FTS5
  const [vectorHits, ftsRows] = await Promise.all([
    queryVectorize(env, vector, filtros),
    queryFts5(env, query, filtros),
  ]);

  // 3) RRF — usamos o ID canônico do dispositivo como chave de fusão.
  const vectorRanking = vectorHits.map((h) => ({ id: h.id }));
  const ftsRanking = ftsRows.map((r) => ({ id: r.dispositivo_id }));
  const rrfScores = reciprocalRankFusion([vectorRanking, ftsRanking]);

  // Tabela de payload por ID — preferimos FTS5 (tem o texto completo);
  // se o item só apareceu no Vectorize, montamos com base na metadata.
  const ftsById = new Map(ftsRows.map((r) => [r.dispositivo_id, r] as const));
  const vecById = new Map(vectorHits.map((h) => [h.id, h] as const));

  // Junta IDs únicos preservando informação posicional (para scores).
  const allIds = new Set<string>([
    ...vectorRanking.map((v) => v.id),
    ...ftsRanking.map((f) => f.id),
  ]);

  const fusedPreRerank = Array.from(allIds)
    .map((id) => {
      const rrf = rrfScores.get(id) ?? 0;
      const fts = ftsById.get(id);
      const vec = vecById.get(id);
      const texto =
        fts?.texto ?? ((vec?.metadata?.texto as string | undefined) ?? "");
      const meta = vec?.metadata ?? {};
      const norma_id = (fts?.norma_id ?? (meta.norma_id as string) ?? "") + "";
      const artigo = fts?.artigo ?? (meta.artigo as number | null) ?? null;
      const paragrafo = fts?.paragrafo ?? (meta.paragrafo as number | null) ?? null;
      const citacao = buildCitacao({
        norma_id,
        artigo,
        paragrafo,
        inciso: (meta.inciso as string | undefined) ?? null,
        alinea: (meta.alinea as string | undefined) ?? null,
        hierarquia_path: fts?.hierarquia ?? (meta.hierarquia_path as string) ?? "",
        norma_label: (meta.norma_label as string) ?? undefined,
      });
      return {
        id,
        texto,
        rrf,
        vector: vec?.score,
        bm25: fts?.rank,
        citacao,
        tipo_dispositivo: (meta.tipo_dispositivo as string) ?? undefined,
      };
    })
    .filter((x) => x.texto.length > 0)
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, PER_RANKER_TOP_K);

  // 4) Re-rank top 20 → top topK
  const rerankScores = await rerank(
    env,
    query,
    fusedPreRerank.map((x) => ({ id: x.id, texto: x.texto })),
  );

  const final = fusedPreRerank
    .map((x) => {
      const rerankScore = rerankScores.get(x.id);
      const scoreFinal = rerankScore ?? x.rrf;
      return {
        snippet: {
          citacao: x.citacao,
          texto: x.texto,
          score: scoreFinal,
          tipo_dispositivo: x.tipo_dispositivo,
        },
        scoreFinal,
        scores: {
          vector: x.vector,
          bm25: x.bm25,
          rrf: x.rrf,
          rerank: rerankScore,
        },
      } satisfies HybridSearchHit;
    })
    .sort((a, b) => b.scoreFinal - a.scoreFinal)
    .slice(0, topK);

  return final;
}
