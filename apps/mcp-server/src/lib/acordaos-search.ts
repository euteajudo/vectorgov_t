/**
 * Busca semântica em acórdãos do TCU — índice Vectorize `acordaos-tcu`,
 * populado pelo worker de ingestão `vectorgov-a-mcp`.
 *
 * Por que aqui (e não no `vectorgov-a-mcp`): a tool `buscar_acordaos` do
 * worker de acórdãos estoura `Cannot set properties of undefined (setting
 * '#options')` — o client do binding Vectorize rejeita `returnMetadata:"none"`.
 * Replicamos a busca AQUI (onde vive o fluxo de análise do Gemini) usando
 * `returnMetadata:"all"` (o mesmo que a busca de leis usa e que funciona).
 *
 * A metadata do índice já traz o texto do chunk (até 4000 chars) + os dados de
 * citação (acordao_id, secao, rotulo, numero, ano, colegiado, relator). Por
 * isso a busca semântica devolve TUDO — sem precisar do D1/R2 do acórdão.
 *
 * Pipeline: embed bge-m3 → Vectorize topK=20 → rerank bge-reranker-base → top_k.
 */
import type { Env } from "../env.js";
import { buildLabel } from "./acordaos-shared.js";
import type { AcordaoFiltros, AcordaoSnippet } from "./acordaos-shared.js";
export type { AcordaoFiltros, AcordaoSnippet } from "./acordaos-shared.js";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const RERANKER_MODEL = "@cf/baai/bge-reranker-base";
const PER_RANKER_TOP_K = 20;

/** Subset da metadata do vetor que consumimos (gravada pela ingestão). */
interface AcordaoMeta {
  acordao_id?: string;
  numero?: string;
  ano?: number;
  colegiado?: string;
  secao?: string;
  rotulo?: string | null;
  texto?: string;
  relator?: string;
  tipo_dispositivo?: string;
  r2_key?: string | null;
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

/**
 * Busca semântica de acórdãos. Devolve até `top_k` trechos rankeados, cada um
 * com citação canônica e o texto do chunk.
 */
export async function buscarAcordaosTcu(
  env: Env,
  input: { query: string; top_k: number; filtros?: AcordaoFiltros },
): Promise<AcordaoSnippet[]> {
  if (!env.VECTORIZE_ACORDAOS) {
    throw new Error(
      "busca de acórdãos indisponível: índice 'acordaos-tcu' " +
        "(VECTORIZE_ACORDAOS) não configurado.",
    );
  }
  const query = input.query.trim();
  if (query.length < 3) return [];

  const vector = await embedQuery(env, query);

  // `returnMetadata: "all"` é OBRIGATÓRIO — o client do binding Vectorize
  // estoura "#options" com "none". E a metadata traz o texto + citação.
  const opts: VectorizeQueryOptions = {
    topK: PER_RANKER_TOP_K,
    returnMetadata: "all",
  };
  const filter: Record<string, unknown> = {};
  if (input.filtros?.colegiado) filter.colegiado = input.filtros.colegiado;
  if (typeof input.filtros?.ano === "number") filter.ano = input.filtros.ano;
  if (input.filtros?.secao) filter.secao = input.filtros.secao;
  if (Object.keys(filter).length > 0) {
    opts.filter = filter as VectorizeVectorMetadataFilter;
  }

  const res = await env.VECTORIZE_ACORDAOS.query(vector, opts);
  const matches = res.matches ?? [];
  if (matches.length === 0) return [];

  const candidatos = matches
    .map((m) => ({
      id: m.id,
      score: m.score,
      meta: (m.metadata ?? {}) as AcordaoMeta,
    }))
    .filter((c) => (c.meta.texto ?? "").length > 0);

  // Rerank é best-effort: se o cross-encoder (Workers AI) falhar, degradamos
  // para a ordem do Vectorize (cosine) em vez de derrubar a busca inteira —
  // os matches semânticos já são válidos. Embed, esse sim, é erro fatal acima.
  let rerankScores: Map<string, number>;
  try {
    rerankScores = await rerank(
      env,
      query,
      candidatos.map((c) => ({ id: c.id, texto: c.meta.texto ?? "" })),
    );
  } catch {
    rerankScores = new Map();
  }

  const snippets = candidatos.map((c) => {
    const m = c.meta;
    const rerankScore = rerankScores.get(c.id);
    return {
      reranked: rerankScore !== undefined,
      snippet: {
        item_id: c.id,
        acordao_id: m.acordao_id ?? "",
        numero: m.numero ?? "",
        ano: typeof m.ano === "number" ? m.ano : 0,
        colegiado: m.colegiado ?? "",
        secao: m.secao ?? "",
        rotulo: m.rotulo ?? null,
        label: buildLabel(m),
        texto: m.texto ?? "",
        relator: m.relator ?? null,
        tipo_dispositivo: m.tipo_dispositivo ?? null,
        // Score do rerank quando o cross-encoder pontuou; senão o cosine cru.
        score: rerankScore ?? c.score,
        r2_key: m.r2_key ?? null,
      },
    };
  });

  // Ordenação: itens pontuados pelo rerank PRIMEIRO (escala logit, desc); os sem
  // score de rerank vão depois, preservando a ordem do Vectorize (cosine desc).
  // Não misturamos as duas escalas num único `.sort` — logit e cosine não são
  // comparáveis, e intercalá-los degradaria o ranking.
  const comRerank = snippets
    .filter((s) => s.reranked)
    .sort((a, b) => b.snippet.score - a.snippet.score);
  const semRerank = snippets.filter((s) => !s.reranked); // já em ordem do Vectorize
  return [...comRerank, ...semRerank]
    .slice(0, input.top_k)
    .map((s) => s.snippet);
}
