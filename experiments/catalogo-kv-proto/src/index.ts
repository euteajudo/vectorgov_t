/**
 * PROTÓTIPO isolado (não-produção): mede a latência de servir as facetas de
 * topo (dim=grupo|classe) por KV vs pela mesma query D1, de DENTRO da borda —
 * o único lugar onde a latência real de KV.get e D1 aparece.
 *
 * Rotas:
 *   GET /seed         → recomputa as facetas no D1 e grava no KV (write-through
 *                       que o ETL faria no fim do apply). Idempotente.
 *   GET /cmp?dim=grupo→ lê a MESMA faceta do KV e do D1, mede as duas latências
 *                       (várias amostras) e devolve o comparativo + tamanho.
 *
 * NÃO altera nada em produção: só lê o D1 (SELECT) e escreve num KV de teste.
 */
export interface Env {
  FACETAS_PROTO: KVNamespace;
  DB: D1Database;
}

const DIMS = ["grupo", "classe"] as const;
type Dim = (typeof DIMS)[number];
const FACETAS_TOP = 200;

function chaveKV(dim: Dim): string {
  return `facetas:${dim}:all`;
}

/** A MESMA query que o /navegar faz para dim (default só-ativos). */
async function facetasDoD1(env: Env, dim: Dim): Promise<{ facetas: unknown[]; distintos_total: number }> {
  const [{ results }, distintos] = await Promise.all([
    env.DB.prepare(
      `SELECT ${dim} AS valor, COUNT(*) AS n FROM catalogo_itens
       WHERE ativo = 1 AND ${dim} IS NOT NULL
       GROUP BY ${dim} ORDER BY n DESC, valor ASC LIMIT ${FACETAS_TOP}`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT ${dim}) AS n FROM catalogo_itens WHERE ativo = 1 AND ${dim} IS NOT NULL`,
    ).first<{ n: number }>(),
  ]);
  return { facetas: results ?? [], distintos_total: distintos?.n ?? 0 };
}

async function handleSeed(env: Env): Promise<Response> {
  const relatorio: Record<string, unknown> = {};
  for (const dim of DIMS) {
    const dados = await facetasDoD1(env, dim);
    const payload = JSON.stringify({ dim, ...dados, gerado_em: new Date().toISOString() });
    // TTL 40 dias: o ETL mensal reescreve; o TTL é só rede de segurança.
    await env.FACETAS_PROTO.put(chaveKV(dim), payload, { expirationTtl: 60 * 60 * 24 * 40 });
    relatorio[dim] = { valores: dados.facetas.length, distintos: dados.distintos_total, bytes: payload.length };
  }
  return Response.json({ ok: true, seed: relatorio });
}

async function handleCmp(env: Env, dim: Dim): Promise<Response> {
  const N = 5;
  const kvMs: number[] = [];
  const d1Ms: number[] = [];
  let kvBytes = 0;
  let kvHit = false;
  let d1Valores = 0;

  for (let i = 0; i < N; i++) {
    const t1 = Date.now();
    const kvVal = await env.FACETAS_PROTO.get(chaveKV(dim));
    kvMs.push(Date.now() - t1);
    if (kvVal) {
      kvHit = true;
      kvBytes = kvVal.length;
    }

    const t2 = Date.now();
    const d1 = await facetasDoD1(env, dim);
    d1Ms.push(Date.now() - t2);
    d1Valores = d1.facetas.length;
  }

  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return Response.json({
    dim,
    amostras: N,
    kv: { hit: kvHit, mediana_ms: med(kvMs), amostras_ms: kvMs, bytes: kvBytes },
    d1: { mediana_ms: med(d1Ms), amostras_ms: d1Ms, valores: d1Valores },
    ganho_mediana_ms: med(d1Ms) - med(kvMs),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/seed") return handleSeed(env);
    if (url.pathname === "/cmp") {
      const dim = url.searchParams.get("dim");
      if (dim !== "grupo" && dim !== "classe") {
        return Response.json({ error: "dim deve ser grupo|classe" }, { status: 400 });
      }
      return handleCmp(env, dim);
    }
    return Response.json({ proto: "catalogo-kv-proto", rotas: ["/seed", "/cmp?dim=grupo|classe"] });
  },
};
