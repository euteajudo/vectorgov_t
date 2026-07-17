/**
 * Dicionário de sinônimos de domínio (compras públicas) para expansão de query.
 *
 * O catálogo usa o jargão da fonte ("MICROCOMPUTADOR", "CONDICIONADOR DE AR")
 * enquanto o usuário pergunta em linguagem corrente ("desktop", "ar-condicionado").
 * A expansão concatena os termos canônicos do grupo à query ANTES do embed e do
 * FTS — o AND-first roda sobre a query original; os sinônimos entram no fallback
 * OR e no vetor semântico (ver catalogo-search.ts).
 *
 * Seed proposital e enxuto: só equivalências inequívocas do domínio. Termo
 * ambíguo ("central", "unidade") NÃO entra — expansão errada polui o ranking.
 */

/**
 * Grupos de equivalência — cada linha é um conjunto de termos intercambiáveis.
 * Para estender: adicionar termos ao grupo existente ou uma linha nova; a
 * indexação (Map termo→grupo) é derivada automaticamente abaixo.
 */
export const GRUPOS_SINONIMOS: ReadonlyArray<ReadonlyArray<string>> = [
  ["notebook", "laptop", "computador portátil"],
  ["desktop", "computador de mesa", "microcomputador"],
  ["celular", "smartphone", "telefone móvel"],
  ["caminhonete", "pick-up", "picape"],
  ["viatura", "veículo policial"],
  ["tv", "televisor", "televisão"],
  ["geladeira", "refrigerador"],
  ["ar-condicionado", "condicionador de ar"],
  ["impressora multifuncional", "multifuncional"],
  ["pendrive", "pen drive", "memória portátil"],
  ["limpeza predial", "limpeza e conservação"],
];

/** Normaliza para comparação: minúsculas, sem diacríticos, espaços colapsados. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Termo presente na query com fronteira de palavra? Fronteira = não-letra/dígito,
 * então hífen e espaço contam ("ar-condicionado" casa dentro de frase; "tv" não
 * casa dentro de "atv").
 */
function contemTermo(queryNorm: string, termoNorm: string): boolean {
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaparRegex(termoNorm)}($|[^\\p{L}\\p{N}])`,
    "u",
  );
  return re.test(queryNorm);
}

/** Índice derivado: termo normalizado → grupo de equivalência. */
const TERMO_PARA_GRUPO: ReadonlyMap<string, ReadonlyArray<string>> = (() => {
  const idx = new Map<string, ReadonlyArray<string>>();
  for (const grupo of GRUPOS_SINONIMOS) {
    for (const termo of grupo) idx.set(normalizar(termo), grupo);
  }
  return idx;
})();

/**
 * Expande a query concatenando os termos canônicos dos grupos que ela aciona.
 * Termos já presentes na query não são repetidos; sem match, devolve a query
 * intacta. O texto original vem primeiro (preserva a intenção do usuário no
 * BM25 e no embedding).
 */
export function expandirQuery(query: string): string {
  const qNorm = normalizar(query);
  if (qNorm.length === 0) return query;
  const extras: string[] = [];
  const vistos = new Set<string>();
  for (const [termoNorm, grupo] of TERMO_PARA_GRUPO) {
    if (!contemTermo(qNorm, termoNorm)) continue;
    for (const sinonimo of grupo) {
      const sinNorm = normalizar(sinonimo);
      if (sinNorm === termoNorm) continue;
      if (contemTermo(qNorm, sinNorm)) continue;
      if (vistos.has(sinNorm)) continue;
      vistos.add(sinNorm);
      extras.push(sinonimo);
    }
  }
  return extras.length > 0 ? `${query} ${extras.join(" ")}` : query;
}
