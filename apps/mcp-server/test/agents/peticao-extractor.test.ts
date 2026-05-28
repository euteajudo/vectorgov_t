/**
 * Testes do extrator de petição a partir do texto de um documento.
 */
import { describe, expect, it } from "vitest";
import { extrairPeticaoDeTexto } from "../../src/agents/conversational/peticao-extractor.js";
import { criarMockLLM } from "../../src/agents/llm/mock.js";

const DOC = `PEDIDO DE REEQUILÍBRIO ECONÔMICO-FINANCEIRO
À Prefeitura Municipal de Exemplo.
A empresa Construtora Beta Ltda, CNPJ 12.345.678/0001-90, vem requerer o
reequilíbrio do Contrato nº 010/2024 (concorrência), objeto: obra de
pavimentação, valor de R$ 1.200.000,00, em razão da Reforma Tributária.`;

describe("extrairPeticaoDeTexto", () => {
  it("extrai campos do documento e marca incertos", async () => {
    const llm = criarMockLLM({
      "notebook.extrair_peticao": () => ({
        requerente: "Construtora Beta Ltda",
        contratante_razao_social: "Prefeitura Municipal de Exemplo",
        contratante_ente_federativo: "municipio",
        contratado_razao_social: "Construtora Beta Ltda",
        contratado_cnpj: "12.345.678/0001-90",
        contrato_numero: "010/2024",
        contrato_modalidade: "concorrencia",
        contrato_objeto: "obra de pavimentação",
        contrato_valor_centavos: 120000000,
        resumo_pedido:
          "A empresa pede reequilíbrio do contrato de pavimentação em razão da alteração de carga tributária trazida pela Reforma Tributária.",
        campos_incertos: ["contrato_data_assinatura"],
      }),
    });

    const r = await extrairPeticaoDeTexto(DOC, "analise este pedido", llm);
    expect(r.contrato_valor_centavos).toBe(120000000);
    expect(r.contratante_ente_federativo).toBe("municipio");
    expect(r.contrato_numero).toBe("010/2024");
    expect(r.campos_incertos).toContain("contrato_data_assinatura");
    expect(r.resumo_pedido.length).toBeGreaterThan(20);
  });

  it("aplica defaults quando o LLM devolve campos parciais", async () => {
    const llm = criarMockLLM({
      "notebook.extrair_peticao": () => ({
        resumo_pedido: "Pedido genérico sem valor identificado.",
        campos_incertos: ["contrato_valor_centavos", "requerente"],
      }),
    });
    const r = await extrairPeticaoDeTexto(DOC, "", llm);
    // Campos ausentes viram null; arrays viram [].
    expect(r.contrato_valor_centavos).toBeNull();
    expect(r.requerente).toBeNull();
    expect(r.base_legal_invocada).toEqual([]);
  });
});
