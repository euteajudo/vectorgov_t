/**
 * Testes do Calculista — integração LLM + tool determinística.
 *
 * Estratégia:
 *  - LLM mockado (tag "calculista.extrair_inputs") devolve os inputs
 *    estruturados.
 *  - A tool fiscal REAL é injetada em contexto.tools (handler puro, sem env).
 *  - Asserts no CalculoTributario resultante.
 *
 * Cenários:
 *  (a) caminho feliz — compra governamental 2029, tool calcula de verdade.
 *  (b) fallback — sem tool no contexto → placeholder controlado.
 *  (c) erro propagado — tool recebe input inválido e devolve sucesso=false.
 */

import { describe, expect, it } from "vitest";
import { criarCalculista, type CalculistaInput } from "../../src/agents/roles/calculista.js";
import { criarMockLLM } from "../../src/agents/llm/mock.js";
import { consoleLogger, type AgentContext, type ToolMCP } from "../../src/agents/types.js";
import { calcularReequilibrioTool } from "../../src/mcp/tools/fiscal/index.js";
import type { Env } from "../../src/env.js";
import type { Peticao } from "@vectorgov-t/schemas";

const peticaoBase: Peticao = {
  requerente: "Dr. Fulano (OAB/PE 12345)",
  contratante: {
    razao_social: "Estado de Pernambuco",
    cnpj: "",
    ente_federativo: "estado",
  },
  contratado: {
    razao_social: "Construtora Beta Ltda",
    cnpj: "12345678000190",
    ente_federativo: "privada",
  },
  contrato: {
    numero: "PRD-2029/001",
    modalidade: "concorrencia",
    data_assinatura: "2024-06-01",
    data_inicio_vigencia: "2029-01-01",
    valor_centavos: 120000000,
    objeto: "Execução de obra de pavimentação asfáltica",
  },
  fato_alegado:
    "A entrada em vigor da Reforma Tributária (LC 214/2025) alterou a carga tributária incidente sobre o contrato, justificando o reequilíbrio econômico-financeiro.",
  base_legal_invocada: ["Art. 124 da Lei 14.133/2021"],
  calculos_apresentados: [],
  anexos_urls: [],
  data_protocolo: "2029-02-01",
};

// Inputs que o LLM "extrai" — cenário compra governamental 2029.
const inputsLLM2029 = {
  regime_tributario_pre: "lucro_real" as const,
  aliquotas_pre: {
    pis_pct: 1.65,
    cofins_pct: 7.6,
    icms_pct: 18,
    iss_pct: 0,
    irpj_csll_pct: 0,
  },
  is_compra_governamental: true,
  ente_contratante: "estado" as const,
  vigencia_fim: "2029-12-31",
  aliquotas_referencia_publicadas: { cbs_pct: 8.8, ibs_pct: 18.0 },
  redutor_compras_govern_pct: 30,
  creditos_estimados_pct: 0,
  justificativa:
    "Lucro real com alíquotas-padrão PIS/Cofins; ICMS 18% típico; compra governamental estadual com redutor de 30%.",
};

function toolFiscalMCP(): ToolMCP {
  return {
    nome: calcularReequilibrioTool.name,
    descricao: calcularReequilibrioTool.description,
    executar: async (args) =>
      calcularReequilibrioTool.handler(args, {} as Env),
  };
}

function montarContexto(
  tools: ToolMCP[],
  inputs: unknown,
): AgentContext {
  return {
    tools,
    llm: criarMockLLM({
      "calculista.extrair_inputs": () => inputs,
    }),
    logger: consoleLogger,
    sessionId: "sess-test",
    tracingId: "trace-test",
  };
}

describe("Calculista — caminho feliz (compra governamental 2029)", () => {
  it("LLM extrai inputs, tool calcula, output é mapeado", async () => {
    const calculista = criarCalculista();
    const contexto = montarContexto([toolFiscalMCP()], inputsLLM2029);
    const input: CalculistaInput = {
      peticao: peticaoBase,
      contexto_pedido: "Calcular impacto da Reforma no contrato PRD-2029/001",
    };

    const out = await calculista.executar(input, contexto);

    expect(out.calculos).toHaveLength(1);
    const calc = out.calculos[0]!;
    expect(calc.sucesso).toBe(true);
    expect(calc.placeholder).toBe(false);
    expect(calc.tipo).toBe("reequilibrio_economico");
    expect(calc.unidade_final).toBe("centavos");

    // Diferencial esperado: carga pós 7.42% − pré 27.25% = -19.83 p.p.
    // Valor = 120000000 × -0.1983 = -23.796.000 centavos
    expect(calc.valor_final).toBe(-23796000);

    // Memória deve conter: justificativa LLM + passos da tool + base legal
    expect(calc.memoria.length).toBeGreaterThanOrEqual(5);
    expect(calc.memoria[0]!.descricao).toContain("Inputs inferidos pelo LLM");
    const textoMemoria = calc.memoria.map((l) => l.descricao).join(" | ");
    expect(textoMemoria).toContain("472-473");
    expect(textoMemoria).toContain("Art. 601");
  });
});

describe("Calculista — fallback sem tool", () => {
  it("devolve placeholder controlado quando a tool não está no contexto", async () => {
    const calculista = criarCalculista();
    // contexto.tools vazio
    const contexto = montarContexto([], inputsLLM2029);
    const input: CalculistaInput = {
      peticao: peticaoBase,
      contexto_pedido: "x",
    };

    const out = await calculista.executar(input, contexto);

    expect(out.calculos).toHaveLength(1);
    const calc = out.calculos[0]!;
    expect(calc.sucesso).toBe(false);
    expect(calc.placeholder).toBe(true);
    expect(calc.erro).toBe("TOOL_NAO_DISPONIVEL");
  });
});

describe("Calculista — erro propagado da tool", () => {
  it("marca sucesso=false quando a engine devolve erro (vigência pré-2026)", async () => {
    const calculista = criarCalculista();
    const inputsPre2026 = {
      ...inputsLLM2029,
      vigencia_fim: "2025-12-31",
    };
    const peticaoPre2026: Peticao = {
      ...peticaoBase,
      contrato: {
        ...peticaoBase.contrato,
        data_inicio_vigencia: "2025-01-01",
      },
    };
    const contexto = montarContexto([toolFiscalMCP()], inputsPre2026);
    const input: CalculistaInput = {
      peticao: peticaoPre2026,
      contexto_pedido: "x",
    };

    const out = await calculista.executar(input, contexto);
    const calc = out.calculos[0]!;
    expect(calc.sucesso).toBe(false);
    expect(calc.placeholder).toBe(false);
    expect(calc.valor_final).toBeNull();
    expect(calc.erro).toBeTruthy();
  });
});
