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
function buildTools(
  env: Env,
  llm: LLMClient,
  notebook: NotebookAgent,
): Record<string, ToolForLLM> {
  const tools: Record<string, ToolForLLM> = {};

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
      // O calculista hoje recebe peticao + contexto_pedido. Como em chat
      // livre não temos peticao estruturada, passamos uma peticao mínima
      // sintética. O calculista é placeholder (Fase 2) — ele lê o contexto.
      const peticaoSintetica = {
        id: "00000000-0000-4000-8000-000000000000",
        contratante: {
          razao_social: "(não informado em chat livre)",
          cnpj: "00.000.000/0001-00",
        },
        contratado: {
          razao_social: "(não informado em chat livre)",
          cnpj: "00.000.000/0001-00",
        },
        contrato: {
          numero: "(chat)",
          modalidade: "pregao_eletronico",
          objeto: "(chat livre)",
          valor_centavos: 0,
          assinatura: "2024-01-01",
        },
        fato_alegado: i.descricao_pedido,
        base_legal_invocada: [],
        documentos: [],
      };
      const result = await calculista.executar(
        {
          peticao: peticaoSintetica as never,
          contexto_pedido: i.contexto ?? i.descricao_pedido,
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
}

export async function conversar(opts: ConversarOpts): Promise<ResultadoConversa> {
  const { env, llm, notebook, userText, onEvent, signal } = opts;
  const modeloEscolhido = opts.modelo ?? "gemini-3.5-flash";
  const meta = await notebook.getMeta();
  const historico = await notebook.listarMensagens();
  const tools = buildTools(env, llm, notebook);
  const system = buildSystemPrompt({
    nome: meta.documento_nome,
    total_paginas: meta.documento_total_paginas,
    total_chars: meta.documento_total_chars,
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
