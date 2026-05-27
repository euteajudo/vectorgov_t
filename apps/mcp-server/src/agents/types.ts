/**
 * Tipos compartilhados pelo sistema multi-agente.
 *
 * - `AgentRole<TInput, TOutput>` — contrato de um papel.
 * - `AgentContext` — passado a todos os papéis (tools, LLM, logger, skills).
 * - `SkillFull` — placeholder do que o Track E entrega (skills system).
 * - `ToolMCP` — placeholder do que o Track D entrega (tools MCP).
 *
 * Os placeholders ficam aqui porque os Tracks D e E ainda não pousaram;
 * quando integrarmos, basta trocar a importação dos tipos sem mexer
 * no resto.
 */
import type { ZodSchema } from "zod";
import type { LLMClient, ModeloLLM } from "./llm/index.js";
import type { FuncaoModelo } from "../lib/model-config.js";

/**
 * Placeholder do que o Track E (skills) entregará — basta um identificador
 * e um corpo markdown. O Orquestrador injeta as skills relevantes no
 * `contexto.skills` ao chamar cada papel.
 */
export interface SkillFull {
  id: string;
  titulo: string;
  conteudo_markdown: string;
  tags: string[];
}

/**
 * Placeholder do que o Track D (tools MCP) entregará.
 *
 * A interface mínima é "callable com nome + argumentos JSON, retorna
 * resultado JSON". O agente nunca importa tools diretamente — recebe
 * via `AgentContext.tools` e filtra pelas que estão em `toolsPermitidas`.
 */
export interface ToolMCP {
  nome: string;
  /** Descrição curta (vai para o system prompt do agente). */
  descricao: string;
  /** Executa a tool com argumentos JSON e devolve resultado JSON. */
  executar(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Logger estruturado simples — `console.log` por padrão, mas pode ser
 * trocado por um logger real (Cloudflare Workers Analytics Engine,
 * etc.) sem mudar a assinatura.
 */
export interface AgentLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/**
 * Logger default — usa `console`. Adequado para Workers e testes Node.
 */
export const consoleLogger: AgentLogger = {
  info: (msg, data) =>
    console.log(JSON.stringify({ level: "info", msg, ...data })),
  warn: (msg, data) =>
    console.warn(JSON.stringify({ level: "warn", msg, ...data })),
  error: (msg, data) =>
    console.error(JSON.stringify({ level: "error", msg, ...data })),
};

/**
 * Contexto passado a todos os papéis durante a execução.
 *
 *  - `tools`: catálogo de tools MCP disponíveis. O papel filtra pelo
 *    `toolsPermitidas` antes de expor ao LLM.
 *  - `llm`: cliente LLM (real ou mock).
 *  - `logger`: logger estruturado.
 *  - `sessionId`: ID do SessionAgent (DurableObject) que está conduzindo
 *    a execução — útil para persistência de logs / breadcrumbs.
 *  - `tracingId`: ID de correlação da execução completa do PEVS.
 */
export interface AgentContext {
  tools: ToolMCP[];
  llm: LLMClient;
  logger: AgentLogger;
  sessionId: string;
  tracingId: string;
  /**
   * Override de modelo por função. Lido do KV (`config:models`) no início
   * de cada operação. Quando ausente, cada role usa seu default histórico
   * (Flash em quase todos, Pro no Auditor).
   */
  modelos?: Partial<Record<FuncaoModelo, ModeloLLM>>;
}

/**
 * Contrato genérico de um papel/agente.
 *
 * Cada papel é uma "factory" + `executar`. Mantemos a interface
 * intencionalmente pequena para que cada agente seja testável em
 * isolamento e o PEVS engine possa orquestrá-los sem conhecer detalhes.
 */
export interface AgentRole<TInput, TOutput> {
  /** Nome curto (ex.: "orquestrador"). */
  nome: string;
  /** Papel humano-legível (ex.: "Decompõe pergunta, planeja, sintetiza"). */
  papel: string;
  /** System prompt base — agentes podem expandir adicionando regras. */
  systemPromptBase: string;
  /** Nomes de tools MCP que este papel pode usar. */
  toolsPermitidas: string[];
  /** Modelo recomendado. */
  modelo: ModeloLLM;
  /** Schema Zod que valida o output do agente. */
  schemaOutput: ZodSchema<TOutput>;
  /** Executa o papel. */
  executar(
    input: TInput,
    contexto: AgentContext,
    skills?: SkillFull[],
  ): Promise<TOutput>;
}

/**
 * Helper para montar o system prompt completo de um agente, anexando
 * skills relevantes injetadas pelo Orquestrador.
 *
 * Skills aparecem em ordem como blocos `## Skill: <titulo>` no fim do
 * system, depois das regras base. Isso é determinístico — não depende
 * de ordem de iteração.
 */
export function montarSystemPrompt(
  base: string,
  skills?: SkillFull[],
): string {
  if (!skills || skills.length === 0) return base;
  const blocos = skills
    .map(
      (s) =>
        `\n\n## Skill: ${s.titulo}\n(id=${s.id}, tags=${s.tags.join(", ")})\n\n${s.conteudo_markdown}`,
    )
    .join("");
  return `${base}\n\n---\n# Skills disponíveis nesta execução${blocos}`;
}
