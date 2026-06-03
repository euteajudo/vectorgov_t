/**
 * Testes do Especialista em Licitações — jurisprudência FUNDAMENTADA (não
 * alucinada). O papel busca acórdãos reais (`buscar_acordaos_tcu`), injeta no
 * prompt e PÓS-FILTRA a saída do LLM contra o conjunto recuperado.
 *
 * Cenários:
 *  (a) grounding + pós-filtro: descarta acórdão inventado, normaliza p/ o label
 *      canônico, dedup; e injeta o bloco "JURISPRUDÊNCIA DISPONÍVEL" no prompt.
 *  (b) tool ausente → comportamento legado (saída do LLM passa direto), sem throw.
 *  (c) tool retorna vazio → sem grounding → legado.
 *  (d) tool lança → degrada gracioso (legado), sem derrubar a análise.
 */
import { describe, expect, it } from "vitest";
import { criarEspLicitacoes, type EspLicitacoesInput } from "../../src/agents/roles/esp-licitacoes.js";
import { criarMockLLM, type MockHandler } from "../../src/agents/llm/mock.js";
import { consoleLogger, type AgentContext, type ToolMCP } from "../../src/agents/types.js";
import type { ResultadoPesquisa } from "../../src/agents/roles/_io-schemas.js";

const ACORDAOS_REAIS = [
  {
    citacao: { label: "Acórdão 1148/2022-TCU-Plenário", numero: "1148", ano: 2022 },
    texto: "reequilíbrio econômico-financeiro do contrato em álea extraordinária",
  },
  {
    citacao: { label: "Acórdão 4072/2020-TCU-Plenário", numero: "4072", ano: 2020 },
    texto: "reajuste vs. reequilíbrio — distinção e requisitos",
  },
];

function toolAcordaos(
  resultados: unknown[],
  opts: { capture?: Array<Record<string, unknown>>; throws?: boolean } = {},
): ToolMCP {
  return {
    nome: "buscar_acordaos_tcu",
    descricao: "busca semântica em acórdãos do TCU",
    executar: async (args) => {
      opts.capture?.push(args);
      if (opts.throws) throw new Error("vectorize indisponível");
      return { resultados, total: resultados.length, metodo: "vectorize_rerank" };
    },
  };
}

function ctx(tools: ToolMCP[], handler: MockHandler): AgentContext {
  return {
    tools,
    llm: criarMockLLM({ "esp_licitacoes.enquadrar": handler }),
    logger: consoleLogger,
    sessionId: "s",
    tracingId: "t",
  };
}

const input: EspLicitacoesInput = {
  pergunta_focal: "Reequilíbrio do contrato 123: aumento de alíquota superveniente",
  resultado_pesquisa: {
    achados: [],
    citacoes_candidatas: [],
    tools_chamadas: [],
  } as unknown as ResultadoPesquisa,
};

/** Handler que devolve um parecer fixo, opcionalmente capturando o prompt. */
function handlerParecer(
  jurisprudencia: string[],
  promptSink?: { value: string },
): MockHandler {
  return (opts) => {
    if (promptSink) promptSink.value = opts.messages.map((m) => m.content).join("\n");
    return {
      enquadramento_lei_14133: "Aplica-se o art. 124, II, d da Lei 14.133/2021.",
      jurisprudencia_tcu_aplicavel: jurisprudencia,
      pontos_de_atencao: [],
    };
  };
}

describe("Esp.Licitações — jurisprudência fundamentada", () => {
  it("(a) descarta acórdão inventado, normaliza p/ label canônico e dedup", async () => {
    const capture: Array<Record<string, unknown>> = [];
    const promptSink = { value: "" };
    const esp = criarEspLicitacoes();
    const out = await esp.executar(
      input,
      ctx([toolAcordaos(ACORDAOS_REAIS, { capture })], handlerParecer(
        [
          "Acórdão 1.148/2022-Plenário — trata de reequilíbrio", // real (com separador)
          "Acórdão 9999/2099-Plenário — INVENTADO pelo LLM", // não existe → descartado
          "Acórdão 4072/2020-TCU-Plenário", // real
          "Acórdão 1148/2022-TCU-Plenário (de novo)", // duplicata → dedup
        ],
        promptSink,
      )),
    );

    expect(out.jurisprudencia_tcu_aplicavel).toEqual([
      "Acórdão 1148/2022-TCU-Plenário",
      "Acórdão 4072/2020-TCU-Plenário",
    ]);
    // A tool foi chamada com a pergunta focal.
    expect(capture).toHaveLength(1);
    expect(capture[0]!.query).toBe(input.pergunta_focal);
    // O bloco de grounding entrou no prompt.
    expect(promptSink.value).toContain("JURISPRUDÊNCIA DISPONÍVEL");
    expect(promptSink.value).toContain("Acórdão 1148/2022-TCU-Plenário");
  });

  it("(b) sem a tool no contexto → saída do LLM passa direto (legado), sem throw", async () => {
    const esp = criarEspLicitacoes();
    const out = await esp.executar(
      input,
      ctx([], handlerParecer(["Acórdão 1234/2020-Plenário"])),
    );
    // Sem grounding não há pós-filtro: mantém o que o LLM produziu.
    expect(out.jurisprudencia_tcu_aplicavel).toEqual(["Acórdão 1234/2020-Plenário"]);
  });

  it("(c) tool retorna vazio → sem grounding → legado", async () => {
    const esp = criarEspLicitacoes();
    const out = await esp.executar(
      input,
      ctx([toolAcordaos([])], handlerParecer(["Acórdão 7/2021-Plenário"])),
    );
    expect(out.jurisprudencia_tcu_aplicavel).toEqual(["Acórdão 7/2021-Plenário"]);
  });

  it("(d) tool lança → degrada gracioso (legado), sem derrubar a análise", async () => {
    const esp = criarEspLicitacoes();
    const out = await esp.executar(
      input,
      ctx([toolAcordaos([], { throws: true })], handlerParecer(["Acórdão 8/2021-Plenário"])),
    );
    expect(out.jurisprudencia_tcu_aplicavel).toEqual(["Acórdão 8/2021-Plenário"]);
  });
});
