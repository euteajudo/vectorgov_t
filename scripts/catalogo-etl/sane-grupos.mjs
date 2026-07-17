// Saneamento dos nomes de grupo do CATMAT.
//
// A fonte oficial (CSV dadosabertos) herda defeitos de uma extração de largura
// fixa: hífen de quebra de coluna no meio de palavra ("DISTRI-BUIÇÃO"),
// palavras coladas na fronteira da coluna ("SUPRIMENTOSDE", "CIRCULAÇÃODE") e
// espaços duplos. Hífens legítimos existem no catálogo (PRÉ-FABRICADOS,
// MATÉRIAS-PRIMAS, "INFORMÁTICA - EQUIPAMENTOS") — por isso a correção é um
// dicionário explícito dos 79 nomes auditados em 2026-07, não regex cega.
//
// As chaves do mapa estão na forma já colapsada de espaços: sanearGrupo()
// colapsa primeiro e consulta depois, para que "GERAÇÃO  E  DISTRI-BUIÇÃO"
// (espaços duplos da fonte) case com a mesma entrada.

const CORRECOES = new Map([
  [
    "CONDUTORES ELÉTRICOS E EQUIPAMENTOS PARA GERAÇÃO E DISTRI-BUIÇÃO DE ENERGIA",
    "CONDUTORES ELÉTRICOS E EQUIPAMENTOS PARA GERAÇÃO E DISTRIBUIÇÃO DE ENERGIA",
  ],
  [
    "EQUIPAMENTOS PARA CONSTRUÇÃO, MINERAÇÃO, TERRAPLENAGEM E MA-NUTENÇÃO DE ESTRADAS",
    "EQUIPAMENTOS PARA CONSTRUÇÃO, MINERAÇÃO, TERRAPLENAGEM E MANUTENÇÃO DE ESTRADAS",
  ],
  [
    "EQUIPAMENTOS PARA PURIFICAÇÃO DE ÁGUAS E TRATAMENTO DE ESGO-TOS",
    "EQUIPAMENTOS PARA PURIFICAÇÃO DE ÁGUAS E TRATAMENTO DE ESGOTOS",
  ],
  [
    "EQUIPAMENTOS PARA REFRIGERAÇÃO, AR CONDICIONADO E CIRCULAÇÃODE AR",
    "EQUIPAMENTOS PARA REFRIGERAÇÃO, AR CONDICIONADO E CIRCULAÇÃO DE AR",
  ],
  [
    "FORNOS, CENTRAIS DE VAPOR E EQUIPAMENTOS DE SECAGEM, REATO-RES NUCLEARES",
    "FORNOS, CENTRAIS DE VAPOR E EQUIPAMENTOS DE SECAGEM, REATORES NUCLEARES",
  ],
  [
    "INFORMÁTICA - EQUIPAMENTOS, PEÇAS, ACESSÓRIOS E SUPRIMENTOSDE TIC",
    "INFORMÁTICA - EQUIPAMENTOS, PEÇAS, ACESSÓRIOS E SUPRIMENTOS DE TIC",
  ],
  [
    "MÁQUINAS PARA ESCRITÓRIO, SISTEMAS DE PROCESSAMENTO DE TEX-TO E FICHÁRIOS DE CLASSIFICAÇÃO VISÍVEL",
    "MÁQUINAS PARA ESCRITÓRIO, SISTEMAS DE PROCESSAMENTO DE TEXTO E FICHÁRIOS DE CLASSIFICAÇÃO VISÍVEL",
  ],
  [
    "MATERIAIS, COMPONENTES, CONJUNTOS E ACESSÓRIOS DE FIBRAS Ó-TICAS",
    "MATERIAIS, COMPONENTES, CONJUNTOS E ACESSÓRIOS DE FIBRAS ÓTICAS",
  ],
  // Caixa quebrada na fonte ("VEíCULOS" com í minúsculo entre maiúsculas).
  ["VEíCULOS", "VEÍCULOS"],
]);

/**
 * Devolve o nome do grupo saneado: colapsa espaços e aplica o dicionário de
 * correções. Fallback é identidade (nome desconhecido passa colapsado).
 */
export function sanearGrupo(nome) {
  if (nome === null || nome === undefined) return null;
  const colapsado = String(nome).replace(/\s+/g, " ").trim();
  if (!colapsado) return null;
  return CORRECOES.get(colapsado) ?? colapsado;
}

export { CORRECOES };
