/**
 * Busca no repositório de catálogo (CATMAT/CATSER) — três modos:
 *
 *  - `buscarCatalogoHibrido` (hibrido): embed bge-m3 → Vectorize `catmat-catser`
 *    + FTS5/BM25 + trigram, fundidos por RRF e re-rankeados via Cohere
 *    (rerank-v3.5). Resolve "descrição → código".
 *  - `grepCatalogo` (lexical): só D1 FTS5/BM25, igual ao `fs_grep` das leis.
 *  - `buscarCatalogoFuzzy` (trigram): substring/tolerante a digitação.
 *
 * FTS é AND-first: tokens justapostos (AND implícito do FTS5) sobre a query
 * original; se 0 resultados, refaz com OR sobre a query expandida por
 * sinônimos — assim o AND preserva precisão e o OR resgata recall.
 *
 * Rerank sem mistura de escalas: ou a ordenação é 100% Cohere (0-1, com
 * threshold), ou 100% RRF (modo degradado explícito quando falta key/falha a
 * chamada). Nunca intercala RRF (~0,03) com relevance_score (0-1) — era isso
 * que enterrava notebooks sob acessórios no ranking antigo.
 *
 * Reusa o motor das leis: `reciprocalRankFusion` espelha o mesmo padrão
 * (índice/tabela diferentes). Ver docs/design/precos-e-pesquisa-web.md (Módulo A).
 */
import type { Env } from "../env.js";
import type {
  CatalogoBuscaResultado,
  ItemCatalogo,
  TipoCatalogo,
} from "@vectorgov-t/schemas";
import { reciprocalRankFusion } from "./rrf.js";
import { expandirQuery } from "./sinonimos.js";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const PER_RANKER_TOP_K = 20;

const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";
const COHERE_RERANK_MODEL = "rerank-v3.5";
const COHERE_TIMEOUT_MS = 4_000;
/**
 * Corte de relevância aplicado SOMENTE quando o rerank respondeu — o
 * relevance_score da Cohere é calibrado em 0-1; abaixo disto o item não tem
 * relação real com a query. RRF puro (modo degradado) não tem threshold: a
 * escala RRF (~0,01-0,03) não é comparável.
 */
const RERANK_MIN_SCORE = 0.02;

/** Linha do D1 (catalogo_itens via catalogo_fts/catalogo_trgm). */
interface CatalogoRow {
  catalogo_id: string;
  codigo: number;
  tipo: string;
  descricao: string;
  grupo: string | null;
  classe: string | null;
  pdm: string | null;
  ativo: number;
  rank?: number;
}

interface VectorHit {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

async function embedQuery(env: Env, query: string): Promise<number[]> {
  const res = (await env.AI.run(EMBEDDING_MODEL, { text: [query] })) as {
    data: number[][];
  };
  const vec = res?.data?.[0];
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error(`embedQuery: resposta inesperada de ${EMBEDDING_MODEL}`);
  }
  return vec;
}

/**
 * Sanitiza para o subset MATCH do FTS5. Tokens com < 3 chars saem (partícula
 * curta só gera ruído no BM25). `operador`:
 *  - "and": tokens justapostos → AND implícito do FTS5 (precisão);
 *  - "or": união explícita (recall / fallback).
 */
export function sanitizeFts5(query: string, operador: "and" | "or"): string {
  const tokens = query
    .normalize("NFKC")
    .replace(/["\\()*:^]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return '""';
  const quoted = tokens.map((t) => `"${t.replace(/"/g, '""')}"`);
  return operador === "and" ? quoted.join(" ") : quoted.join(" OR ");
}

interface FtsResultado {
  rows: CatalogoRow[];
  /** Qual passe serviu a resposta — "and" (query original) ou "or" (expandida). */
  modoFts: "and" | "or";
}

async function execFts(
  env: Env,
  tabela: "catalogo_fts" | "catalogo_trgm",
  matchExpr: string,
  tipo: TipoCatalogo | undefined,
  limit: number,
): Promise<CatalogoRow[]> {
  const where: string[] = [`${tabela} MATCH ?`];
  const bind: unknown[] = [matchExpr];
  if (tipo) {
    where.push("c.tipo = ?");
    bind.push(tipo);
  }
  const sql = `
    SELECT
      c.id AS catalogo_id,
      c.codigo AS codigo,
      c.tipo AS tipo,
      c.descricao AS descricao,
      c.grupo AS grupo,
      c.classe AS classe,
      c.pdm AS pdm,
      c.ativo AS ativo,
      bm25(${tabela}) AS rank
    FROM ${tabela} f
    JOIN catalogo_itens c ON c.id = f.catalogo_id
    WHERE ${where.join(" AND ")}
    ORDER BY rank ASC
    LIMIT ?
  `;
  const { results } = await env.DB.prepare(sql)
    .bind(...bind, limit)
    .all<CatalogoRow>();
  return results ?? [];
}

/**
 * FTS full-text AND-first: tenta AND sobre a query original; se vier vazio,
 * refaz com OR sobre a query expandida por sinônimos (recall). Loga qual modo
 * serviu — 1 linha JSON por consulta.
 */
async function queryFtsCatalogo(
  env: Env,
  padrao: string,
  tipo: TipoCatalogo | undefined,
  limit: number,
): Promise<FtsResultado> {
  let modoFts: FtsResultado["modoFts"] = "and";
  let rows = await execFts(
    env,
    "catalogo_fts",
    sanitizeFts5(padrao, "and"),
    tipo,
    limit,
  );
  if (rows.length === 0) {
    modoFts = "or";
    rows = await execFts(
      env,
      "catalogo_fts",
      sanitizeFts5(expandirQuery(padrao), "or"),
      tipo,
      limit,
    );
  }
  console.log(
    JSON.stringify({
      evento: "catalogo_fts",
      modo_fts: modoFts,
      hits: rows.length,
      query_len: padrao.length,
    }),
  );
  return { rows, modoFts };
}

/**
 * Busca trigram (FTS5 tokenize='trigram') — match por **substring/parcial**
 * rápido (≈ `LIKE '%x%'` acelerado por GIN no Postgres). Cada palavra (≥ 3
 * chars) vira um termo de substring, unidos por OR — assim "procedim" acha
 * "procedimento". Fica na query original: sinônimo canônico como substring não
 * ajuda aqui (a lane serve a typo/parcial, não a vocabulário).
 */
async function queryTrgmCatalogo(
  env: Env,
  padrao: string,
  tipo: TipoCatalogo | undefined,
  limit: number,
): Promise<CatalogoRow[]> {
  const tokens = padrao
    .normalize("NFKC")
    .replace(/"/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return [];
  const matchExpr = tokens.map((t) => `"${t}"`).join(" OR ");
  return execFts(env, "catalogo_trgm", matchExpr, tipo, limit);
}

async function queryVectorizeCatalogo(
  env: Env,
  vector: number[],
  tipo: TipoCatalogo | undefined,
): Promise<VectorHit[]> {
  if (!env.VECTORIZE_CATMAT) {
    throw new Error(
      "busca semântica de catálogo indisponível: índice 'catmat-catser' (VECTORIZE_CATMAT) não configurado.",
    );
  }
  const opts: VectorizeQueryOptions = {
    topK: PER_RANKER_TOP_K,
    returnMetadata: "all",
  };
  if (tipo) opts.filter = { tipo } as VectorizeVectorMetadataFilter;
  const res = await env.VECTORIZE_CATMAT.query(vector, opts);
  return (res.matches ?? []).map((m) => ({
    id: m.id,
    score: m.score,
    metadata: (m.metadata ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Classe válida para compor texto de rerank/embed? A fonte XLSX traz
 * "INVALIDO"/"INVALIDA" como placeholder — isso poluía o embedding e não pode
 * entrar no documento.
 */
export function classeValida(classe: string | null | undefined): boolean {
  if (!classe) return false;
  const c = classe
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  return c.length > 0 && c !== "INVALIDO" && c !== "INVALIDA";
}

/**
 * Documento enviado ao reranker: descricao + (pdm) + classe válida — mesmo
 * material do texto_embed, para o rerank julgar o que o vetor viu.
 */
export function montarDocRerank(d: {
  descricao: string;
  pdm?: string | null;
  classe?: string | null;
}): string {
  let doc = d.descricao;
  const pdm = d.pdm?.trim();
  if (pdm) doc += ` (${pdm})`;
  if (classeValida(d.classe)) doc += ` ${d.classe!.trim()}`;
  return doc;
}

/**
 * Parse defensivo da resposta do POST /v2/rerank da Cohere: aceita apenas
 * entradas com `index` inteiro dentro do range e `relevance_score` numérico
 * finito — o resto é ignorado silenciosamente (API externa, contrato não é
 * nosso).
 */
export function parseCohereResults(
  payload: unknown,
  totalDocs: number,
): Array<{ index: number; score: number }> {
  const results = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: Array<{ index: number; score: number }> = [];
  for (const r of results) {
    const entry = r as { index?: unknown; relevance_score?: unknown };
    const idx = entry?.index;
    const score = entry?.relevance_score;
    if (typeof idx !== "number" || !Number.isInteger(idx)) continue;
    if (idx < 0 || idx >= totalDocs) continue;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    out.push({ index: idx, score });
  }
  return out;
}

/**
 * Rerank via Cohere (rerank-v3.5 — multilíngue; o bge-reranker-base do Workers
 * AI é en/zh e falhava em PT). Retorna `null` em QUALQUER falha (sem key, HTTP
 * != 2xx, timeout 4s, payload inesperado) — o chamador então ordena 100% por
 * RRF, sem misturar escalas.
 */
async function rerankCohere(
  env: Env,
  query: string,
  candidatos: Array<{ id: string; texto: string }>,
): Promise<Map<string, number> | null> {
  const apiKey = env.COHERE_API_KEY?.trim();
  if (!apiKey) return null;
  if (candidatos.length === 0) return new Map();
  try {
    const res = await fetch(COHERE_RERANK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: COHERE_RERANK_MODEL,
        query,
        documents: candidatos.map((c) => c.texto),
        top_n: candidatos.length,
      }),
      signal: AbortSignal.timeout(COHERE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const payload: unknown = await res.json();
    const parsed = parseCohereResults(payload, candidatos.length);
    if (parsed.length === 0) return null;
    const out = new Map<string, number>();
    for (const { index, score } of parsed) {
      out.set(candidatos[index]!.id, score);
    }
    return out;
  } catch {
    return null;
  }
}

function itemFromRow(r: CatalogoRow): ItemCatalogo {
  return {
    codigo: r.codigo,
    tipo: r.tipo as TipoCatalogo,
    descricao: r.descricao,
    grupo: r.grupo,
    classe: r.classe,
    ativo: r.ativo !== 0,
  };
}

function itemFromMeta(meta: Record<string, unknown>): ItemCatalogo {
  return {
    codigo: Number(meta.codigo),
    tipo: (meta.tipo as TipoCatalogo) ?? "material",
    descricao: (meta.descricao as string) ?? "",
    grupo: (meta.grupo as string) || null,
    classe: (meta.classe as string) || null,
    // Vector antigo pode não carregar `ativo` no metadata — assume ativo.
    ativo: !(meta.ativo === 0 || meta.ativo === false),
  };
}

/** Busca híbrida 3-way + rerank Cohere — resolve descrição → código de catálogo. */
export async function buscarCatalogoHibrido(
  env: Env,
  input: { descricao: string; tipo?: TipoCatalogo; top_k: number },
): Promise<CatalogoBuscaResultado> {
  // Sinônimos entram no vetor semântico; a lane FTS aplica a expansão só no
  // fallback OR (AND-first fica na query original — precisão).
  const consultaExpandida = expandirQuery(input.descricao);
  const vector = await embedQuery(env, consultaExpandida);
  const [vecHits, fts, trgmRows] = await Promise.all([
    queryVectorizeCatalogo(env, vector, input.tipo),
    queryFtsCatalogo(env, input.descricao, input.tipo, PER_RANKER_TOP_K),
    queryTrgmCatalogo(env, input.descricao, input.tipo, PER_RANKER_TOP_K),
  ]);
  const ftsRows = fts.rows;

  // RRF 3-way: semântico (Vectorize) + full-text (FTS5 unicode61) + trigram (fuzzy).
  const rrf = reciprocalRankFusion([
    vecHits.map((h) => ({ id: h.id })),
    ftsRows.map((r) => ({ id: r.catalogo_id })),
    trgmRows.map((r) => ({ id: r.catalogo_id })),
  ]);

  // Linhas D1 (FTS + trigram) por id — FTS tem prioridade quando ambos têm o item.
  const rowById = new Map<string, CatalogoRow>();
  for (const r of trgmRows) rowById.set(r.catalogo_id, r);
  for (const r of ftsRows) rowById.set(r.catalogo_id, r);
  const vecById = new Map(vecHits.map((h) => [h.id, h] as const));
  const ids = new Set<string>([
    ...vecHits.map((h) => h.id),
    ...ftsRows.map((r) => r.catalogo_id),
    ...trgmRows.map((r) => r.catalogo_id),
  ]);

  const fused = Array.from(ids)
    .map((id) => {
      const row = rowById.get(id);
      const meta = vecById.get(id)?.metadata;
      const item = row ? itemFromRow(row) : itemFromMeta(meta!);
      const pdm = row ? row.pdm : ((meta?.pdm as string) || null);
      return { id, item, pdm, rrf: rrf.get(id) ?? 0 };
    })
    .filter((x) => x.item.descricao.length > 0)
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, PER_RANKER_TOP_K);

  const rerankScores = await rerankCohere(
    env,
    input.descricao,
    fused.map((x) => ({
      id: x.id,
      texto: montarDocRerank({
        descricao: x.item.descricao,
        pdm: x.pdm,
        classe: x.item.classe,
      }),
    })),
  );

  // Ou 100% Cohere (com threshold), ou 100% RRF (degradado) — nunca mistura.
  let itens: ItemCatalogo[];
  let modoRerank: "cohere" | "rrf_puro";
  if (rerankScores !== null) {
    modoRerank = "cohere";
    itens = fused
      .map((x) => ({ item: x.item, score: rerankScores.get(x.id) }))
      .filter(
        (x): x is { item: ItemCatalogo; score: number } =>
          typeof x.score === "number" && x.score >= RERANK_MIN_SCORE,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, input.top_k)
      .map((x) => ({ ...x.item, score: x.score }));
  } else {
    modoRerank = "rrf_puro";
    itens = fused
      .slice(0, input.top_k)
      .map((x) => ({ ...x.item, score: x.rrf }));
  }

  console.log(
    JSON.stringify({
      evento: "catalogo_rerank",
      modo: modoRerank,
      scores_top3: itens.slice(0, 3).map((i) => i.score),
      query_len: input.descricao.length,
    }),
  );

  return { modo: "hibrido", total: itens.length, itens };
}

/** Busca lexical (grep) — só D1 FTS5/BM25 (unicode61), AND-first com fallback OR. */
export async function grepCatalogo(
  env: Env,
  input: { padrao: string; tipo?: TipoCatalogo; max: number },
): Promise<CatalogoBuscaResultado> {
  const { rows } = await queryFtsCatalogo(env, input.padrao, input.tipo, input.max);
  return { modo: "grep", total: rows.length, itens: rows.map(itemFromRow) };
}

/** Busca fuzzy (FTS5 trigram) — tolerante a digitação/substring, sem embedding. */
export async function buscarCatalogoFuzzy(
  env: Env,
  input: { padrao: string; tipo?: TipoCatalogo; max: number },
): Promise<CatalogoBuscaResultado> {
  const rows = await queryTrgmCatalogo(env, input.padrao, input.tipo, input.max);
  return { modo: "fuzzy", total: rows.length, itens: rows.map(itemFromRow) };
}

/**
 * Busca lexical 2-way: FTS5 unicode61 (full-text, AND-first) + FTS5 trigram
 * (substring), fundidos por RRF. É a tool lexical exposta ao agente (sem
 * embedding) — rápida e tolerante a termo parcial.
 */
export async function buscarCatalogoLexical(
  env: Env,
  input: { padrao: string; tipo?: TipoCatalogo; max: number },
): Promise<CatalogoBuscaResultado> {
  const [fts, trgmRows] = await Promise.all([
    queryFtsCatalogo(env, input.padrao, input.tipo, PER_RANKER_TOP_K),
    queryTrgmCatalogo(env, input.padrao, input.tipo, PER_RANKER_TOP_K),
  ]);
  const ftsRows = fts.rows;
  const rrf = reciprocalRankFusion([
    ftsRows.map((r) => ({ id: r.catalogo_id })),
    trgmRows.map((r) => ({ id: r.catalogo_id })),
  ]);
  const rowById = new Map<string, CatalogoRow>();
  for (const r of trgmRows) rowById.set(r.catalogo_id, r);
  for (const r of ftsRows) rowById.set(r.catalogo_id, r);
  const itens = Array.from(rowById.keys())
    .map((id) => ({ id, rrf: rrf.get(id) ?? 0 }))
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, input.max)
    .map((x) => itemFromRow(rowById.get(x.id)!));
  return { modo: "grep", total: itens.length, itens };
}
