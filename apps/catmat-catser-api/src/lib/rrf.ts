/**
 * Reciprocal Rank Fusion (Cormack et al. 2009) — funde N rankings ordenados.
 * RRF(d) = Σ 1/(k + rank_i(d)), rank começa em 1. k=60 é o padrão.
 *
 * Cópia mínima do helper das leis (sem acoplar o Worker ao mcp-server).
 */
const RRF_K = 60;

export function reciprocalRankFusion(
  rankings: Array<Array<{ id: string }>>,
  k: number = RRF_K,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((item, idx) => {
      const rank = idx + 1;
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank));
    });
  }
  return scores;
}
