/**
 * Testes E2E do PEVSEngine — fluxo completo Feature 1 e Feature 2,
 * com LLM client mockado e tools MCP mockadas.
 *
 * Cobre:
 *  - Feature 1 caminho feliz: PLAN→EXECUTE→ANALYZE→VERIFY produz
 *    análise APROVADA persistida no SessionAgent.
 *  - Feature 1 com retry: Auditor reprova na primeira passada, motor
 *    re-executa Pesquisador com feedback, aprova na segunda.
 *  - Feature 1 esgotando retries: 3 retries todos REJEITADOS → análise
 *    inconclusiva com ponto bloqueante.
 *  - Feature 2 caminho feliz: análise APROVADA → parecer formal I-V
 *    persistido.
 *  - Feature 2 recusa: análise inconclusiva → erro antes de chamar LLM.
 */
import { describe, expect, it } from "vitest";
import { PEVSEngine } from "../../src/agents/pevs-engine.js";
import { SessionAgent } from "../../src/agents/session-agent.js";
import { criarMockLLM } from "../../src/agents/llm/mock.js";
import { createTestEnv } from "../_fakes.js";
import { createInMemoryState } from "./_in-memory-state.js";
import type { ToolMCP, AgentLogger } from "../../src/agents/types.js";
import { calcularReequilibrioTool } from "../../src/mcp/tools/fiscal/index.js";
import type { Env } from "../../src/env.js";
import {
  PeticaoSchema,
  type Peticao,
  type CitacaoVerificada,
} from "@vectorgov-t/schemas";

/** Tool fiscal real (engine determinística) — não usa env. */
function toolFiscalMCP(): ToolMCP {
  return {
    nome: calcularReequilibrioTool.name,
    descricao: calcularReequilibrioTool.description,
    executar: async (args) =>
      calcularReequilibrioTool.handler(args, {} as Env),
  };
}

// UUIDs determinísticos por ordem de chamada
const UUIDS = [
  "550e8400-e29b-41d4-a716-446655440a01",
  "550e8400-e29b-41d4-a716-446655440a02",
  "550e8400-e29b-41d4-a716-446655440a03",
  "550e8400-e29b-41d4-a716-446655440a04",
  "550e8400-e29b-41d4-a716-446655440a05",
  "550e8400-e29b-41d4-a716-446655440a06",
  "550e8400-e29b-41d4-a716-446655440a07",
  "550e8400-e29b-41d4-a716-446655440a08",
  "550e8400-e29b-41d4-a716-446655440a09",
  "550e8400-e29b-41d4-a716-446655440a0a",
  "550e8400-e29b-41d4-a716-446655440a0b",
  "550e8400-e29b-41d4-a716-446655440a0c",
];
function uuidSequencial(): () => string {
  let i = 0;
  return () => UUIDS[i++] ?? UUIDS[UUIDS.length - 1]!;
}

const HASH_PLACEHOLDER = "a".repeat(64);
const TEXTO_OFICIAL_124 =
  "Os contratos regidos por esta Lei poderão ser alterados, com as devidas justificativas, nos seguintes casos: ...";

function novaPeticao(): Peticao {
  return PeticaoSchema.parse({
    id: UUIDS[0],
    requerente: "Dr. Joaquim",
    contratante: {
      razao_social: "Prefeitura X",
      cnpj: "11.111.111/0001-11",
      ente_federativo: "municipio",
    },
    contratado: {
      razao_social: "Construtora Y",
      cnpj: "22.222.222/0001-22",
      ente_federativo: "privada",
    },
    contrato: {
      numero: "010/2024",
      modalidade: "concorrencia",
      data_assinatura: "2024-01-10",
      data_inicio_vigencia: "2024-02-01",
      valor_centavos: 500_000_00,
      objeto: "Obra de manutenção viária",
    },
    fato_alegado:
      "Aumento extraordinário de preços de asfalto em mais de 40% entre dezembro/2024 e março/2025, comprovado por notas fiscais anexas.",
    base_legal_invocada: ["Art. 124 da Lei 14.133/2021"],
  });
}

/**
 * Tool fs_ler_dispositivo mock — devolve texto oficial controlado
 * pelo teste.
 */
function criarToolLer(mapa: Record<string, string | undefined>): ToolMCP {
  return {
    nome: "fs_ler_dispositivo",
    descricao: "Lê texto oficial",
    async executar(args) {
      const chave = `${args["norma"]}|${args["artigo"]}`;
      const v = mapa[chave];
      if (v === undefined) return { encontrado: false };
      return { encontrado: true, texto_oficial: v };
    },
  };
}

/**
 * Constrói o map de respostas do MockLLMClient com defaults razoáveis
 * para cada papel, permitindo overrides via parâmetro `overrides`.
 *
 * Cada handler é função para permitir contagem de chamadas (closure
 * com contador) — alguns testes precisam saber em qual retry estamos.
 */
function criarRespostasPadrao(opts: {
  citacaoPesquisador: CitacaoVerificada;
}) {
  const respostas: Record<string, (o: { messages: { content: string }[] }) => unknown> = {
    "orquestrador.plan": () => ({
      resumo_problema: "Reequilíbrio de contrato de obra viária",
      subtarefas: [
        { id: "s1", agente: "pesquisador", descricao: "buscar lei 14133 art 124", pode_paralelizar: true },
        { id: "s2", agente: "calculista", descricao: "calcular variação INCC", pode_paralelizar: true },
        { id: "s3", agente: "analista", descricao: "interpretar normas tributárias" },
        { id: "s4", agente: "esp_licitacoes", descricao: "enquadrar Lei 14.133" },
        { id: "s5", agente: "esp_reequilibrio", descricao: "integrar" },
        { id: "s6", agente: "auditor", descricao: "verificar citações" },
        { id: "s7", agente: "redator", descricao: "produzir parecer" },
      ],
      estrategia: "Pesquisar primeiro, depois interpretar e auditar",
    }),
    "pesquisador.coleta": () => ({
      achados: [
        {
          fonte: "Lei 14.133/2021 art. 124",
          trecho: TEXTO_OFICIAL_124,
          relevancia: 0.95,
        },
      ],
      citacoes_candidatas: [opts.citacaoPesquisador],
      tools_chamadas: ["busca_semantica", "fs_ler_dispositivo"],
    }),
    "analista.interpretar": () => ({
      interpretacao:
        "A elevação extraordinária de preços do asfalto, devidamente comprovada por notas fiscais e índices oficiais, caracteriza a álea econômica extraordinária do art. 124 da Lei 14.133/2021.",
      riscos_juridicos: ["Verificar tempestividade do pleito"],
      citacoes_aplicaveis: ["Art. 124 da Lei 14.133/2021"],
    }),
    "esp_licitacoes.enquadrar": () => ({
      enquadramento_lei_14133:
        "O caso enquadra-se no art. 124, caput, da Lei 14.133/2021, que prevê alteração contratual por iniciativa da Administração ou do contratado em casos de álea extraordinária.",
      jurisprudencia_tcu_aplicavel: ["Acórdão 1234/2023-Plenário"],
      pontos_de_atencao: ["Realizar contraditório formal"],
    }),
    // O Calculista agora extrai inputs estruturados; a tool fiscal real
    // (injetada em tools) faz a aritmética. Vigência fim em 2026 garante
    // cálculo bem-sucedido sem alíquotas de referência (regime piloto).
    "calculista.extrair_inputs": () => ({
      regime_tributario_pre: "lucro_real",
      aliquotas_pre: {
        pis_pct: 1.65,
        cofins_pct: 7.6,
        icms_pct: 0,
        iss_pct: 5,
        irpj_csll_pct: 0,
      },
      is_compra_governamental: true,
      ente_contratante: "municipio",
      vigencia_fim: "2026-12-31",
      aliquotas_referencia_publicadas: { cbs_pct: null, ibs_pct: null },
      redutor_compras_govern_pct: null,
      creditos_estimados_pct: 0,
      justificativa:
        "Lucro real (PIS 1,65% + Cofins 7,6%); serviço com ISS 5%; contrato municipal (compra governamental).",
    }),
    "esp_reequilibrio.integrar": () => ({
      sintese:
        "Integrando a análise tributária e o enquadramento na Lei 14.133, o caso apresenta fundamento para reequilíbrio econômico-financeiro, suportado pelos cálculos do Calculista que indicam variação real superior à álea ordinária.",
      veredito_preliminar: "procedente",
      pontos_a_complementar: [],
    }),
    "auditor.relatorio": () => ({
      citacoes_verificadas: [], // será sobrescrito pelo Auditor
      score_confianca: 0.9, // sugestão do LLM
      observacoes: "Citações verificadas determinisicamente",
      exige_retry: false, // sugestão (será sobrescrita)
    }),
    "redator.formatar": (o) => {
      // Extrai parecer_id e analise_id do prompt
      const msg = o.messages[o.messages.length - 1]!.content;
      const idMatch = /ID do parecer a gerar:\s*([0-9a-f-]{36})/i.exec(msg);
      const anaMatch = /ID da análise[^:]*:\s*([0-9a-f-]{36})/i.exec(msg);
      const tsMatch = /Timestamp ISO de geração:\s*(\S+)/i.exec(msg);
      const conteudo = "x".repeat(80);
      return {
        id: idMatch?.[1] ?? UUIDS[10],
        analise_id: anaMatch?.[1] ?? UUIDS[5],
        cabecalho: {
          numero: "PAR-2026-001",
          parecerista: "Agente IA Auditor + Redator",
          orgao: "Procuradoria Geral do Município de Exemplo",
          assunto: "Reequilíbrio Contrato 010/2024",
          data: "2026-05-26",
        },
        secoes: [
          { numero: "I", titulo: "Relatório", conteudo },
          { numero: "II", titulo: "Fundamentação", conteudo },
          { numero: "III", titulo: "Conclusão", conteudo },
          { numero: "IV", titulo: "Cálculos", conteudo },
          { numero: "V", titulo: "Recomendações", conteudo },
        ],
        conclusao_objetiva:
          "Pelo deferimento parcial do pleito de reequilíbrio, com base no art. 124 da Lei 14.133/2021.",
        recomendacoes: [],
        citacoes: [],
        calculos: [],
        gerado_em: tsMatch?.[1] ?? "2026-05-26T12:00:00.000Z",
      };
    },
  };
  return respostas;
}

/**
 * Logger silencioso — evita poluir output do test runner.
 */
const loggerSilencioso: AgentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("PEVSEngine — Feature 1 (análise)", () => {
  it("caminho feliz: produz análise procedente sem retry", async () => {
    const state = createInMemoryState();
    const sessionAgent = new SessionAgent(state, createTestEnv());
    const citacaoOk: CitacaoVerificada = {
      id: "cit-ok",
      tipo_fonte: "lei",
      norma: "Lei 14.133/2021",
      artigo: "art. 124",
      texto_literal: TEXTO_OFICIAL_124,
      hash: HASH_PLACEHOLDER,
      status: "PENDENTE",
    };
    const llm = criarMockLLM(criarRespostasPadrao({ citacaoPesquisador: citacaoOk }));
    const tool = criarToolLer({ "Lei 14.133/2021|art. 124": TEXTO_OFICIAL_124 });
    const engine = new PEVSEngine({
      llm,
      sessionAgent,
      tools: [tool, toolFiscalMCP()],
      logger: loggerSilencioso,
      gerarUuid: uuidSequencial(),
      now: () => new Date("2026-05-26T12:00:00.000Z"),
    });
    const { analise, retries_executados } = await engine.executarFeature1(
      novaPeticao(),
    );
    expect(retries_executados).toBe(0);
    expect(analise.veredito).toBe("procedente");
    expect(analise.citacoes).toHaveLength(1);
    expect(analise.citacoes[0]!.status).toBe("APROVADA");
    expect(analise.score_confianca).toBeGreaterThan(0.5);
    // Persistido
    const hist = await sessionAgent.listarHistorico();
    expect(hist).toHaveLength(1);
    expect(hist[0]!.veredito).toBe("procedente");
  });

  it("retry: Auditor reprova na 1ª passada, aprova na 2ª", async () => {
    const state = createInMemoryState();
    const sessionAgent = new SessionAgent(state, createTestEnv());

    // Pesquisador retorna texto INCORRETO na 1ª chamada, CORRETO da 2ª em diante
    let chamadasPesquisador = 0;
    const citacaoBad: CitacaoVerificada = {
      id: "cit-bad",
      tipo_fonte: "lei",
      norma: "Lei 14.133/2021",
      artigo: "art. 124",
      texto_literal: "TEXTO ERRADO inventado pelo agente",
      hash: HASH_PLACEHOLDER,
      status: "PENDENTE",
    };
    const citacaoOk: CitacaoVerificada = {
      ...citacaoBad,
      id: "cit-ok",
      texto_literal: TEXTO_OFICIAL_124,
    };
    const respostasBase = criarRespostasPadrao({ citacaoPesquisador: citacaoOk });
    respostasBase["pesquisador.coleta"] = () => {
      chamadasPesquisador++;
      return {
        achados: [
          {
            fonte: "Lei 14.133/2021 art. 124",
            trecho: TEXTO_OFICIAL_124,
            relevancia: 0.9,
          },
        ],
        citacoes_candidatas: [chamadasPesquisador === 1 ? citacaoBad : citacaoOk],
        tools_chamadas: ["busca_semantica"],
      };
    };
    const llm = criarMockLLM(respostasBase);
    const tool = criarToolLer({ "Lei 14.133/2021|art. 124": TEXTO_OFICIAL_124 });
    const engine = new PEVSEngine({
      llm,
      sessionAgent,
      tools: [tool, toolFiscalMCP()],
      logger: loggerSilencioso,
      gerarUuid: uuidSequencial(),
      now: () => new Date("2026-05-26T12:00:00.000Z"),
    });
    const { analise, retries_executados } = await engine.executarFeature1(
      novaPeticao(),
    );
    expect(retries_executados).toBe(1);
    expect(analise.veredito).toBe("procedente");
    expect(analise.citacoes[0]!.status).toBe("APROVADA");
    expect(chamadasPesquisador).toBe(2);
  });

  it("esgota retries: 3 retries todos REJEITADOS → veredito inconclusiva", async () => {
    const state = createInMemoryState();
    const sessionAgent = new SessionAgent(state, createTestEnv());
    const citacaoSempreBad: CitacaoVerificada = {
      id: "cit-bad",
      tipo_fonte: "lei",
      norma: "Lei 14.133/2021",
      artigo: "art. 124",
      texto_literal: "TEXTO QUE NUNCA BATE com filesystem",
      hash: HASH_PLACEHOLDER,
      status: "PENDENTE",
    };
    const llm = criarMockLLM(
      criarRespostasPadrao({ citacaoPesquisador: citacaoSempreBad }),
    );
    const tool = criarToolLer({ "Lei 14.133/2021|art. 124": TEXTO_OFICIAL_124 });
    const engine = new PEVSEngine({
      llm,
      sessionAgent,
      tools: [tool, toolFiscalMCP()],
      logger: loggerSilencioso,
      maxRetries: 3,
      gerarUuid: uuidSequencial(),
      now: () => new Date("2026-05-26T12:00:00.000Z"),
    });
    const { analise, retries_executados } = await engine.executarFeature1(
      novaPeticao(),
    );
    expect(retries_executados).toBe(4); // 1 inicial + 3 retries = 4 tentativas
    expect(analise.veredito).toBe("inconclusiva");
    expect(
      analise.pontos_a_complementar.some((p) => p.severidade === "bloqueante"),
    ).toBe(true);
    expect(analise.score_confianca).toBeLessThanOrEqual(0.5);
  });
});

describe("PEVSEngine — Feature 2 (parecer)", () => {
  it("caminho feliz: gera parecer a partir de análise APROVADA", async () => {
    const state = createInMemoryState();
    const sessionAgent = new SessionAgent(state, createTestEnv());
    // 1) primeiro executa Feature 1 para ter uma análise persistida
    const citacaoOk: CitacaoVerificada = {
      id: "cit-ok",
      tipo_fonte: "lei",
      norma: "Lei 14.133/2021",
      artigo: "art. 124",
      texto_literal: TEXTO_OFICIAL_124,
      hash: HASH_PLACEHOLDER,
      status: "PENDENTE",
    };
    const llm = criarMockLLM(criarRespostasPadrao({ citacaoPesquisador: citacaoOk }));
    const tool = criarToolLer({ "Lei 14.133/2021|art. 124": TEXTO_OFICIAL_124 });
    const engine = new PEVSEngine({
      llm,
      sessionAgent,
      tools: [tool, toolFiscalMCP()],
      logger: loggerSilencioso,
      gerarUuid: uuidSequencial(),
      now: () => new Date("2026-05-26T12:00:00.000Z"),
    });
    const { analise } = await engine.executarFeature1(novaPeticao());

    // 2) agora Feature 2
    const { parecer } = await engine.executarFeature2(analise, {
      tipo_documento: "parecer_formal",
      cabecalho_meta: {
        numero: "PAR-2026-001",
        parecerista: "Agente IA",
        orgao: "PGM",
        assunto: "Reequilíbrio",
        data: "2026-05-26",
      },
    });
    expect(parecer.secoes).toHaveLength(5);
    expect(parecer.secoes[0]!.numero).toBe("I");
    expect(parecer.secoes[4]!.numero).toBe("V");
    expect(parecer.analise_id).toBe(analise.id);
    // Persistido
    const persisted = await sessionAgent.carregarParecer(parecer.id);
    expect(persisted).not.toBeNull();
  });

  it("recusa análise inconclusiva antes de chamar LLM", async () => {
    const state = createInMemoryState();
    const sessionAgent = new SessionAgent(state, createTestEnv());
    const llm = criarMockLLM({}); // sem nenhuma resposta — qualquer chamada lança
    const engine = new PEVSEngine({
      llm,
      sessionAgent,
      tools: [],
      logger: loggerSilencioso,
      gerarUuid: uuidSequencial(),
    });
    // Construo manualmente uma análise inconclusiva (sem passar pela
    // pipeline) para isolar o teste do Feature 2.
    const analiseInc = await (async () => {
      const { AnaliseReequilibrioSchema } = await import(
        "@vectorgov-t/schemas"
      );
      return AnaliseReequilibrioSchema.parse({
        id: UUIDS[0],
        peticao_id: UUIDS[1],
        veredito: "inconclusiva",
        fundamentacao: "z".repeat(250),
        citacoes: [],
        calculos: [],
        score_confianca: 0.3,
        pontos_a_complementar: [
          {
            descricao: "Faltam fontes oficiais",
            severidade: "bloqueante",
            responsavel: "requerente",
          },
        ],
        gerado_em: "2026-05-26T12:00:00.000Z",
      });
    })();
    await expect(
      engine.executarFeature2(analiseInc, {
        tipo_documento: "parecer_formal",
        cabecalho_meta: {
          numero: "X",
          parecerista: "Y",
          orgao: "Z",
          assunto: "A",
          data: "2026-05-26",
        },
      }),
    ).rejects.toThrow(/inconclusiva/);
  });
});
