/**
 * Testes do chat conversacional do notebook (buildTools).
 *
 * Foco: a tool `calcular_reequilibrio` do chat injeta o catálogo real no
 * Calculista (regressão — antes passava tools: [] e o Calculista caía em
 * placeholder).
 */
import { describe, expect, it } from "vitest";
import { buildTools } from "../../src/agents/conversational/engine.js";
import { criarMockLLM } from "../../src/agents/llm/mock.js";
import { createTestEnv } from "../_fakes.js";
import type { NotebookAgent } from "../../src/agents/notebook-agent.js";
import type { ResultadoCalculista } from "../../src/agents/roles/_io-schemas.js";

// Notebook mínimo — calcular_reequilibrio só lê notebook["state"]?.id.
const notebookMock = {
  state: { id: { toString: () => "nb-test" } },
} as unknown as NotebookAgent;

// LLM mock: responde à extração de inputs do Calculista (compra
// governamental 2029) — o resto do cálculo é determinístico (tool real).
function llmComExtracao() {
  return criarMockLLM({
    "calculista.extrair_inputs": () => ({
      regime_tributario_pre: "lucro_real",
      aliquotas_pre: {
        pis_pct: 1.65,
        cofins_pct: 7.6,
        icms_pct: 18,
        iss_pct: 0,
        irpj_csll_pct: 0,
      },
      is_compra_governamental: true,
      ente_contratante: "estado",
      vigencia_fim: "2029-12-31",
      aliquotas_referencia_publicadas: { cbs_pct: 8.8, ibs_pct: 18.0 },
      redutor_compras_govern_pct: 30,
      creditos_estimados_pct: 0,
      justificativa: "Lucro real, ICMS 18%, compra governamental estadual.",
    }),
  });
}

describe("chat notebook — tool calcular_reequilibrio", () => {
  it("injeta tools reais → Calculista executa a engine (placeholder=false)", async () => {
    const env = createTestEnv();
    const llm = llmComExtracao();
    const tools = buildTools(env, llm, notebookMock);

    expect(tools["calcular_reequilibrio"]).toBeDefined();

    const result = (await tools["calcular_reequilibrio"]!.execute({
      descricao_pedido:
        "Calcular o reequilíbrio de um contrato estadual de obra com a Reforma Tributária em 2029.",
      contexto: "Contrato de R$ 1.200.000,00, vigência 2029.",
    })) as ResultadoCalculista;

    expect(result.calculos).toHaveLength(1);
    const calc = result.calculos[0]!;
    // O ponto da regressão: com tools reais injetadas, a engine determinística
    // RODA (placeholder=false) — antes caía em fallback placeholder com
    // erro "TOOL_NAO_DISPONIVEL" porque o chat passava tools: [].
    expect(calc.placeholder).toBe(false);
    expect(calc.erro).not.toBe("TOOL_NAO_DISPONIVEL");
    expect(calc.tipo).toBe("reequilibrio_economico");
    // Obs.: no chat livre o valor do contrato não vem estruturado
    // (valor_centavos=0), então o cálculo de VALOR não conclui — isso é
    // resolvido pelo fluxo de extração da petição (Fases 2/3).
  });

  it("expõe as tools de documento e de legislação no chat", () => {
    const env = createTestEnv();
    const tools = buildTools(env, llmComExtracao(), notebookMock);
    expect(tools["buscar_no_documento"]).toBeDefined();
    expect(tools["ler_documento_inteiro"]).toBeDefined();
    expect(tools["buscar_legislacao"]).toBeDefined();
    expect(tools["consultar_pesquisador"]).toBeDefined();
  });
});
