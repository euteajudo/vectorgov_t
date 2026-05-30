/**
 * Estatística + aderência + normalização de unidade dos preços praticados.
 *
 * Funções puras (testáveis, determinísticas) — o "núcleo F1" da vantajosidade:
 *
 *  - `avaliarAderencia`: por causa do cadastro relapso de CATMAT, uma amostra
 *    sob o código certo pode não ser o objeto. Mede sobreposição de termos do
 *    objeto na descrição da amostra; abaixo do limiar → descartada.
 *  - `agregarEstatisticas`: agrupa as aderentes por unidade de fornecimento
 *    (R$/CAIXA-de-100 ≠ R$/UNIDADE), usa a unidade predominante e calcula
 *    mediana/percentis sobre ela. As fora-de-unidade são contadas, não somadas.
 */
import type { AmostraPreco, EstatisticasPreco } from "@vectorgov-t/schemas";

/** Limiar de aderência: fração mínima de termos do objeto presentes na amostra. */
export const ADERENCIA_MIN = 0.5;

/** Termos genéricos que não discriminam objeto. */
const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "para", "com", "sem", "e", "ou", "a", "o",
  "as", "os", "em", "no", "na", "por", "tipo", "cor", "material", "modelo",
  "caracteristicas", "adicionais", "apresentacao", "finalidade", "uso",
]);

/** Tokeniza removendo acentos, pontuação, stopwords e tokens curtos. */
function tokenizar(texto: string): Set<string> {
  const limpo = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const out = new Set<string>();
  for (const t of limpo.split(/[^a-z0-9]+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

/** Campos textuais de uma amostra usados no juízo de aderência. */
export interface TextoAmostra {
  descricao: string;
  descricao_detalhada: string | null;
  objeto_compra: string | null;
}

/** Resultado do portão de aderência (campos do AmostraPreco). */
export interface ResultadoAderencia {
  aderente: boolean;
  aderencia_score: number;
  aderencia_motivo: string;
}

/**
 * Mede a aderência da amostra ao objeto pesquisado (sobreposição de termos).
 * Score = fração dos termos do objeto presentes na descrição da amostra.
 */
export function avaliarAderencia(
  objeto: string,
  amostra: TextoAmostra,
): ResultadoAderencia {
  const termosObjeto = tokenizar(objeto);
  if (termosObjeto.size === 0) {
    return {
      aderente: true,
      aderencia_score: 1,
      aderencia_motivo: "objeto sem termos discriminantes — aderência não avaliada",
    };
  }
  const texto = [
    amostra.descricao,
    amostra.descricao_detalhada ?? "",
    amostra.objeto_compra ?? "",
  ].join(" ");
  const termosAmostra = tokenizar(texto);
  let hits = 0;
  for (const t of termosObjeto) if (termosAmostra.has(t)) hits++;
  const score = hits / termosObjeto.size;
  const aderente = score >= ADERENCIA_MIN;
  return {
    aderente,
    aderencia_score: Math.round(score * 100) / 100,
    aderencia_motivo: aderente
      ? `${hits}/${termosObjeto.size} termos do objeto presentes na amostra`
      : `apenas ${hits}/${termosObjeto.size} termos do objeto na amostra (< ${ADERENCIA_MIN})`,
  };
}

/** Percentil por interpolação linear sobre lista ordenada asc (em centavos). */
export function percentil(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return Math.round(sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac);
}

/**
 * Agrega as amostras (já com `aderente` preenchido) em estatística de
 * referência: filtra não-aderentes, agrupa por unidade de fornecimento, usa a
 * unidade predominante e calcula mediana/percentis sobre ela.
 */
export function agregarEstatisticas(amostras: AmostraPreco[]): EstatisticasPreco {
  const aderentes = amostras.filter((a) => a.aderente);
  const nDescartadasAderencia = amostras.length - aderentes.length;

  // Agrupa por unidade de fornecimento (null → "—").
  const grupos = new Map<string, AmostraPreco[]>();
  for (const a of aderentes) {
    const chave = a.unidade_fornecimento ?? "—";
    const arr = grupos.get(chave) ?? [];
    arr.push(a);
    grupos.set(chave, arr);
  }

  // Unidade predominante = maior grupo.
  let unidadeBase: string | null = null;
  let baseArr: AmostraPreco[] = [];
  for (const [chave, arr] of grupos) {
    if (arr.length > baseArr.length) {
      unidadeBase = chave === "—" ? null : chave;
      baseArr = arr;
    }
  }
  const nDescartadasUnidade = aderentes.length - baseArr.length;

  const vals = baseArr
    .map((a) => a.valor_unitario_centavos)
    .sort((x, y) => x - y);
  const datas = baseArr
    .map((a) => a.data_compra)
    .filter((d): d is string => d !== null)
    .sort();
  const temVals = vals.length > 0;

  return {
    n: vals.length,
    n_descartadas_aderencia: nDescartadasAderencia,
    n_descartadas_unidade: nDescartadasUnidade,
    unidade_fornecimento_base: unidadeBase,
    mediana_centavos: temVals ? percentil(vals, 50) : null,
    media_centavos: temVals
      ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
      : null,
    p25_centavos: temVals ? percentil(vals, 25) : null,
    p75_centavos: temVals ? percentil(vals, 75) : null,
    min_centavos: temVals ? vals[0]! : null,
    max_centavos: temVals ? vals[vals.length - 1]! : null,
    janela_inicio: datas[0] ?? null,
    janela_fim: datas[datas.length - 1] ?? null,
  };
}
