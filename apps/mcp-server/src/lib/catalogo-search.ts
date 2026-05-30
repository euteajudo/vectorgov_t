/**
 * Busca no repositório de catálogo (CATMAT/CATSER) — dois modos:
 *
 *  - `buscarCatalogoHibrido` (semântico): embed bge-m3 → Vectorize `catmat-catser`
 *    + FTS5/BM25, fundidos por RRF e re-rankeados. Resolve "descrição → código".
 *  - `grepCatalogo` (lexical): só D1 FTS5/BM25, igual ao `fs_grep` das leis.
 *
 * Reusa o motor das leis: `reciprocalRankFusion` é importado de hybrid-search;
 * o resto espelha o mesmo padrão (índice/tabela diferentes). Ver
 * docs/design/precos-e-pesquisa-web.md (Módulo A).
 */
import type { Env } from "../env.js";
import type {
  CatalogoBuscaResultado,
  ItemCatalogo,
  TipoCatalogo,
} from "@vectorgov-t/schemas";
import { reciprocalRankFusion } from "./hybrid-search.js";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const RERANKER_MODEL = "@cf/baai/bge-reranker-base";
const PER_RANKER_TOP_K = 20;

/** Linha do D1 (catalogo_itens via catalogo_fts). */
interface CatalogoRow {
  catalogo_id: string;
  codigo: number;
  tipo: string;
  descricao: string;
  grupo: string | null;
  classe: string | null;
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

/** Sanitiza para o subset MATCH do FTS5 (mesma regra do hybrid das leis). */
function sanitizeFts5(query: string): string {
  const tokens = query
    .normalize("NFKC")
    .replace(/["\\()*:^]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

async function queryFtsCatalogo(
  env: Env,
  padrao: string,
  tipo: TipoCatalogo | undefined,
  limit: number,
): Promise<CatalogoRow[]> {
  const ftsQuery = sanitizeFts5(padrao);
  const where: string[] = ["catalogo_fts MATCH ?"];
  const bind: unknown[] = [ftsQuery];
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
      bm25(catalogo_fts) AS rank
    FROM catalogo_fts f
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

function itemFromRow(r: CatalogoRow): ItemCatalogo {
  return {
    codigo: r.codigo,
    tipo: r.tipo as TipoCatalogo,
    descricao: r.descricao,
    grupo: r.grupo,
    classe: r.classe,
    unidade_medida: null,
    ativo: true,
  };
}

function itemFromMeta(meta: Record<string, unknown>): ItemCatalogo {
  return {
    codigo: Number(meta.codigo),
    tipo: (meta.tipo as TipoCatalogo) ?? "material",
    descricao: (meta.descricao as string) ?? "",
    grupo: (meta.grupo as string) || null,
    classe: (meta.classe as string) || null,
    unidade_medida: null,
    ativo: true,
  };
}

async function rerank(
  env: Env,
  query: string,
  candidatos: Array<{ id: string; texto: string }>,
): Promise<Map<string, number>> {
  if (candidatos.length === 0) return new Map();
  const res = (await env.AI.run(RERANKER_MODEL, {
    query,
    contexts: candidatos.map((c) => ({ text: c.texto })),
  })) as { response?: Array<{ id?: number; score: number }> };
  const out = new Map<string, number>();
  for (const entry of res?.response ?? []) {
    const idx = typeof entry.id === "number" ? entry.id : -1;
    if (idx >= 0 && idx < candidatos.length) {
      out.set(candidatos[idx]!.id, entry.score);
    }
  }
  return out;
}

/** Busca híbrida (semântica + lexical) — resolve descrição → código de catálogo. */
export async function buscarCatalogoHibrido(
  env: Env,
  input: { descricao: string; tipo?: TipoCatalogo; top_k: number },
): Promise<CatalogoBuscaResultado> {
  const vector = await embedQuery(env, input.descricao);
  const [vecHits, ftsRows] = await Promise.all([
    queryVectorizeCatalogo(env, vector, input.tipo),
    queryFtsCatalogo(env, input.descricao, input.tipo, PER_RANKER_TOP_K),
  ]);

  const rrf = reciprocalRankFusion([
    vecHits.map((h) => ({ id: h.id })),
    ftsRows.map((r) => ({ id: r.catalogo_id })),
  ]);

  const ftsById = new Map(ftsRows.map((r) => [r.catalogo_id, r] as const));
  const vecById = new Map(vecHits.map((h) => [h.id, h] as const));
  const ids = new Set<string>([
    ...vecHits.map((h) => h.id),
    ...ftsRows.map((r) => r.catalogo_id),
  ]);

  const fused = Array.from(ids)
    .map((id) => {
      const fts = ftsById.get(id);
      const item = fts ? itemFromRow(fts) : itemFromMeta(vecById.get(id)!.metadata);
      return { id, item, texto: item.descricao, rrf: rrf.get(id) ?? 0 };
    })
    .filter((x) => x.texto.length > 0)
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, PER_RANKER_TOP_K);

  const rerankScores = await rerank(
    env,
    input.descricao,
    fused.map((x) => ({ id: x.id, texto: x.texto })),
  );

  const itens = fused
    .map((x) => ({ item: x.item, score: rerankScores.get(x.id) ?? x.rrf }))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.top_k)
    .map((x) => x.item);

  return { modo: "semantico", total: itens.length, itens };
}

/** Busca lexical (grep) — só D1 FTS5/BM25. */
export async function grepCatalogo(
  env: Env,
  input: { padrao: string; tipo?: TipoCatalogo; max: number },
): Promise<CatalogoBuscaResultado> {
  const rows = await queryFtsCatalogo(env, input.padrao, input.tipo, input.max);
  return { modo: "grep", total: rows.length, itens: rows.map(itemFromRow) };
}
