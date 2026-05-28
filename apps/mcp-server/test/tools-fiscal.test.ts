/**
 * Testes da tool fiscal `calcular_reequilibrio_tributario`.
 *
 * Cobertura:
 *   - Validação de inputs (Zod refinements)
 *   - 3 cenários canônicos:
 *       (a) contrato privado pré-2027 (regime 2026 com compensação)
 *       (b) compra governamental em 2029 (phase-in IBS 10% + redutor)
 *       (c) phase-in 2031 (IBS 30% × ref)
 *   - Memória de cálculo e base legal sempre presentes
 *   - Resolução determinística da tabela de alíquotas
 */

import { describe, expect, it } from "vitest";
import { findTool } from "../src/mcp/tools/index.js";
import { createTestEnv } from "./_fakes.js";
import { resolverAliquotasAno } from "../src/mcp/tools/fiscal/tabelas-aliquotas.js";
import type { CalcularReequilibrioOutputT } from "@vectorgov-t/schemas";

const TOOL = "calcular_reequilibrio_tributario";

// Input válido base — testes derivam dele com overrides
const baseInput = {
  contrato: {
    numero: "001/2024",
    valor_centavos: 1_200_000_00, // R$ 1.200.000,00
    data_assinatura: "2024-06-01",
    vigencia_inicio: "2026-01-01",
    vigencia_fim: "2026-12-31",
    regime_tributario_pre: "lucro_real" as const,
    is_compra_governamental: false,
    ente_contratante: "nao_se_aplica" as const,
  },
  aliquotas_pre: {
    pis_pct: 1.65,
    cofins_pct: 7.6,
    icms_pct: 18,
    iss_pct: 0,
    irpj_csll_pct: 0,
  },
  parametros_calculo: {
    aliquotas_referencia_publicadas: { cbs_pct: null, ibs_pct: null },
    redutor_compras_govern_pct: null,
    creditos_estimados_pct: 0,
  },
};

describe("tabela determinística de alíquotas", () => {
  it("ano 2026: CBS 0,9% + IBS 0,1% com compensação total", () => {
    const r = resolverAliquotasAno(2026, { cbs_ref_pct: null, ibs_ref_pct: null });
    expect(r.cbs_pct).toBe(0.9);
    expect(r.ibs_pct).toBe(0.1);
    expect(r.compensacao_pis_cofins).toBe(true);
  });

  it("ano 2027: CBS = ref − 0,1pp, IBS 0,1%, sem compensação", () => {
    const r = resolverAliquotasAno(2027, {
      cbs_ref_pct: 8.8,
      ibs_ref_pct: 18.0,
    });
    expect(r.cbs_pct).toBeCloseTo(8.7, 5);
    expect(r.ibs_pct).toBe(0.1);
    expect(r.compensacao_pis_cofins).toBe(false);
  });

  it("ano 2029: CBS plena + IBS 10% da referência", () => {
    const r = resolverAliquotasAno(2029, {
      cbs_ref_pct: 8.8,
      ibs_ref_pct: 18.0,
    });
    expect(r.cbs_pct).toBe(8.8);
    expect(r.ibs_pct).toBeCloseTo(1.8, 5);
  });

  it("ano 2032: IBS 40% da referência", () => {
    const r = resolverAliquotasAno(2032, {
      cbs_ref_pct: 8.8,
      ibs_ref_pct: 18.0,
    });
    expect(r.ibs_pct).toBeCloseTo(7.2, 5);
  });

  it("ano 2033+: regime pleno", () => {
    const r = resolverAliquotasAno(2034, {
      cbs_ref_pct: 8.8,
      ibs_ref_pct: 18.0,
    });
    expect(r.cbs_pct).toBe(8.8);
    expect(r.ibs_pct).toBe(18.0);
  });

  it("falha se ano >= 2027 e não houver alíquota de referência", () => {
    expect(() =>
      resolverAliquotasAno(2027, { cbs_ref_pct: null, ibs_ref_pct: null }),
    ).toThrow(/Alíquota de referência/);
  });

  it("rejeita anos anteriores a 2026", () => {
    expect(() =>
      resolverAliquotasAno(2025, { cbs_ref_pct: null, ibs_ref_pct: null }),
    ).toThrow(/anterior à vigência/);
  });
});

describe("tool calcular_reequilibrio_tributario — validação", () => {
  it("rejeita vigência invertida", async () => {
    const tool = findTool(TOOL)!;
    await expect(
      tool.handler(
        {
          ...baseInput,
          contrato: {
            ...baseInput.contrato,
            vigencia_inicio: "2027-01-01",
            vigencia_fim: "2026-01-01",
          },
        },
        createTestEnv(),
      ),
    ).rejects.toThrow(/argumentos inválidos/);
  });

  it("rejeita compra governamental sem ente válido", async () => {
    const tool = findTool(TOOL)!;
    await expect(
      tool.handler(
        {
          ...baseInput,
          contrato: {
            ...baseInput.contrato,
            is_compra_governamental: true,
            ente_contratante: "nao_se_aplica",
          },
        },
        createTestEnv(),
      ),
    ).rejects.toThrow(/argumentos inválidos/);
  });

  it("rejeita valor de contrato não positivo", async () => {
    const tool = findTool(TOOL)!;
    await expect(
      tool.handler(
        {
          ...baseInput,
          contrato: { ...baseInput.contrato, valor_centavos: 0 },
        },
        createTestEnv(),
      ),
    ).rejects.toThrow(/argumentos inválidos/);
  });
});

describe("cenário (a) — contrato privado em 2026", () => {
  it("aplica compensação PIS/Cofins → carga efetiva 0% em 2026", async () => {
    const tool = findTool(TOOL)!;
    const out = (await tool.handler(
      baseInput,
      createTestEnv(),
    )) as CalcularReequilibrioOutputT;

    expect(out.sucesso).toBe(true);
    expect(out.placeholder).toBe(false);
    expect(out.erro).toBeNull();
    expect(out.carga_pos_por_ano).toHaveLength(1);

    const ano2026 = out.carga_pos_por_ano[0]!;
    expect(ano2026.ano).toBe(2026);
    expect(ano2026.cbs_pct).toBe(0.9);
    expect(ano2026.ibs_pct).toBe(0.1);
    expect(ano2026.carga_bruta_pct).toBeCloseTo(1.0, 5);
    expect(ano2026.carga_efetiva_pct).toBe(0); // compensação total
    expect(ano2026.compensacao_pis_cofins).toBe(true);

    // Carga pré = 1.65 + 7.6 + 18 = 27.25
    expect(out.carga_pre.pct_total).toBeCloseTo(27.25, 5);

    // Diferencial em 2026 = 0 − 27.25 = -27.25
    expect(out.diferencial.pct_medio_ponderado).toBeCloseTo(-27.25, 4);

    expect(out.memoria_calculo.length).toBeGreaterThanOrEqual(3);
    expect(out.base_legal.length).toBeGreaterThan(0);
  });
});

describe("cenário (b) — compra governamental em 2029", () => {
  it("aplica IBS phase-in 10% + redutor de compras governamentais", async () => {
    const tool = findTool(TOOL)!;
    const out = (await tool.handler(
      {
        ...baseInput,
        contrato: {
          ...baseInput.contrato,
          vigencia_inicio: "2029-01-01",
          vigencia_fim: "2029-12-31",
          is_compra_governamental: true,
          ente_contratante: "estado",
        },
        parametros_calculo: {
          aliquotas_referencia_publicadas: { cbs_pct: 8.8, ibs_pct: 18.0 },
          redutor_compras_govern_pct: 30, // 30% de redução
          creditos_estimados_pct: 0,
        },
      },
      createTestEnv(),
    )) as CalcularReequilibrioOutputT;

    expect(out.sucesso).toBe(true);
    expect(out.carga_pos_por_ano).toHaveLength(1);

    const ano = out.carga_pos_por_ano[0]!;
    expect(ano.ano).toBe(2029);
    // CBS plena (8.8) com redutor 30% → 6.16
    expect(ano.cbs_pct).toBeCloseTo(6.16, 4);
    // IBS = 18 × 0,10 × (1 − 0,30) = 1,26
    expect(ano.ibs_pct).toBeCloseTo(1.26, 4);
    expect(ano.redutor_aplicado_pct).toBe(30);
    expect(ano.compensacao_pis_cofins).toBe(false);

    // Base legal deve incluir Arts. 472-473 LC e Art. 601 Decreto
    const referencias = out.base_legal.map((b) => `${b.norma} ${b.artigo}`);
    expect(referencias.some((r) => r.includes("472-473"))).toBe(true);
    expect(referencias.some((r) => r.includes("Art. 601"))).toBe(true);
  });
});

describe("cenário (c) — phase-in IBS 30% em 2031", () => {
  it("IBS = ref × 0,30, sem redutor (não é compra governamental)", async () => {
    const tool = findTool(TOOL)!;
    const out = (await tool.handler(
      {
        ...baseInput,
        contrato: {
          ...baseInput.contrato,
          vigencia_inicio: "2031-01-01",
          vigencia_fim: "2031-12-31",
        },
        parametros_calculo: {
          aliquotas_referencia_publicadas: { cbs_pct: 8.8, ibs_pct: 18.0 },
          redutor_compras_govern_pct: null,
          creditos_estimados_pct: 20, // 20% de créditos por não cumulatividade
        },
      },
      createTestEnv(),
    )) as CalcularReequilibrioOutputT;

    expect(out.sucesso).toBe(true);
    const ano = out.carga_pos_por_ano[0]!;
    expect(ano.cbs_pct).toBe(8.8);
    expect(ano.ibs_pct).toBeCloseTo(5.4, 4); // 18 × 0,30
    // Bruta = 8.8 + 5.4 = 14.2 ; com 20% de créditos = 11.36
    expect(ano.carga_bruta_pct).toBeCloseTo(14.2, 4);
    expect(ano.carga_efetiva_pct).toBeCloseTo(11.36, 4);
    expect(ano.redutor_aplicado_pct).toBeNull();
  });
});

describe("contrato multi-anual atravessando transição", () => {
  it("calcula um item por ano de 2027 a 2033", async () => {
    const tool = findTool(TOOL)!;
    const out = (await tool.handler(
      {
        ...baseInput,
        contrato: {
          ...baseInput.contrato,
          vigencia_inicio: "2027-01-01",
          vigencia_fim: "2033-12-31",
        },
        parametros_calculo: {
          aliquotas_referencia_publicadas: { cbs_pct: 8.8, ibs_pct: 18.0 },
          redutor_compras_govern_pct: null,
          creditos_estimados_pct: 0,
        },
      },
      createTestEnv(),
    )) as CalcularReequilibrioOutputT;

    expect(out.sucesso).toBe(true);
    expect(out.carga_pos_por_ano).toHaveLength(7);
    const anos = out.carga_pos_por_ano.map((c) => c.ano);
    expect(anos).toEqual([2027, 2028, 2029, 2030, 2031, 2032, 2033]);

    // Em 2033 atinge plenitude
    const a2033 = out.carga_pos_por_ano.find((c) => c.ano === 2033)!;
    expect(a2033.ibs_pct).toBe(18.0);
    expect(a2033.cbs_pct).toBe(8.8);
  });
});

describe("alertas semânticos", () => {
  it("alerta quando redutor ausente para compra governamental ≥ 2027", async () => {
    const tool = findTool(TOOL)!;
    const out = (await tool.handler(
      {
        ...baseInput,
        contrato: {
          ...baseInput.contrato,
          vigencia_inicio: "2029-01-01",
          vigencia_fim: "2029-12-31",
          is_compra_governamental: true,
          ente_contratante: "municipio",
        },
        parametros_calculo: {
          aliquotas_referencia_publicadas: { cbs_pct: 8.8, ibs_pct: 18.0 },
          redutor_compras_govern_pct: null,
          creditos_estimados_pct: 0,
        },
      },
      createTestEnv(),
    )) as CalcularReequilibrioOutputT;

    expect(out.alertas.some((a) => a.includes("redutor"))).toBe(true);
  });

  it("alerta para Simples Nacional (alíquotas-padrão não refletem realidade)", async () => {
    const tool = findTool(TOOL)!;
    const out = (await tool.handler(
      {
        ...baseInput,
        contrato: {
          ...baseInput.contrato,
          regime_tributario_pre: "simples_nacional",
        },
      },
      createTestEnv(),
    )) as CalcularReequilibrioOutputT;

    expect(out.alertas.some((a) => a.toLowerCase().includes("simples"))).toBe(
      true,
    );
  });
});
