/**
 * ConversationalEngine — orquestra o chat livre tipo NotebookLM.
 *
 * Loop:
 *   user_message -> streamText do Gemini 3.5 Flash com tools -> stream de
 *   eventos via callback. Tools expostas:
 *     • 12 tools MCP read-only (semantic search, fs_*, skill_* sem publish).
 *     • 2 tools de agentes especialistas (Pesquisador, Calculista).
 *     • 2 tools do notebook (buscar_no_documento, ler_documento_inteiro).
 *
 * O engine NÃO conhece WebSocket — quem chama (handler do DO) recebe
 * eventos via callback `onEvent` e despacha pelo transporte que quiser.
 *
 * Persistência: cada user_message + assistant message são gravadas no
 * NotebookAgent pelo caller — o engine apenas devolve o conteúdo final
 * + lista de tool calls feitos no caminho.
 */
import type { Env } from "../../env.js";
import type { Mensagem, ToolCall, ChatEvent } from "@vectorgov-t/schemas";
import type {
  LLMClient,
  MensagemLLM,
  StreamEvent,
  ToolForLLM,
} from "../llm/index.js";
import { consoleLogger } from "../types.js";
import { buildToolsForPEVS } from "../tools-adapter.js";
import { extrairPeticaoDeTexto } from "./peticao-extractor.js";
import { rodarAnalisePeticao, criarEnginePEVS } from "../run-analise.js";
import { getSessionAgentClient } from "../session-loader.js";
import { toolsDeTransicaoPermitidas, montarBlocoEstado } from "./fsm.js";
import type { DecisaoFeature2 } from "../pevs-engine.js";
import {
  PeticaoSchema,
  OferecerOpcoesInputSchema,
  GerarParecerInputSchema,
  type PeticaoRascunho,
  type EstadoConversa,
} from "@vectorgov-t/schemas";
import type { NotebookAgent } from "../notebook-agent.js";
import { MCP_TOOLS, type ToolDescriptor } from "../../mcp/tools/index.js";
import {
  findTool as findSkillTool,
  invokeTool as invokeSkillTool,
  listToolDescriptors as listSkillToolDescriptors,
} from "../../mcp/tools/registry.js";
import { criarPesquisador } from "../roles/pesquisador.js";
import { criarCalculista } from "../roles/calculista.js";
import { z } from "zod";

/**
 * Saída final do `conversar()` — usada pelo caller pra registrar a
 * mensagem do assistant no DO.
 */
export interface ResultadoConversa {
  message_id: string;
  texto: string;
  tool_calls: ToolCall[];
  tokens: number;
  modelo: string;
  finish_reason: string;
}

const CHAT_LEI_TOOL_NAMES = new Set([
  "buscar_legislacao",
  "consultar_artigo",
  "listar_artigos_por_tema",
  "comparar_redacoes",
  "fs_listar_normas",
  "fs_listar_estrutura",
  "fs_grep",
  "fs_ler_dispositivo",
  "fs_ler_intervalo",
]);

const CHAT_SKILL_TOOL_NAMES = new Set([
  "skill_listar",
  "skill_carregar",
  "skill_identificar_relevantes",
]);

/**
 * Converte uma tool MCP de leis/filesystem em ToolForLLM.
 */
function mcpLeiToolToLlmTool(env: Env, def: ToolDescriptor): ToolForLLM {
  return {
    description: def.description,
    inputSchema: def.inputSchema,
    execute: async (input) => {
      return await def.handler(input, env);
    },
  };
}

/**
 * Converte uma tool MCP de skills em ToolForLLM.
 */
function mcpSkillToolToLlmTool(
  env: Env,
  name: string,
  description: string,
): ToolForLLM {
  const def = findSkillTool(name);
  if (!def) {
    throw new Error(
      `mcpSkillToolToLlmTool: tool '${name}' não encontrada no registry`,
    );
  }
  return {
    description,
    inputSchema: def.zodSchema,
    execute: async (input) => {
      return await invokeSkillTool(env, name, input);
    },
  };
}

/**
 * Constrói o map de tools que será passado pro streamText.
 */
// Exportada para teste (verificação das tools do chat em isolamento).
export function buildTools(
  env: Env,
  llm: LLMClient,
  notebook: NotebookAgent,
  apiKey: string | null = null,
  estado: EstadoConversa = "PETICAO_EXTRAIDA",
): Record<string, ToolForLLM> {
  const tools: Record<string, ToolForLLM> = {};
  // Gating do trilho: quais tools de transição podem aparecer nesta fase.
  const transicaoOk = new Set(toolsDeTransicaoPermitidas(estado));

  // 1. Tools MCP read-only. Não expomos `skill_publicar` no chat porque
  // prompt de usuário não deve conseguir gravar em R2/alterar skills ativas.
  for (const d of MCP_TOOLS) {
    if (CHAT_LEI_TOOL_NAMES.has(d.name)) {
      tools[d.name] = mcpLeiToolToLlmTool(env, d);
    }
  }
  for (const d of listSkillToolDescriptors()) {
    if (CHAT_SKILL_TOOL_NAMES.has(d.name)) {
      tools[d.name] = mcpSkillToolToLlmTool(env, d.name, d.description);
    }
  }

  // 2. Tool do Pesquisador (agente especialista).
  tools["consultar_pesquisador"] = {
    description:
      "Consulta o agente Pesquisador para coletar trechos relevantes da " +
      "base normativa (Lei 14.133, EC 132/2023, LC 214/2025 e decretos). " +
      "Use quando o usuário pergunta sobre normas, artigos, ou jurisprudência. " +
      "O Pesquisador devolve achados com fonte exata e texto literal.",
    inputSchema: z.object({
      pergunta_focal: z
        .string()
        .min(5)
        .max(500)
        .describe("Pergunta objetiva, ex.: 'Artigos sobre reajuste contratual'"),
      contexto: z
        .string()
        .max(2000)
        .optional()
        .describe("Trechos do documento do usuário que contextualizam"),
    }),
    execute: async (input) => {
      const i = input as { pergunta_focal: string; contexto?: string };
      const pesquisador = criarPesquisador();
      const result = await pesquisador.executar(
        {
          pergunta_focal: i.pergunta_focal,
          contexto_peticao: i.contexto ?? "(sem contexto específico)",
        },
        {
          tools: [],
          llm,
          logger: consoleLogger,
          sessionId: notebook["state"]?.id?.toString?.() ?? "notebook",
          tracingId: `chat-${Date.now()}`,
        },
      );
      return result;
    },
  };

  // 3. Tool do Calculista.
  tools["calcular_reequilibrio"] = {
    description:
      "Consulta o agente Calculista para estimar valores de reequilíbrio " +
      "econômico-financeiro. Aceita descrição livre + dados estruturados. " +
      "Use quando o usuário pede números, percentuais ou planilha de cálculo.",
    inputSchema: z.object({
      descricao_pedido: z
        .string()
        .min(10)
        .max(1000)
        .describe("Descrição do que calcular"),
      contexto: z
        .string()
        .max(2000)
        .optional()
        .describe("Dados/contexto adicional do documento"),
    }),
    execute: async (input) => {
      const i = input as { descricao_pedido: string; contexto?: string };
      const calculista = criarCalculista();
      // Petição mínima sintética para o chat livre: o Calculista extrai os
      // inputs do fato_alegado/contexto e invoca a tool determinística real.
      // valor_centavos default 0 — o usuário deve informar o valor no pedido
      // para o cálculo render números (senão o reequilíbrio sai zerado).
      const peticaoSintetica = {
        id: "00000000-0000-4000-8000-000000000000",
        requerente: "(chat livre)",
        contratante: {
          razao_social: "(não informado em chat livre)",
          cnpj: "",
        },
        contratado: {
          razao_social: "(não informado em chat livre)",
          cnpj: "",
        },
        contrato: {
          numero: "(chat)",
          modalidade: "pregao_eletronico",
          objeto: i.contexto ?? "(chat livre)",
          valor_centavos: 0,
          data_assinatura: "2024-01-01",
          data_inicio_vigencia: "2024-01-01",
        },
        fato_alegado: i.descricao_pedido,
        base_legal_invocada: [],
        calculos_apresentados: [],
        anexos_urls: [],
      };
      const result = await calculista.executar(
        {
          peticao: peticaoSintetica as never,
          contexto_pedido: i.contexto ?? i.descricao_pedido,
        },
        {
          // Injeta o catálogo real (inclui calcular_reequilibrio_tributario)
          // para o Calculista executar a engine determinística — sem isso
          // ele cairia em fallback placeholder.
          tools: buildToolsForPEVS(env),
          llm,
          logger: consoleLogger,
          sessionId: notebook["state"]?.id?.toString?.() ?? "notebook",
          tracingId: `chat-${Date.now()}`,
        },
      );
      return result;
    },
  };

  // 4. Tools específicas do notebook.
  tools["buscar_no_documento"] = {
    description:
      "Busca semântica nos chunks do documento anexado ao notebook. Use " +
      "quando precisar de trechos específicos do documento que o usuário " +
      "enviou (não da base normativa). Retorna top_k chunks rankeados.",
    inputSchema: z.object({
      query: z.string().min(2).max(500),
      top_k: z.number().int().min(1).max(10).optional().default(5),
    }),
    execute: async (input) => {
      const i = input as { query: string; top_k?: number };
      const results = await notebook.buscarChunks(i.query, i.top_k ?? 5);
      return { chunks: results };
    },
  };

  tools["ler_documento_inteiro"] = {
    description:
      "Lê todas as páginas do documento anexado ao notebook concatenadas. " +
      "Trunca em 100k chars. Use quando o documento é curto OU precisa de " +
      "visão geral.",
    inputSchema: z.object({
      max_chars: z.number().int().min(1000).max(200_000).optional(),
    }),
    execute: async (input) => {
      const i = input as { max_chars?: number };
      const texto = await notebook.lerDocumentoInteiro(i.max_chars);
      return { texto, total_chars: texto.length };
    },
  };

  // 5. Extração de petição do documento (passo 1 da análise de reequilíbrio).
  tools["extrair_peticao_do_documento"] = {
    description:
      "Lê o documento anexado e extrai os dados da petição de reequilíbrio " +
      "(órgão, empresa, contrato, valor, fato alegado). Use ANTES de analisar " +
      "um pedido de reequilíbrio. Retorna os campos para o usuário CONFIRMAR " +
      "ou corrigir; campos_incertos lista o que não foi achado com confiança.",
    inputSchema: z.object({
      pedido_usuario: z
        .string()
        .max(2000)
        .optional()
        .describe("O que o usuário pediu, em linguagem natural"),
    }),
    execute: async (input) => {
      const i = input as { pedido_usuario?: string };
      const texto = await notebook.lerDocumentoInteiro();
      if (!texto || texto.trim().length === 0) {
        return {
          erro: "Nenhum documento anexado. Peça o upload do pedido de reequilíbrio.",
        };
      }
      const rascunho = await extrairPeticaoDeTexto(
        texto,
        i.pedido_usuario ?? "",
        llm,
      );
      await notebook.salvarRascunho(rascunho);
      return { rascunho };
    },
  };

  // 6. Análise completa (PEVS) a partir do rascunho confirmado.
  tools["analisar_reequilibrio"] = {
    description:
      "Roda a ANÁLISE COMPLETA de reequilíbrio (pesquisa a legislação, calcula, " +
      "audita citações e gera veredito + fundamentação) a partir do rascunho " +
      "extraído do documento. Use DEPOIS de extrair_peticao_do_documento e do " +
      "usuário CONFIRMAR os dados. Passe em `correcoes` qualquer campo que o " +
      "usuário tenha corrigido. A análise é persistida e fica consultável.",
    inputSchema: z.object({
      correcoes: z
        .object({
          contratante_razao_social: z.string().optional(),
          contratado_razao_social: z.string().optional(),
          contrato_numero: z.string().optional(),
          contrato_objeto: z.string().optional(),
          contrato_valor_centavos: z.number().int().nonnegative().optional(),
          contrato_data_assinatura: z.string().optional(),
          contrato_data_inicio_vigencia: z.string().optional(),
          resumo_pedido: z.string().optional(),
          // Valor pleiteado: o usuário pode TRANSCREVER o que está na petição
          // (auxílio de transcrição), nunca fabricar um pleito inexistente.
          valor_pretendido_centavos: z.number().int().nonnegative().optional(),
        })
        .optional()
        .describe("Campos corrigidos pelo usuário (sobrescrevem o rascunho)"),
    }),
    execute: async (input) => {
      const i = input as { correcoes?: Partial<PeticaoRascunho> };
      if (!apiKey) {
        return {
          erro: "Configure a chave Google (API key) no navegador para rodar a análise.",
        };
      }
      const rascunho = await notebook.lerRascunho();
      if (!rascunho) {
        return {
          erro: "Nenhum rascunho de petição. Use extrair_peticao_do_documento primeiro.",
        };
      }
      const m: PeticaoRascunho = { ...rascunho, ...(i.correcoes ?? {}) };

      // Validações duras antes de rodar (não roda às cegas).
      if (!m.contrato_valor_centavos || m.contrato_valor_centavos <= 0) {
        return {
          erro: "Informe o valor do contrato (em reais) — é necessário para o cálculo.",
          campos_faltando: ["contrato_valor_centavos"],
        };
      }
      if (!m.resumo_pedido || m.resumo_pedido.trim().length < 50) {
        return {
          erro: "Descreva melhor o fato alegado (mínimo 50 caracteres) antes de analisar.",
          campos_faltando: ["resumo_pedido"],
        };
      }

      const hoje = new Date().toISOString().slice(0, 10);
      const candidata = {
        requerente:
          m.requerente ?? m.contratado_razao_social ?? "Requerente não identificado",
        contratante: {
          razao_social: m.contratante_razao_social ?? "Órgão público contratante",
          cnpj: m.contratante_cnpj ?? "",
          ...(m.contratante_ente_federativo
            ? { ente_federativo: m.contratante_ente_federativo }
            : {}),
        },
        contratado: {
          razao_social: m.contratado_razao_social ?? "Empresa requerente",
          cnpj: m.contratado_cnpj ?? "",
        },
        contrato: {
          numero: m.contrato_numero ?? "(s/n)",
          modalidade: m.contrato_modalidade ?? "outro",
          data_assinatura: m.contrato_data_assinatura ?? hoje,
          data_inicio_vigencia:
            m.contrato_data_inicio_vigencia ?? m.contrato_data_assinatura ?? hoje,
          valor_centavos: m.contrato_valor_centavos,
          objeto: m.contrato_objeto ?? "(objeto não especificado)",
        },
        fato_alegado: m.resumo_pedido,
        base_legal_invocada: m.base_legal_invocada ?? [],
        // Valor pleiteado extraído da petição → vira o cálculo apresentado
        // pelo requerente, que `classificarMerito` usa como `valor_pleiteado`.
        // Ausente (null) → calculos_apresentados=[] → veredito DILIGÊNCIA
        // (pedido não instruído, art. 376, IV). O agente nunca fabrica valor.
        calculos_apresentados:
          typeof m.valor_pretendido_centavos === "number" &&
          m.valor_pretendido_centavos > 0
            ? [
                {
                  descricao:
                    "Valor pleiteado pelo requerente (extraído da petição)",
                  valor_pretendido_centavos: m.valor_pretendido_centavos,
                  metodologia:
                    "Conforme demonstrativo apresentado na petição",
                  indices_utilizados: [],
                },
              ]
            : [],
      };

      const parsed = PeticaoSchema.safeParse(candidata);
      if (!parsed.success) {
        return {
          erro:
            "Dados insuficientes para montar a petição: " +
            parsed.error.issues
              .map((iss) => iss.path.join("."))
              .join(", "),
        };
      }

      const { analise } = await rodarAnalisePeticao(env, parsed.data, apiKey);
      const peticaoId = analise.peticao_id ?? analise.id;
      // Fecha a transição PETICAO_EXTRAIDA→ANALISE_PRONTA da FSM: liga o
      // notebook à análise para o estado seguinte ser derivado do real.
      await notebook.salvarAnaliseId(peticaoId, analise.veredito);
      return {
        veredito: analise.veredito,
        score_confianca: analise.score_confianca,
        citacoes_aprovadas: analise.citacoes.filter(
          (c) => c.status === "APROVADA",
        ).length,
        calculos: analise.calculos.map((c) => ({
          descricao: c.descricao,
          valor_final: c.valor_final,
          unidade: c.unidade_final,
          sucesso: c.sucesso,
        })),
        peticao_id: peticaoId,
      };
    },
  };

  // 7. Tool de condução: apresenta os chips de próximas ações (sempre on).
  tools["oferecer_opcoes"] = {
    description:
      "Apresenta ao usuário um menu de PRÓXIMAS AÇÕES como botões clicáveis. " +
      "Use ao FIM de cada resposta para conduzir o usuário ao próximo passo do " +
      "fluxo (extrair → analisar → gerar parecer). `titulo` é uma pergunta curta; " +
      "`opcoes` são 1 a 4 ações curtas que o usuário pode clicar.",
    inputSchema: OferecerOpcoesInputSchema,
    // Echo: o frontend lê o tool_result e renderiza os chips.
    execute: async (input) => input,
  };

  // 8. Tool de transição: gera o parecer formal (Feature 2) dentro do chat.
  tools["gerar_parecer"] = {
    description:
      "Gera o PARECER FORMAL (documento I-V) a partir da análise já concluída. " +
      "Use quando o usuário pedir o parecer. Só funciona depois da análise e se o " +
      "veredito não for inconclusivo.",
    inputSchema: GerarParecerInputSchema,
    execute: async () => {
      if (!apiKey) {
        return { erro: "Configure a chave Google (API key) para gerar o parecer." };
      }
      const link = await notebook.lerAnaliseId();
      if (!link) {
        return { erro: "Ainda não há análise. Rode a análise do pedido primeiro." };
      }
      if (link.veredito === "inconclusiva") {
        return {
          erro:
            "A análise ficou inconclusiva — não dá para emitir parecer. " +
            "Complemente a documentação e reanalise.",
        };
      }
      const sessionAgent = getSessionAgentClient(env);
      const res = await sessionAgent.carregarAnalise(link.analise_id);
      if (!res) {
        return { erro: "Análise não encontrada no store." };
      }
      const decisao: DecisaoFeature2 = {
        tipo_documento: "parecer_formal",
        cabecalho_meta: {
          numero: `PARECER-${link.analise_id.slice(0, 8)}`,
          parecerista: "Vectorgov_t (Auditor + Redator)",
          orgao: "(órgão não informado)",
          assunto: `Reequilíbrio econômico-financeiro — contrato ${res.peticao.contrato.numero}`,
          data: new Date().toISOString().slice(0, 10),
        },
      };
      const engine = await criarEnginePEVS(env, apiKey);
      const { parecer } = await engine.executarFeature2(res.analise, decisao);
      return {
        parecer_id: parecer.id,
        peticao_id: link.analise_id,
        link: `/peticoes/${link.analise_id}/parecer`,
        mensagem: "Parecer formal gerado com sucesso.",
      };
    },
  };

  // Gating final do trilho: remove as tools de transição que NÃO podem
  // aparecer nesta fase. O Gemini simplesmente não as enxerga fora de hora.
  for (const t of [
    "extrair_peticao_do_documento",
    "analisar_reequilibrio",
    "gerar_parecer",
  ]) {
    if (!transicaoOk.has(t)) delete tools[t];
  }

  return tools;
}

/**
 * Monta system prompt do orquestrador conversacional.
 */
function buildSystemPrompt(documento: {
  nome: string | null;
  total_paginas: number | null;
  total_chars: number | null;
}): string {
  const docInfo = documento.nome
    ? `O usuário anexou um documento: "${documento.nome}" (${
        documento.total_paginas ?? "?"
      } páginas, ${documento.total_chars ?? "?"} chars).`
    : "Nenhum documento anexado ainda — peça o upload se relevante.";

  return `Você é o ORQUESTRADOR conversacional do sistema vectorgov-t, especializado em direito administrativo brasileiro (Lei 14.133/2021) e legislação tributária pós-reforma (EC 132/2023, LC 214/2025, decretos correlatos).

${docInfo}

Como agir:
1. Responda em português do Brasil.
2. Quando a pergunta é sobre o DOCUMENTO anexado: use \`buscar_no_documento\` ou \`ler_documento_inteiro\`.
3. Quando a pergunta é sobre NORMAS, artigos ou jurisprudência: use \`buscar_legislacao\`, \`consultar_artigo\`, \`fs_*\` ou \`consultar_pesquisador\`.
4. Quando o usuário pede CÁLCULOS de reequilíbrio: use \`calcular_reequilibrio\`.
5. Quando pode responder diretamente sem ferramenta (saudação, resumo de algo já dito, opinião jurídica geral): responda direto.

Regras:
- SEMPRE cite a fonte de qualquer artigo/lei que mencionar (use o resultado da tool).
- NUNCA invente normas ou artigos.
- Seja conciso por padrão; expanda quando o usuário pedir detalhes.
- Tool calling: encadeie no máximo 8 passos. Se não conseguir resolver com isso, diga ao usuário e peça reformulação.`;
}

/**
 * Converte histórico do notebook em mensagens pro LLM.
 */
function buildMessages(historico: Mensagem[], userText: string): MensagemLLM[] {
  const messages: MensagemLLM[] = [];
  for (const m of historico) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      // Inclui tool calls como nota inline (LLM precisa ver o histórico).
      const traceTool =
        m.tool_calls.length > 0
          ? `\n[Tools usadas: ${m.tool_calls.map((t) => t.nome).join(", ")}]`
          : "";
      messages.push({
        role: "assistant",
        content: m.content + traceTool,
      });
    }
    // role "system" do histórico é metadata interna — não enviamos.
  }
  const last = historico[historico.length - 1];
  if (!(last?.role === "user" && last.content === userText)) {
    messages.push({ role: "user", content: userText });
  }
  return messages;
}

/**
 * Entry point: processa um turno de chat.
 *
 * Não persiste mensagens — caller decide quando (após onEvent finalizar).
 */
export interface ConversarOpts {
  env: Env;
  llm: LLMClient;
  notebook: NotebookAgent;
  userText: string;
  onEvent: (event: ChatEvent) => void | Promise<void>;
  /** AbortSignal pro caller cancelar (WebSocket fechou). */
  signal?: AbortSignal;
  /**
   * Modelo a usar pro orquestrador do chat. Quando omitido, default
   * `gemini-3.5-flash`. Caller (notebook-agent) lê do KV antes de chamar.
   */
  modelo?: import("../llm/types.js").ModeloLLM;
  /** Chave Google do request (WS subprotocol) — necessária para análise PEVS. */
  apiKey?: string | null;
  /** Fase atual da conversa (derivada pelo NotebookAgent). Define o gating. */
  estado?: EstadoConversa;
  /** Rascunho da petição — alimenta o bloco de estado do system prompt. */
  rascunho?: PeticaoRascunho | null;
  /** Veredito da análise corrente, se já houver. */
  veredito?: string | null;
}

/**
 * Carrega, ao vivo, as skills oferecidas na fase atual (push do FSM).
 *
 * Reusa a tool `skill_listar` (cache KV 5min + fallback R2) com o filtro
 * `fase` — assim a lista reflete CRUD em tempo real e as skills GLOBAIS
 * (sem fase) entram em qualquer fase. Best-effort: qualquer falha devolve
 * lista vazia (o bloco de estado simplesmente não injeta skills).
 */
async function carregarSkillsDaFase(
  env: Env,
  estado: EstadoConversa,
): Promise<Array<{ nome: string; descricao: string }>> {
  try {
    const out = (await invokeSkillTool(env, "skill_listar", {
      fase: estado,
    })) as { skills?: Array<{ nome: string; descricao: string }> };
    return (out.skills ?? []).map((s) => ({
      nome: s.nome,
      descricao: s.descricao,
    }));
  } catch {
    return [];
  }
}

export async function conversar(opts: ConversarOpts): Promise<ResultadoConversa> {
  const { env, llm, notebook, userText, onEvent, signal } = opts;
  const modeloEscolhido = opts.modelo ?? "gemini-3.5-flash";
  const estado = opts.estado ?? "PETICAO_EXTRAIDA";
  const meta = await notebook.getMeta();
  const historico = await notebook.listarMensagens();
  // Gating por fase: o engine só expõe ao Gemini as tools válidas agora.
  const tools = buildTools(env, llm, notebook, opts.apiKey ?? null, estado);
  // Skills da fase atual (push): lidas ao vivo do _meta.json via skill_listar.
  // Refletem CRUD em tempo real — skill nova/atualizada/deletada aparece no
  // próximo turno. Best-effort: se o índice estiver indisponível, segue sem.
  const skillsDaFase = await carregarSkillsDaFase(env, estado);
  // O system prompt carrega o bloco [ESTADO DA CONVERSA] determinístico —
  // o backend dizendo ao condutor onde ele está e o que pode fazer.
  const system =
    buildSystemPrompt({
      nome: meta.documento_nome,
      total_paginas: meta.documento_total_paginas,
      total_chars: meta.documento_total_chars,
    }) +
    "\n\n" +
    montarBlocoEstado({
      estado,
      rascunho: opts.rascunho ?? null,
      veredito: opts.veredito ?? null,
      skillsDaFase,
    });
  const messages = buildMessages(historico, userText);

  let textoAcumulado = "";
  let tokensTotal = 0;
  let finishReason = "stop";
  const toolCalls: ToolCall[] = [];
  const toolCallsPendentes = new Map<
    string,
    { nome: string; args: unknown }
  >();

  for await (const ev of llm.streamText({
    modelo: modeloEscolhido,
    system,
    messages,
    tools,
    maxSteps: 8,
    temperatura: 0.5,
    tag: "notebook-chat",
    signal,
  })) {
    await emitEvent(ev, onEvent, {
      addText: (t) => (textoAcumulado += t),
      addToolCall: (id, name, args) => {
        toolCallsPendentes.set(id, { nome: name, args });
      },
      addToolResult: (id, result, isError) => {
        const pend = toolCallsPendentes.get(id);
        if (pend) {
          toolCalls.push({
            id,
            nome: pend.nome,
            args: pend.args,
            resultado: isError ? null : result,
            erro: isError ? formatToolError(result) : null,
          });
          toolCallsPendentes.delete(id);
        }
      },
      setUsage: (u, reason) => {
        tokensTotal = u;
        finishReason = reason;
      },
    });
    if (ev.type === "error") {
      finishReason = "error";
    }
  }

  // Tool calls sem resultado (raro — só se stream foi abortado).
  for (const [id, pend] of toolCallsPendentes) {
    toolCalls.push({
      id,
      nome: pend.nome,
      args: pend.args,
      resultado: null,
      erro: "tool call não completou (stream interrompido)",
    });
  }

  const messageId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `msg-${Date.now()}`;

  return {
    message_id: messageId,
    texto: textoAcumulado,
    tool_calls: toolCalls,
    tokens: tokensTotal,
    modelo: modeloEscolhido,
    finish_reason: finishReason,
  };
}

function formatToolError(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "error" in (result as Record<string, unknown>)
  ) {
    return String((result as { error: unknown }).error);
  }
  return "erro desconhecido na tool";
}

/**
 * Adapta `StreamEvent` (LLMClient) → `ChatEvent` (UI) e despacha via
 * callback `onEvent`. Side-effects sobre o acumulador via callbacks.
 */
async function emitEvent(
  ev: StreamEvent,
  onEvent: (e: ChatEvent) => void | Promise<void>,
  cb: {
    addText: (t: string) => void;
    addToolCall: (id: string, name: string, args: unknown) => void;
    addToolResult: (id: string, result: unknown, isError: boolean) => void;
    setUsage: (totalTokens: number, finishReason: string) => void;
  },
): Promise<void> {
  switch (ev.type) {
    case "text-delta":
      cb.addText(ev.text);
      await onEvent({ type: "token", text: ev.text });
      break;
    case "tool-call":
      cb.addToolCall(ev.toolCallId, ev.toolName, ev.input);
      await onEvent({
        type: "tool_call",
        call_id: ev.toolCallId,
        name: ev.toolName,
        args: ev.input,
      });
      break;
    case "tool-result":
      cb.addToolResult(ev.toolCallId, ev.output, !!ev.isError);
      await onEvent({
        type: "tool_result",
        call_id: ev.toolCallId,
        name: ev.toolName,
        result: ev.output,
        is_error: !!ev.isError,
      });
      break;
    case "finish":
      cb.setUsage(ev.usage.totalTokens, ev.finishReason);
      break;
    case "error":
      await onEvent({ type: "error", message: ev.error });
      break;
  }
}
