/**
 * Endpoints REST para o ciclo de vida de uma petição.
 *
 * São endpoints user-friendly que a UI Web consome. Internamente eles
 * orquestram o motor PEVS (que ainda não está plugado em produção neste
 * worker) — por enquanto, as funções devolvem mocks marcados com TODO
 * para integração real na próxima sprint.
 *
 * Rotas cobertas:
 *  - `POST /api/peticoes/upload`            (multipart: pdf + metadata JSON)
 *  - `GET  /api/peticoes/:id`               (status + análise completa quando done)
 *  - `POST /api/peticoes/:id/parecer`       (dispara geração de parecer)
 *  - `GET  /api/peticoes/:id/parecer`       (lê parecer já gerado)
 *
 * Persistência atual: KV (`CACHE`) com chave `peticao:<id>` (24h TTL).
 * Quando o backend tiver D1 com tabela `peticoes`, migrar para SQL.
 */
import type { Env } from "../env.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { validatePeticaoId } from "./validation.js";
import { type DecisaoFeature2 } from "../agents/pevs-engine.js";
import { criarEnginePEVS } from "../agents/run-analise.js";
import { getSessionAgentClient } from "../agents/session-loader.js";

/**
 * Gera UUID v4. Usa `crypto.randomUUID()` que existe nativo em Workers.
 * (Usado apenas pelos mocks do golden-set — ver `gerarAnaliseMock`.)
 */
function newPeticaoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // fallback determinístico (apenas para ambientes sem crypto.randomUUID)
  return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
}

/**
 * Mock de análise completa — devolve algo que valida contra `AnaliseReequilibrioSchema`.
 * Mantido só para o golden-set de testes (`__internal`), atrás do flag
 * `ENABLE_GOLDEN_SET_MOCKS`. NÃO é usado no fluxo real (chat → PEVS → DO).
 */
function contratoNumero(metadata: Record<string, unknown>): string {
  const raw = metadata.contrato_numero ?? metadata.contrato ?? "";
  return String(raw).trim();
}

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function citacaoMock(
  id: string,
  tipoFonte:
    | "lei"
    | "lei_complementar"
    | "constituicao"
    | "acordao_tcu"
    | "outro",
  norma: string,
  artigo: string,
  textoLiteral: string,
  hashSeed: string,
): Record<string, unknown> {
  return {
    id,
    tipo_fonte: tipoFonte,
    norma,
    artigo,
    texto_literal: textoLiteral,
    hash: hashSeed.repeat(64).slice(0, 64),
    status: "APROVADA",
    fonte_url:
      tipoFonte === "lei" || tipoFonte === "lei_complementar"
        ? "https://www.planalto.gov.br/"
        : null,
  };
}

function citacoesBase(): Record<string, unknown>[] {
  return [
    citacaoMock(
      "cit-001",
      "lei",
      "Lei nº 14.133/2021",
      "art. 124, II, d",
      "Art. 124, II, d, admite alteração contratual para restabelecer o equilíbrio econômico-financeiro inicial em hipóteses extraordinárias.",
      "a1",
    ),
  ];
}

function calculoReequilibrio(
  id: string,
  descricao: string,
  valorFinal: number,
): Record<string, unknown> {
  return {
    id,
    tipo: "reequilibrio_economico",
    descricao,
    inputs: {
      valor_pleiteado: valorFinal,
      percentual_reconhecido: 1,
    },
    memoria: [
      {
        descricao: "Valor base considerado a partir da documentação do pedido",
        valor: valorFinal,
        unidade: "BRL",
      },
      {
        descricao: "Percentual juridicamente reconhecido após análise do fato superveniente",
        valor: 1,
        unidade: "fator",
        formula: "valor_base * percentual_reconhecido",
      },
    ],
    valor_final: valorFinal,
    unidade_final: "BRL",
    sucesso: true,
    placeholder: true,
  };
}

function pontoBloqueante(descricao: string): Record<string, unknown> {
  return {
    descricao,
    severidade: "bloqueante",
    responsavel: "requerente",
  };
}

function analiseMockPorContrato(
  contrato: string,
): {
  veredito:
    | "procedente"
    | "parcialmente_procedente"
    | "improcedente"
    | "inconclusiva";
  fundamentacao: string;
  citacoes: Record<string, unknown>[];
  calculos: Record<string, unknown>[];
  score_confianca: number;
  pontos_a_complementar: Record<string, unknown>[];
} | null {
  switch (contrato) {
    case "012/2024":
      return {
        veredito: "procedente",
        fundamentacao:
          "O pedido do Contrato 012/2024 deve ser reconhecido como procedente porque descreve mudança normativa tributária superveniente, com documentação mínima de memória de cálculo, notas fiscais comparativas e cronograma físico-financeiro. A alteração do regime IBS/CBS, associada à EC 132/2023 e à Lei Complementar 214/2025, configura fato do príncipe com impacto direto sobre prestações futuras ainda não executadas. A recomposição deve se limitar ao saldo contratual afetado, preservando a equação econômico-financeira original sem remunerar parcelas já executadas antes da vigência do novo regime.",
        citacoes: [
          ...citacoesBase(),
          citacaoMock(
            "cit-002",
            "lei_complementar",
            "Lei Complementar 214/2025",
            "Disposições gerais IBS/CBS",
            "A Lei Complementar 214/2025 disciplina aspectos gerais do IBS e da CBS no regime tributário pós-reforma.",
            "b2",
          ),
          citacaoMock(
            "cit-003",
            "constituicao",
            "Constituição Federal",
            "art. 195, V (EC 132/2023)",
            "A Constituição Federal, com redação da EC 132/2023, prevê contribuição sobre bens e serviços no art. 195, V.",
            "c3",
          ),
        ],
        calculos: [
          calculoReequilibrio(
            "calc-001",
            "Cálculo placeholder do delta tributário IBS/CBS aplicável apenas ao saldo futuro do contrato.",
            125000,
          ),
        ],
        score_confianca: 0.88,
        pontos_a_complementar: [],
      };
    case "045/2023":
      return {
        veredito: "improcedente",
        fundamentacao:
          "O pedido do Contrato 045/2023 deve ser indeferido. A narrativa descreve aumento ordinário de combustíveis, salários e manutenção, riscos normais da atividade econômica que não bastam para caracterizar álea extraordinária ou fato imprevisível. Também há fragilidade formal relevante: a petição invoca regime revogado da Lei 8.666/1993, não apresenta memória de cálculo auditável nem anexos mínimos que demonstrem nexo causal específico entre evento superveniente e desequilíbrio. A Lei nº 14.133/2021 permite recomposição em hipóteses excepcionais, mas não transforma variação comum de mercado em reequilíbrio automático.",
        citacoes: citacoesBase(),
        calculos: [],
        score_confianca: 0.78,
        pontos_a_complementar: [
          {
            descricao:
              "Pedido sem memória de cálculo ou anexos suficientes; a deficiência reforça o indeferimento no mérito apresentado.",
            severidade: "alta",
            responsavel: "requerente",
          },
        ],
      };
    case "007/2024":
      return {
        veredito: "inconclusiva",
        fundamentacao:
          "A análise do Contrato 007/2024 é inconclusiva porque a petição apresenta fundamento legal plausível, mas não traz valor pleiteado, memória de cálculo, comprovação da variação cambial nem demonstração do impacto financeiro sobre itens contratuais específicos. Sem esses elementos, não há base técnica para deferir, indeferir ou quantificar o pedido. O encaminhamento juridicamente adequado é intimar o contratado para complementar a instrução, com indicação objetiva dos documentos faltantes e prazo definido, preservando posterior análise de mérito quando houver documentação verificável.",
        citacoes: citacoesBase(),
        calculos: [],
        score_confianca: 0.42,
        pontos_a_complementar: [
          pontoBloqueante(
            "Apresentar memória de cálculo, valor pleiteado e comprovantes da variação cambial com impacto direto nos custos do contrato.",
          ),
        ],
      };
    case "089/2024":
      return {
        veredito: "parcialmente_procedente",
        fundamentacao:
          "O pedido do Contrato 089/2024 é parcialmente procedente. A petição demonstra fato superveniente relacionado ao aumento de insumos especializados e apresenta anexos mínimos, o que permite reconhecer a tese de recomposição em abstrato. Contudo, a metodologia do contratado é inconsistente: usa índice geral IPCA para custos setoriais de insumos e ainda contém divergência interna entre o total de R$ 18.000,00 e o valor pleiteado de R$ 87.450,00. O deferimento deve ficar condicionado a recálculo técnico com índice setorial aderente, memória coerente e limitação ao impacto efetivamente comprovado.",
        citacoes: citacoesBase(),
        calculos: [
          calculoReequilibrio(
            "calc-001",
            "Recálculo placeholder com glosa metodológica do índice geral usado pelo contratado.",
            18000,
          ),
        ],
        score_confianca: 0.72,
        pontos_a_complementar: [
          {
            descricao:
              "Substituir o índice geral por índice setorial e reconciliar a divergência entre os totais informados.",
            severidade: "media",
            responsavel: "requerente",
          },
        ],
      };
    case "156/2025":
      return {
        veredito: "inconclusiva",
        fundamentacao:
          "A análise do Contrato 156/2025 deve permanecer inconclusiva. Há elementos favoráveis ao contratado, pois a orientação técnica da ANPD pode ter introduzido requisitos operacionais não previstos originalmente; ao mesmo tempo, há elementos contrários, pois a LGPD já existia antes da assinatura e orientações infralegais podem integrar risco regulatório ordinário do fornecedor. Como não há consenso jurídico suficiente, e a decisão depende de enquadramento institucional sobre o peso normativo da orientação técnica, o caso deve ser submetido à Procuradoria ou autoridade competente, sem inventar precedente ou jurisprudência para encerrar a controvérsia.",
        citacoes: citacoesBase(),
        calculos: [],
        score_confianca: 0.56,
        pontos_a_complementar: [
          pontoBloqueante(
            "Submeter a controvérsia jurídica sobre orientação infralegal da ANPD à decisão humana qualificada ou à Procuradoria.",
          ),
        ],
      };
    default:
      return null;
  }
}

function gerarAnaliseMock(
  peticaoId: string,
  metadata: Record<string, unknown>,
  env?: Pick<Env, "ENABLE_GOLDEN_SET_MOCKS">,
): unknown {
  const agora = new Date().toISOString();
  const goldenSetAnalise = envFlagEnabled(env?.ENABLE_GOLDEN_SET_MOCKS)
    ? analiseMockPorContrato(contratoNumero(metadata))
    : null;
  if (goldenSetAnalise !== null) {
    return {
      id: newPeticaoId(),
      peticao_id: peticaoId,
      ...goldenSetAnalise,
      gerado_em: agora,
      modelo_auditor: "gemini-3-pro",
      metadata_origem: metadata,
    };
  }

  return {
    id: newPeticaoId(),
    peticao_id: peticaoId,
    veredito: "parcialmente_procedente",
    fundamentacao:
      "A petição apresenta requisitos formais do art. 124 da Lei nº 14.133/2021 para reequilíbrio econômico-financeiro. " +
      "Verificada a ocorrência de fato superveniente extraordinário (variação atípica do INCC acima de 12% no período), " +
      "constata-se nexo de causalidade com o desequilíbrio alegado. Contudo, o cálculo apresentado pelo contratado utiliza " +
      "índice inadequado (IPCA em vez de INCC), o que justifica o deferimento parcial com ajuste metodológico. Recomenda-se " +
      "termo aditivo limitado ao impacto líquido demonstrado no demonstrativo IV.",
    citacoes: [
      {
        id: "cit-001",
        tipo_fonte: "lei",
        norma: "Lei nº 14.133/2021",
        artigo: "art. 124, II, d",
        texto_literal:
          "Art. 124. Os contratos regidos por esta Lei poderão ser alterados, com as devidas justificativas, nos seguintes casos: " +
          "[...] II - por acordo entre as partes: [...] d) para restabelecer o equilíbrio econômico-financeiro inicial do contrato, " +
          "em caso de força maior, caso fortuito ou fato do príncipe ou em decorrência de fatos imprevisíveis, ou previsíveis de " +
          "consequências incalculáveis, retardadores ou impeditivos da execução do ajustado, ou ainda em caso de álea econômica " +
          "extraordinária e extracontratual.",
        hash:
          "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        status: "APROVADA",
        fonte_url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/L14133.htm",
      },
      {
        id: "cit-002",
        tipo_fonte: "acordao_tcu",
        norma: "Acórdão TCU 1.595/2018-Plenário",
        artigo: "Item 9.3.1",
        texto_literal:
          "É indispensável a comprovação do nexo de causalidade entre o fato superveniente e o desequilíbrio, " +
          "vedada a recomposição genérica de margem de lucro.",
        hash:
          "f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
        status: "APROVADA",
        fonte_url: null,
      },
    ],
    calculos: [
      {
        id: "calc-001",
        tipo: "reequilibrio_economico",
        descricao:
          "Recálculo do desequilíbrio com índice setorial (INCC) em substituição ao IPCA apresentado.",
        inputs: {
          custo_unitario_original: 1234.56,
          variacao_incc_acumulada: 0.0875,
          quantidade_meses_restantes: 18,
        },
        memoria: [
          {
            descricao: "Custo unitário base (referência da proposta vencedora)",
            valor: 1234.56,
            unidade: "BRL",
          },
          {
            descricao: "× variação acumulada INCC no período",
            valor: 1.0875,
            unidade: "fator",
            formula: "1 + 0,0875",
          },
          {
            descricao: "= Custo unitário reequilibrado",
            valor: 1342.57,
            unidade: "BRL",
          },
          {
            descricao: "Diferença unitária mensal",
            valor: 108.01,
            unidade: "BRL",
          },
          {
            descricao: "× meses restantes (18)",
            valor: 1944.18,
            unidade: "BRL",
          },
        ],
        valor_final: 1944.18,
        unidade_final: "BRL",
        sucesso: true,
        placeholder: true,
      },
    ],
    score_confianca: 0.82,
    pontos_a_complementar: [
      {
        descricao:
          "Anexar nota fiscal de aquisição dos insumos para validar o impacto unitário.",
        severidade: "media",
        responsavel: "requerente",
      },
    ],
    gerado_em: agora,
    modelo_auditor: "gemini-3-pro",
    metadata_origem: metadata,
  };
}

/**
 * Mock de parecer formal — devolve algo que valida contra `ParecerSchema`.
 */
function gerarParecerMock(analiseId: string): unknown {
  const agora = new Date().toISOString();
  const id = newPeticaoId();
  return {
    id,
    analise_id: analiseId,
    cabecalho: {
      numero: `PARECER-${id.slice(0, 8).toUpperCase()}/2026`,
      parecerista: "Agente IA Auditor + Redator (Vectorgov_t)",
      orgao: "Procuradoria Jurídica",
      assunto: "Pedido de reequilíbrio econômico-financeiro — contrato administrativo",
      data: agora.slice(0, 10),
    },
    secoes: [
      {
        numero: "I",
        titulo: "Relatório",
        conteudo:
          "Trata-se de pedido de reequilíbrio econômico-financeiro formulado pelo contratado, " +
          "fundamentado em alegação de fato superveniente caracterizado por variação atípica de " +
          "insumos da construção civil. A petição foi protocolizada acompanhada de planilha de " +
          "cálculo e nota técnica do engenheiro responsável.",
      },
      {
        numero: "II",
        titulo: "Fundamentação",
        conteudo:
          "O art. 124, II, alínea 'd', da Lei nº 14.133/2021 admite a alteração contratual por acordo " +
          "para restabelecer o equilíbrio econômico-financeiro em caso de fatos imprevisíveis ou de " +
          "consequências incalculáveis. No caso concreto, restou demonstrado o nexo de causalidade entre " +
          "a variação atípica do INCC e o impacto direto nos insumos, conforme exigido pelo Acórdão TCU " +
          "1.595/2018-Plenário. Contudo, observa-se que o cálculo apresentado pelo requerente utilizou " +
          "o IPCA (índice geral), enquanto o adequado é o índice setorial INCC, gerando distorção a maior.",
      },
      {
        numero: "III",
        titulo: "Conclusão",
        conteudo:
          "Pelo deferimento parcial do pleito, no valor de R$ 1.944,18 (mil novecentos e quarenta e quatro " +
          "reais e dezoito centavos), com fundamento no art. 124, II, 'd', da Lei 14.133/2021, condicionado " +
          "à apresentação de notas fiscais comprobatórias dos insumos no prazo de 15 dias.",
      },
      {
        numero: "IV",
        titulo: "Cálculos e Demonstrativos",
        conteudo:
          "Demonstrativo de recálculo com substituição do índice IPCA pelo INCC, conforme tabela anexa. " +
          "Custo unitário reequilibrado: R$ 1.342,57. Diferença unitária mensal: R$ 108,01. Meses restantes " +
          "de execução: 18. Valor total do reequilíbrio: R$ 1.944,18.",
      },
      {
        numero: "V",
        titulo: "Recomendações",
        conteudo:
          "(1) Lavrar termo aditivo limitado ao valor deferido. (2) Exigir do contratado a apresentação " +
          "de notas fiscais no prazo de 15 dias úteis. (3) Comunicar à área de controle interno para fins " +
          "de transparência ativa. (4) Atualizar a planilha de cronograma físico-financeiro do contrato.",
      },
    ],
    conclusao_objetiva:
      "Pelo deferimento parcial do pleito, no valor de R$ 1.944,18, com fundamento no art. 124, II, 'd', da Lei 14.133/2021.",
    recomendacoes: [
      {
        descricao: "Lavrar termo aditivo limitado ao valor deferido (R$ 1.944,18).",
        prioridade: "alta",
        prazo_dias: 10,
      },
      {
        descricao: "Exigir notas fiscais comprobatórias dos insumos.",
        prioridade: "alta",
        prazo_dias: 15,
      },
      {
        descricao: "Comunicar área de controle interno.",
        prioridade: "media",
        prazo_dias: 30,
      },
    ],
    citacoes: [
      {
        id: "cit-001",
        tipo_fonte: "lei",
        norma: "Lei nº 14.133/2021",
        artigo: "art. 124, II, d",
        texto_literal:
          "Art. 124. Os contratos regidos por esta Lei poderão ser alterados [...] " +
          "d) para restabelecer o equilíbrio econômico-financeiro inicial do contrato [...]",
        hash:
          "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        status: "APROVADA",
        fonte_url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/L14133.htm",
      },
    ],
    calculos: [],
    gerado_em: agora,
  };
}

/**
 * Handler de `GET /api/peticoes/:id` — `id` é o `analise_id` (chave durável
 * no SessionAgent). A análise persistida já está concluída (o chat roda
 * síncrono), então devolvemos sempre `fase: "done"`.
 */
export async function handlePeticaoStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const rawId = url.pathname.split("/").filter(Boolean).pop();
  // Validação Zod (follow-up P0 #53) — bloqueia path traversal e caracteres inválidos
  const idCheck = validatePeticaoId(rawId);
  if (!idCheck.ok) return idCheck.response;
  const id = idCheck.data;

  const sessionAgent = getSessionAgentClient(env);
  const res = await sessionAgent.carregarAnalise(id);
  if (!res) {
    return errorResponse("Petição não encontrada", 404);
  }
  const ts = res.analise.gerado_em;
  return jsonResponse({
    id,
    fase: "done",
    progresso_pct: 100,
    iniciado_em: ts,
    atualizado_em: ts,
    analise: res.analise,
  });
}

/**
 * Handler de `POST /api/peticoes/:id/parecer` — gera o parecer formal
 * (Feature 2) a partir da análise persistida (`analise_id`). O
 * `executarFeature2` do engine já persiste o parecer no SessionAgent.
 */
export async function handleGerarParecer(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  // Esperado: ["api", "peticoes", ":id", "parecer"]
  const rawId = parts[parts.length - 2];
  const idCheck = validatePeticaoId(rawId);
  if (!idCheck.ok) return idCheck.response;
  const id = idCheck.data;

  // Gemini agora vai pelo AI Gateway (BYOK). O usuário não envia chave — o
  // gating é "gateway configurado?" via `env.CF_AIG_TOKEN`.
  const apiKey = env.CF_AIG_TOKEN ?? null;
  if (!apiKey) {
    return errorResponse(
      "AI Gateway não configurado (CF_AIG_TOKEN ausente no Worker).",
      503,
    );
  }

  const sessionAgent = getSessionAgentClient(env);
  const res = await sessionAgent.carregarAnalise(id);
  if (!res) {
    return errorResponse("Análise não encontrada", 404);
  }
  const { peticao, analise } = res;
  if (analise.veredito === "inconclusiva") {
    return errorResponse(
      "Não é possível gerar parecer formal a partir de análise inconclusiva. Complemente os pontos pendentes primeiro.",
      409,
    );
  }

  // Body opcional: tipo_documento + cabecalho_meta. Defaults razoáveis.
  let body: Partial<DecisaoFeature2> = {};
  try {
    const raw = await request.text();
    if (raw.length > 0) {
      body = JSON.parse(raw) as Partial<DecisaoFeature2>;
    }
  } catch {
    // body vazio é aceitável (usa defaults)
  }

  const decisao: DecisaoFeature2 = {
    tipo_documento: body.tipo_documento ?? "parecer_formal",
    cabecalho_meta: body.cabecalho_meta ?? {
      numero: `PARECER-${id.slice(0, 8)}`,
      parecerista: "vectorgov-t",
      orgao: "(órgão não informado)",
      assunto: `Reequilíbrio econômico-financeiro — contrato ${peticao.contrato.numero}`,
      data: new Date().toISOString().slice(0, 10),
    },
  };

  try {
    const engine = await criarEnginePEVS(env, apiKey);
    // executarFeature2 persiste o parecer no SessionAgent (DO).
    const { parecer } = await engine.executarFeature2(analise, decisao);
    return jsonResponse(parecer, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Falha ao gerar parecer: ${msg}`, 500);
  }
}

/**
 * Handler de `GET /api/peticoes/:id/parecer` — busca o parecer pela análise.
 */
export async function handleGetParecer(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const rawId = parts[parts.length - 2];
  const idCheck = validatePeticaoId(rawId);
  if (!idCheck.ok) return idCheck.response;
  const id = idCheck.data;

  const sessionAgent = getSessionAgentClient(env);
  const parecer = await sessionAgent.carregarParecerPorAnalise(id);
  if (!parecer) {
    return errorResponse("Parecer ainda não gerado", 404);
  }
  return jsonResponse(parecer);
}

export const __internal = { gerarAnaliseMock };
