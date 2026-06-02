/**
 * Testes da tool de chat `analisar_reequilibrio` (Fase 3).
 *
 * rodarAnalisePeticao é mockado — aqui validamos a montagem da Petição a
 * partir do rascunho + correções, as validações duras e o repasse do
 * resultado. O fluxo PEVS real é coberto pelos testes do pevs-engine.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const rodarAnaliseMock = vi.fn();
vi.mock("../../src/agents/run-analise.js", () => ({
  rodarAnalisePeticao: (...args: unknown[]) => rodarAnaliseMock(...args),
  criarEnginePEVS: vi.fn(),
}));

import { buildTools } from "../../src/agents/conversational/engine.js";
import { criarMockLLM } from "../../src/agents/llm/mock.js";
import { createTestEnv } from "../_fakes.js";
import type { NotebookAgent } from "../../src/agents/notebook-agent.js";
import type { PeticaoRascunho } from "@vectorgov-t/schemas";

const rascunhoValido: PeticaoRascunho = {
  requerente: "Construtora Beta",
  contratante_razao_social: "Prefeitura de Exemplo",
  contratante_cnpj: null,
  contratante_ente_federativo: "municipio",
  contratado_razao_social: "Construtora Beta Ltda",
  contratado_cnpj: "12345678000190",
  contrato_numero: "010/2024",
  contrato_modalidade: "concorrencia",
  contrato_objeto: "obra de pavimentação",
  contrato_valor_centavos: 120000000,
  contrato_data_assinatura: "2024-01-10",
  contrato_data_inicio_vigencia: "2024-02-01",
  resumo_pedido:
    "A empresa pede reequilíbrio do contrato de pavimentação em razão da alteração da carga tributária trazida pela Reforma Tributária (LC 214/2025).",
  valor_pretendido_centavos: null,
  base_legal_invocada: ["Art. 124 da Lei 14.133/2021"],
  campos_incertos: [],
};

function nb(rascunho: PeticaoRascunho | null): NotebookAgent {
  return {
    state: { id: { toString: () => "nb" } },
    lerRascunho: async () => rascunho,
    // FSM: a tool analisar_reequilibrio liga o notebook à análise gerada.
    salvarAnaliseId: async () => {},
  } as unknown as NotebookAgent;
}

function tool(rascunho: PeticaoRascunho | null, apiKey: string | null) {
  const env = createTestEnv();
  const tools = buildTools(env, criarMockLLM({}), nb(rascunho), apiKey);
  return tools["analisar_reequilibrio"]!;
}

beforeEach(() => {
  rodarAnaliseMock.mockReset();
  rodarAnaliseMock.mockResolvedValue({
    analise: {
      id: "an-1",
      peticao_id: "pet-1",
      veredito: "procedente",
      score_confianca: 0.82,
      citacoes: [{ status: "APROVADA" }, { status: "REJEITADA" }],
      calculos: [
        {
          descricao: "Reequilíbrio tributário",
          valor_final: -23796000,
          unidade_final: "centavos",
          sucesso: true,
        },
      ],
    },
    retries_executados: 0,
  });
});

describe("tool analisar_reequilibrio", () => {
  it("erro quando o gateway não está configurado (sem credencial)", async () => {
    const r = (await tool(rascunhoValido, null).execute({})) as { erro?: string };
    expect(r.erro).toMatch(/gateway|CF_AIG_TOKEN/i);
    expect(rodarAnaliseMock).not.toHaveBeenCalled();
  });

  it("erro quando não há rascunho", async () => {
    const r = (await tool(null, "key").execute({})) as { erro?: string };
    expect(r.erro).toMatch(/rascunho/i);
    expect(rodarAnaliseMock).not.toHaveBeenCalled();
  });

  it("erro quando falta valor do contrato", async () => {
    const semValor = { ...rascunhoValido, contrato_valor_centavos: null };
    const r = (await tool(semValor, "key").execute({})) as {
      campos_faltando?: string[];
    };
    expect(r.campos_faltando).toContain("contrato_valor_centavos");
    expect(rodarAnaliseMock).not.toHaveBeenCalled();
  });

  it("caminho feliz: monta petição, roda PEVS e resume o veredito", async () => {
    const r = (await tool(rascunhoValido, "key").execute({})) as {
      veredito?: string;
      citacoes_aprovadas?: number;
      peticao_id?: string;
    };
    expect(rodarAnaliseMock).toHaveBeenCalledTimes(1);
    // A petição montada chega válida ao PEVS.
    const peticaoArg = rodarAnaliseMock.mock.calls[0]![1] as {
      contrato: { valor_centavos: number };
      fato_alegado: string;
    };
    expect(peticaoArg.contrato.valor_centavos).toBe(120000000);
    expect(peticaoArg.fato_alegado.length).toBeGreaterThanOrEqual(50);
    expect(r.veredito).toBe("procedente");
    expect(r.citacoes_aprovadas).toBe(1);
    expect(r.peticao_id).toBe("pet-1");
  });

  it("aplica correcoes sobre o rascunho antes de rodar", async () => {
    await tool(rascunhoValido, "key").execute({
      correcoes: { contrato_valor_centavos: 50000000 },
    });
    const peticaoArg = rodarAnaliseMock.mock.calls[0]![1] as {
      contrato: { valor_centavos: number };
    };
    expect(peticaoArg.contrato.valor_centavos).toBe(50000000);
  });
});
