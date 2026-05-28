/**
 * Tool MCP: `calcular_reequilibrio_tributario`.
 *
 * Engine determinística para cálculo do diferencial de carga tributária
 * entre o regime pré-Reforma (PIS/Cofins/ICMS/ISS) e o pós-Reforma
 * (CBS + IBS), considerando o regime de transição 2026-2033+ da
 * LC 214/2025 e o Decreto 12955/2026.
 *
 * Não consulta D1/Vectorize: é puro cálculo aritmético sobre as alíquotas
 * de referência informadas pelo agente Calculista. A tabela ano→regra de
 * transição é determinística (ver tabelas-aliquotas.ts).
 */

import type { Env } from "../../../env.js";
import {
  CalcularReequilibrioInput,
  type CalcularReequilibrioInputT,
  type CalcularReequilibrioOutputT,
  type CargaPosAno,
  type PassoMemoria,
  type BaseLegalItem,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import {
  resolverAliquotasAno,
  aplicarRedutorComprasGovernamentais,
} from "./tabelas-aliquotas.js";

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function mesesEntre(inicioISO: string, fimISO: string): number {
  const a = new Date(inicioISO);
  const b = new Date(fimISO);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const meses =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  return Math.max(0, meses + 1);
}

function anoDe(iso: string): number {
  return new Date(iso).getUTCFullYear();
}

interface CargaPreInterna {
  pct_total: number;
  composicao: {
    pis_pct: number;
    cofins_pct: number;
    icms_pct: number;
    iss_pct: number;
    irpj_csll_pct: number;
  };
}

function calcularCargaPre(
  aliquotas: CalcularReequilibrioInputT["aliquotas_pre"],
): CargaPreInterna {
  const composicao = {
    pis_pct: aliquotas.pis_pct,
    cofins_pct: aliquotas.cofins_pct,
    icms_pct: aliquotas.icms_pct,
    iss_pct: aliquotas.iss_pct,
    irpj_csll_pct: aliquotas.irpj_csll_pct,
  };
  const pct_total = round4(
    composicao.pis_pct +
      composicao.cofins_pct +
      composicao.icms_pct +
      composicao.iss_pct,
  );
  return { pct_total, composicao };
}

function executar(
  input: CalcularReequilibrioInputT,
): CalcularReequilibrioOutputT {
  const memoria: PassoMemoria[] = [];
  const alertas: string[] = [];
  const baseLegal: BaseLegalItem[] = [];

  // --- Passo 1: carga pré ----------------------------------------------------
  const cargaPre = calcularCargaPre(input.aliquotas_pre);
  memoria.push({
    passo: 1,
    descricao: "Cálculo da carga tributária pré-Reforma (regime extinto)",
    formula: "PIS + COFINS + ICMS + ISS",
    inputs: cargaPre.composicao,
    resultado: cargaPre.pct_total,
    unidade: "%",
  });
  baseLegal.push({
    norma: "Lei 10.637/2002 e Lei 10.833/2003",
    artigo: "PIS/Cofins não cumulativo (regimes pré-Reforma)",
    resumo: "Alíquotas-padrão de PIS (1,65%) e Cofins (7,6%) no lucro real",
  });

  // --- Passo 2: definir janela anual remanescente -----------------------------
  const anoInicio = Math.max(anoDe(input.contrato.vigencia_inicio), 2026);
  const anoFim = anoDe(input.contrato.vigencia_fim);
  if (anoFim < anoInicio) {
    return {
      sucesso: false,
      placeholder: false,
      carga_pre: { ...cargaPre, base_legal: ["Lei 10.637/2002; Lei 10.833/2003"] },
      carga_pos_por_ano: [],
      diferencial: {
        pct_medio_ponderado: 0,
        valor_anual_centavos: 0,
        valor_remanescente_contrato_centavos: 0,
        meses_remanescentes: 0,
      },
      memoria_calculo: memoria,
      base_legal: baseLegal,
      alertas,
      erro: "Vigência do contrato anterior ao período da Reforma Tributária",
    };
  }

  const params = {
    cbs_ref_pct: input.parametros_calculo.aliquotas_referencia_publicadas.cbs_pct,
    ibs_ref_pct: input.parametros_calculo.aliquotas_referencia_publicadas.ibs_pct,
  };
  const creditosPct = input.parametros_calculo.creditos_estimados_pct;
  const redutor = input.parametros_calculo.redutor_compras_govern_pct;

  // --- Passo 3: carga pós, ano a ano -----------------------------------------
  const cargaPosPorAno: CargaPosAno[] = [];
  const fundamentosUnicos = new Set<string>();

  for (let ano = anoInicio; ano <= anoFim; ano++) {
    let aliquotas;
    try {
      aliquotas = resolverAliquotasAno(ano, params);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alertas.push(`Ano ${ano}: ${msg}`);
      continue;
    }

    const efetivas = aplicarRedutorComprasGovernamentais(
      aliquotas,
      redutor,
      input.contrato.is_compra_governamental,
    );

    // Compensação 2026: efeito líquido zero para contribuintes regulares
    // (Art. 348 LC 214/2025). Modelamos zerando a carga efetiva.
    const cargaBruta = efetivas.cbs_pct + efetivas.ibs_pct;
    const cargaAposCredito = cargaBruta * (1 - creditosPct / 100);
    const cargaEfetiva = aliquotas.compensacao_pis_cofins ? 0 : cargaAposCredito;

    cargaPosPorAno.push({
      ano,
      cbs_pct: round4(efetivas.cbs_pct),
      ibs_pct: round4(efetivas.ibs_pct),
      redutor_aplicado_pct: efetivas.redutor_pct,
      carga_bruta_pct: round4(cargaBruta),
      carga_efetiva_pct: round4(cargaEfetiva),
      compensacao_pis_cofins: aliquotas.compensacao_pis_cofins,
      fundamento: aliquotas.fundamento,
    });

    fundamentosUnicos.add(aliquotas.fundamento);
  }

  if (cargaPosPorAno.length === 0) {
    return {
      sucesso: false,
      placeholder: false,
      carga_pre: { ...cargaPre, base_legal: ["Lei 10.637/2002; Lei 10.833/2003"] },
      carga_pos_por_ano: [],
      diferencial: {
        pct_medio_ponderado: 0,
        valor_anual_centavos: 0,
        valor_remanescente_contrato_centavos: 0,
        meses_remanescentes: 0,
      },
      memoria_calculo: memoria,
      base_legal: baseLegal,
      alertas,
      erro: "Nenhum ano da vigência pôde ter alíquotas resolvidas",
    };
  }

  for (const f of fundamentosUnicos) {
    baseLegal.push({
      norma: "LC 214/2025",
      artigo: f,
      resumo: "Regra de transição IBS/CBS aplicada ao ano de vigência",
    });
  }

  memoria.push({
    passo: 2,
    descricao: `Resolução das alíquotas pós-Reforma para ${cargaPosPorAno.length} ano(s) de vigência`,
    formula: "tabela[ano] × (1 − redutor_govern) × (1 − creditos)",
    inputs: {
      ano_inicio: anoInicio,
      ano_fim: anoFim,
      cbs_ref_pct: params.cbs_ref_pct ?? -1,
      ibs_ref_pct: params.ibs_ref_pct ?? -1,
      creditos_pct: creditosPct,
      redutor_compras_govern_pct: redutor ?? -1,
    },
    resultado: cargaPosPorAno.length,
    unidade: "anos",
  });

  // --- Passo 4: diferencial médio ponderado -----------------------------------
  // Ponderação simples por ano (sem peso por meses dentro do ano — boa aproximação
  // para contratos plurianuais; refinamento futuro pode usar meses por ano).
  const somaCargaPos = cargaPosPorAno.reduce(
    (acc, c) => acc + c.carga_efetiva_pct,
    0,
  );
  const cargaPosMedia = somaCargaPos / cargaPosPorAno.length;
  const diferencialPct = round4(cargaPosMedia - cargaPre.pct_total);

  memoria.push({
    passo: 3,
    descricao: "Diferencial de carga (pós médio ponderado − pré)",
    formula: "média(carga_pos_efetiva) − carga_pre",
    inputs: {
      carga_pos_media_pct: round4(cargaPosMedia),
      carga_pre_pct: cargaPre.pct_total,
    },
    resultado: diferencialPct,
    unidade: "p.p.",
  });

  // --- Passo 5: valor de reequilíbrio em centavos -----------------------------
  // Valor anual = valor_contrato × diferencial / 100
  // Remanescente = valor_anual × meses_remanescentes / 12
  const hoje = new Date().toISOString().slice(0, 10);
  const inicioRemanescente =
    input.contrato.vigencia_inicio > hoje ? input.contrato.vigencia_inicio : hoje;
  const mesesRem = mesesEntre(inicioRemanescente, input.contrato.vigencia_fim);

  const valorAnualCentavos = Math.round(
    (input.contrato.valor_centavos * diferencialPct) / 100,
  );
  const valorRemanescente = Math.round((valorAnualCentavos * mesesRem) / 12);

  memoria.push({
    passo: 4,
    descricao: "Valor de reequilíbrio em centavos (anual e remanescente)",
    formula:
      "valor_contrato × diferencial_pct / 100 ; remanescente = anual × meses_rem / 12",
    inputs: {
      valor_contrato_centavos: input.contrato.valor_centavos,
      diferencial_pct: diferencialPct,
      meses_remanescentes: mesesRem,
    },
    resultado: valorRemanescente,
    unidade: "centavos",
  });

  // --- Base legal sempre incluída --------------------------------------------
  baseLegal.push({
    norma: "LC 214/2025",
    artigo: "Arts. 373-377",
    resumo:
      "Capítulo IV — Reequilíbrio econômico-financeiro de contratos com a administração pública em razão da Reforma Tributária",
  });
  if (input.contrato.is_compra_governamental) {
    baseLegal.push({
      norma: "LC 214/2025",
      artigo: "Arts. 472-473",
      resumo:
        "Compras governamentais: redutor de alíquota CBS/IBS e destinação ao ente contratante",
    });
    baseLegal.push({
      norma: "Decreto 12955/2026",
      artigo: "Art. 601",
      resumo: "Cálculo anual do redutor aplicável às alíquotas CBS",
    });
  }

  // --- Alertas semânticos ----------------------------------------------------
  if (params.cbs_ref_pct === null && anoFim >= 2027) {
    alertas.push(
      "Alíquota de referência da CBS não informada — anos ≥ 2027 podem ter sido pulados (verificar 'alertas' por ano)",
    );
  }
  if (
    input.contrato.is_compra_governamental &&
    redutor === null &&
    anoFim >= 2027
  ) {
    alertas.push(
      "Contrato é compra governamental mas o redutor (Art. 601 Decreto 12955) não foi informado — cálculo feito sem redutor",
    );
  }
  if (input.contrato.regime_tributario_pre === "simples_nacional") {
    alertas.push(
      "Regime pré 'simples_nacional': alíquotas-padrão de PIS/Cofins/ICMS/ISS NÃO refletem a realidade do Simples — informar carga efetiva específica nos inputs",
    );
  }

  return {
    sucesso: true,
    placeholder: false,
    carga_pre: {
      ...cargaPre,
      base_legal: ["Lei 10.637/2002 (PIS)", "Lei 10.833/2003 (Cofins)"],
    },
    carga_pos_por_ano: cargaPosPorAno,
    diferencial: {
      pct_medio_ponderado: diferencialPct,
      valor_anual_centavos: valorAnualCentavos,
      valor_remanescente_contrato_centavos: valorRemanescente,
      meses_remanescentes: mesesRem,
    },
    memoria_calculo: memoria,
    base_legal: baseLegal,
    alertas,
    erro: null,
  };
}

async function handler(
  args: unknown,
  _env: Env,
): Promise<CalcularReequilibrioOutputT> {
  const parsed = CalcularReequilibrioInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "calcular_reequilibrio_tributario: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  return executar(parsed.data);
}

export const calcularReequilibrioTool: ToolDescriptor = {
  name: "calcular_reequilibrio_tributario",
  description:
    "Engine determinística de cálculo do diferencial de carga tributária " +
    "(pré × pós Reforma Tributária) para reequilíbrio econômico-financeiro de " +
    "contratos. Aplica a transição 2026-2033+ (LC 214/2025) e o redutor das " +
    "compras governamentais (Arts. 472-473 LC / Art. 601 Decreto 12955/2026).",
  inputSchema: zodToMcpSchema(CalcularReequilibrioInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};

// Export interno para testes unitários
export const __internal = { executar, mesesEntre, calcularCargaPre };
