/**
 * Primitivas compartilhadas das buscas de acórdão (semântica + lexical).
 *
 * Centraliza a citação canônica (`buildLabel`) e os tipos para que as duas
 * tools — `buscar_acordaos_tcu` (Vectorize) e `buscar_acordaos_lexical` (FTS5)
 * — produzam EXATAMENTE o mesmo formato de `label`/snippet. Evita o drift de
 * 3 cópias apontado no review.
 */

export const COLEGIADO_LABEL: Record<string, string> = {
  plenario: "Plenário",
  primeira_camara: "Primeira Câmara",
  segunda_camara: "Segunda Câmara",
};

export interface AcordaoFiltros {
  colegiado?: string;
  ano?: number;
  secao?: string;
}

export interface AcordaoSnippet {
  /** item_id canônico do chunk (`acordao-…#secao-rotulo` ou o id do D1). */
  item_id: string;
  acordao_id: string;
  numero: string;
  ano: number;
  colegiado: string;
  secao: string;
  rotulo: string | null;
  /** Label humano de citação (ex.: "Acórdão 1148/2022-TCU-Plenário, voto §11"). */
  label: string;
  texto: string;
  /** Relator do acórdão, quando a metadata do chunk traz (nem todo chunk tem). */
  relator: string | null;
  /** Tipo do dispositivo (ex.: "determinacao", "recomendacao"), quando houver. */
  tipo_dispositivo: string | null;
  /** Score: rerank/cosine (semântica) ou -bm25 (lexical) — maior = mais relevante. */
  score: number;
  r2_key: string | null;
}

/** Campos de metadata que `buildLabel` consome (do Vectorize ou de um row D1). */
export interface AcordaoMeta {
  numero?: string;
  ano?: number;
  colegiado?: string;
  secao?: string;
  rotulo?: string | null;
}

/**
 * Sufixo de parágrafo para voto/relatório. SÓ emite "§N" quando o rótulo é um
 * parágrafo de fato (`p11` → ` §11`). Chunks de JANELA (`w06`) NÃO são
 * parágrafos — citamos só a seção, sem § inventado, para não fabricar um número
 * de parágrafo que não existe no acórdão.
 */
export function paragrafo(rotulo: string): string {
  const m = /^p(\d+)/i.exec(rotulo);
  if (!m) return "";
  // Normaliza zeros à esquerda do rótulo interno (`p05` → §5), mantendo ao
  // menos 1 dígito (`p00` → §0). Citação jurídica não usa zero-padding.
  const n = m[1].replace(/^0+(?=\d)/, "");
  return ` §${n}`;
}

/** Monta a citação humana a partir da metadata (secao/rotulo → §, item, etc.). */
export function buildLabel(m: AcordaoMeta): string {
  const numero = m.numero ?? "?";
  const ano = m.ano ?? "?";
  const coleg = COLEGIADO_LABEL[m.colegiado ?? ""] ?? m.colegiado ?? "";
  const base = `Acórdão ${numero}/${ano}-TCU-${coleg}`;
  const secao = m.secao;
  const rotulo = m.rotulo;
  if (!secao || rotulo === null || rotulo === undefined || rotulo === "") {
    return base;
  }
  const r = String(rotulo);
  switch (secao) {
    case "sumario":
      return `${base}, sumário`;
    case "acordao":
      // Só vira "item N.N" quando o rótulo é mesmo um item numerado (`item9.1`).
      // Rótulos sem número (ex.: literal "acordao", a cabeça do dispositivo)
      // citam apenas a base — nunca um "item acordao" inexistente.
      return /^item\s*\d/i.test(r)
        ? `${base}, item ${r.replace(/^item\s*/i, "")}`
        : base;
    case "voto":
      return `${base}, voto${paragrafo(r)}`;
    case "relatorio":
      return `${base}, relatório${paragrafo(r)}`;
    case "enunciado":
      // Strip do "e" só quando seguido de dígito (`e01` → `01`); "01" fica como
      // está. Evita mutilar rótulos que já vêm como número puro.
      return `${base}, enunciado ${r.replace(/^e(?=\d)/i, "")}`;
    default:
      // Seção desconhecida: cita só a base — nunca anexa rótulo cru/ambíguo.
      return base;
  }
}
