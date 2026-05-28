/**
 * Tabela determinística das alíquotas IBS/CBS por ano de vigência,
 * conforme regime de transição da Reforma Tributária (EC 132/2023).
 *
 * Fontes normativas:
 *   - LC 214/2025, Arts. 343-348 (transição 2026-2028)
 *   - LC 214/2025, Arts. 355-359 (phase-in IBS 2029-2032)
 *   - LC 214/2025, Art. 366 (plenitude 2033+)
 *   - LC 214/2025, Arts. 472-473 (compras governamentais)
 *   - Decreto 12955/2026, Arts. 582-585 (alíquotas CBS transição)
 *   - Decreto 12955/2026, Art. 601 (redutor compras governamentais)
 *
 * Convenção: percentuais expressos em pontos percentuais (ex.: 0.9 = 0,9%).
 */

export type ResolucaoAliquotas = {
  ano: number;
  cbs_pct: number;
  ibs_pct: number;
  compensacao_pis_cofins: boolean;
  fundamento: string;
};

/**
 * Configuração de entrada para resolver as alíquotas de um ano-base.
 *
 * Como Senado/TCU só publicam `cbs_ref` e `ibs_ref` ano a ano, a tabela
 * recebe essas alíquotas de referência como parâmetro e as combina com
 * a regra de transição correspondente.
 */
export interface ParametrosResolucao {
  /** Alíquota de referência da CBS publicada pelo Senado (LC 214 Art. 349). */
  cbs_ref_pct: number | null;
  /** Alíquota de referência do IBS (estadual + municipal). */
  ibs_ref_pct: number | null;
}

/**
 * Resolve as alíquotas EFETIVAS (CBS, IBS) para um ano específico.
 *
 * Lança Error se o ano ainda não está coberto pelas regras (ex.: < 2026).
 */
export function resolverAliquotasAno(
  ano: number,
  params: ParametrosResolucao,
): ResolucaoAliquotas {
  if (ano < 2026) {
    throw new Error(
      `Ano ${ano} é anterior à vigência da Reforma Tributária (início 2026)`,
    );
  }

  // 2026 — teste inicial: CBS 0,9% + IBS 0,1% com compensação total contra
  // PIS/Cofins (efeito líquido próximo de zero para contribuinte regular).
  if (ano === 2026) {
    return {
      ano,
      cbs_pct: 0.9,
      ibs_pct: 0.1,
      compensacao_pis_cofins: true,
      fundamento:
        "LC 214/2025, Arts. 343, 346 e 348; Decreto 12955/2026, Arts. 582-583",
    };
  }

  // 2027-2028 — CBS = alíq. ref. − 0,1pp; IBS = 0,1% (0,05 estado + 0,05 município);
  // PIS/Cofins extintos a partir de 01/01/2027.
  if (ano === 2027 || ano === 2028) {
    const cbsRef = params.cbs_ref_pct;
    if (cbsRef === null) {
      throw new Error(
        `Alíquota de referência da CBS para ${ano} não informada (necessária para LC 214/2025 Art. 344 / 347)`,
      );
    }
    return {
      ano,
      cbs_pct: Math.max(0, cbsRef - 0.1),
      ibs_pct: 0.1,
      compensacao_pis_cofins: false,
      fundamento:
        "LC 214/2025, Arts. 344 e 347; Decreto 12955/2026, Art. 585",
    };
  }

  // 2029-2032 — CBS plena; IBS phase-in 10%, 20%, 30%, 40% da alíq. de referência.
  const phaseInIbs: Record<number, number> = {
    2029: 0.1,
    2030: 0.2,
    2031: 0.3,
    2032: 0.4,
  };
  if (ano in phaseInIbs) {
    const cbsRef = params.cbs_ref_pct;
    const ibsRef = params.ibs_ref_pct;
    if (cbsRef === null || ibsRef === null) {
      throw new Error(
        `Alíquotas de referência (CBS e IBS) para ${ano} não informadas`,
      );
    }
    return {
      ano,
      cbs_pct: cbsRef,
      ibs_pct: ibsRef * phaseInIbs[ano]!,
      compensacao_pis_cofins: false,
      fundamento: `LC 214/2025, Art. ${354 + (ano - 2028)} (phase-in IBS ${Math.round(phaseInIbs[ano]! * 100)}%)`,
    };
  }

  // 2033+ — regime pleno: CBS + IBS integrais.
  const cbsRef = params.cbs_ref_pct;
  const ibsRef = params.ibs_ref_pct;
  if (cbsRef === null || ibsRef === null) {
    throw new Error(
      `Alíquotas de referência (CBS e IBS) para ${ano} não informadas`,
    );
  }
  return {
    ano,
    cbs_pct: cbsRef,
    ibs_pct: ibsRef,
    compensacao_pis_cofins: false,
    fundamento: "LC 214/2025, Art. 366 (regime pleno a partir de 2033)",
  };
}

/**
 * Aplica o redutor das operações contratadas pela administração pública
 * direta, autarquias e fundações públicas (LC 214/2025 Arts. 472-473;
 * Decreto 12955/2026 Art. 601).
 *
 * O redutor é fixado anualmente pelo Senado Federal e atua sobre as
 * alíquotas-padrão da CBS e do IBS. Não se aplica em 2026 (regime piloto).
 *
 * Retorna `null` em `redutor_pct` quando o redutor não é aplicável.
 */
export function aplicarRedutorComprasGovernamentais(
  aliquotas: ResolucaoAliquotas,
  redutorPct: number | null,
  isCompraGovernamental: boolean,
): { cbs_pct: number; ibs_pct: number; redutor_pct: number | null } {
  if (!isCompraGovernamental || aliquotas.ano === 2026 || redutorPct === null) {
    return {
      cbs_pct: aliquotas.cbs_pct,
      ibs_pct: aliquotas.ibs_pct,
      redutor_pct: null,
    };
  }
  const fator = 1 - redutorPct / 100;
  return {
    cbs_pct: aliquotas.cbs_pct * fator,
    ibs_pct: aliquotas.ibs_pct * fator,
    redutor_pct: redutorPct,
  };
}
