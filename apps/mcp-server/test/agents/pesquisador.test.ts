/**
 * Testes do Pesquisador — recuperação real via tools (não alucinação).
 *
 * Cenários:
 *  (a) caminho feliz: busca retorna snippets reais → citações candidatas
 *      carregam norma_id + dispositivo + texto vindos da fonte.
 *  (b) seleção do LLM filtra quais snippets viram citação.
 *  (c) fallback sem tools → resultado vazio.
 *  (d) busca sem resultados → achados/citações vazios.
 */
import { describe, expect, it } from "vitest";
import { criarPesquisador, type PesquisadorInput } from "../../src/agents/roles/pesquisador.js";
import { criarMockLLM } from "../../src/agents/llm/mock.js";
import { consoleLogger, type AgentContext, type ToolMCP } from "../../src/agents/types.js";
import type { Snippet } from "@vectorgov-t/schemas";

const TEXTO_124 =
  "Os contratos regidos por esta Lei poderão ser alterados nos seguintes casos: ...";
const TEXTO_65 =
  "O equilíbrio econômico-financeiro será restabelecido por aditivo contratual.";

function snippet(
  norma_id: string,
  norma_label: string,
  artigo: number,
  texto: string,
  score = 0.9,
): Snippet {
  return {
    citacao: {
      norma_id,
      norma_label,
      artigo,
      paragrafo: null,
      inciso: null,
      alinea: null,
      hierarquia_path: `art${artigo}`,
    },
    texto,
    score,
  };
}

function toolBuscar(resultados: Snippet[]): ToolMCP {
  return {
    nome: "buscar_legislacao",
    descricao: "busca híbrida",
    executar: async () => ({
      resultados,
      total: resultados.length,
      query_normalizada: "x",
      metodo: "hybrid_rrf_rerank",
    }),
  };
}

function ctx(tools: ToolMCP[], indices: number[]): AgentContext {
  return {
    tools,
    llm: criarMockLLM({
      "pesquisador.planejar_busca": () => ({
        queries: ["reequilíbrio contrato administrativo"],
        normas_alvo: [],
      }),
      "pesquisador.selecionar": () => ({
        indices_relevantes: indices,
        justificativa: "trechos pertinentes ao reequilíbrio",
      }),
    }),
    logger: consoleLogger,
    sessionId: "s",
    tracingId: "t",
  };
}

const input: PesquisadorInput = {
  pergunta_focal: "Cabe reequilíbrio por alteração tributária?",
  contexto_peticao: "Contrato de obra, fato superveniente tributário.",
};

describe("Pesquisador — recuperação real", () => {
  it("caminho feliz: citação candidata carrega norma_id + texto da fonte", async () => {
    const snippets = [
      snippet("lei-14133-2021", "Lei 14.133/2021", 124, TEXTO_124),
      snippet("lei-14133-2021", "Lei 14.133/2021", 65, TEXTO_65),
    ];
    const pesq = criarPesquisador();
    const out = await pesq.executar(input, ctx([toolBuscar(snippets)], [0]));

    expect(out.tools_chamadas).toContain("buscar_legislacao");
    expect(out.achados).toHaveLength(2); // todos os snippets viram achados
    expect(out.citacoes_candidatas).toHaveLength(1); // só o índice 0 selecionado

    const cit = out.citacoes_candidatas[0]!;
    expect(cit.status).toBe("PENDENTE");
    expect(cit.norma_id).toBe("lei-14133-2021");
    expect(cit.dispositivo).toEqual({
      artigo: 124,
      paragrafo: undefined,
      inciso: undefined,
      alinea: undefined,
    });
    // CRÍTICO: texto vem da fonte, não inventado pelo LLM.
    expect(cit.texto_literal).toBe(TEXTO_124);
  });

  it("seleção do LLM filtra: 2 selecionados → 2 citações", async () => {
    const snippets = [
      snippet("lei-14133-2021", "Lei 14.133/2021", 124, TEXTO_124),
      snippet("lc-214-2025", "LC 214/2025", 373, TEXTO_65),
    ];
    const pesq = criarPesquisador();
    const out = await pesq.executar(input, ctx([toolBuscar(snippets)], [0, 1]));
    expect(out.citacoes_candidatas).toHaveLength(2);
    expect(out.citacoes_candidatas[1]!.tipo_fonte).toBe("lei_complementar");
    expect(out.citacoes_candidatas[1]!.norma_id).toBe("lc-214-2025");
  });

  it("fallback: sem tools → resultado vazio", async () => {
    const pesq = criarPesquisador();
    const out = await pesq.executar(input, ctx([], [0]));
    expect(out.achados).toHaveLength(0);
    expect(out.citacoes_candidatas).toHaveLength(0);
  });

  it("busca sem resultados → achados e citações vazios", async () => {
    const pesq = criarPesquisador();
    const out = await pesq.executar(input, ctx([toolBuscar([])], [0]));
    expect(out.achados).toHaveLength(0);
    expect(out.citacoes_candidatas).toHaveLength(0);
    expect(out.tools_chamadas).toContain("buscar_legislacao");
  });
});
