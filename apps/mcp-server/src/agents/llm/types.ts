/**
 * Tipos compartilhados do cliente LLM dos agentes.
 *
 * O contrato `LLMClient` cobre dois modos:
 *  1. `generateObject` — geração estruturada (Zod-validated) usada pelos
 *     agentes do PEVS engine. Bloqueante.
 *  2. `streamText` — geração de texto livre com tool calling iterativo
 *     usada pelo chat conversacional (NotebookLM). Stream de eventos.
 *
 * Implementações disponíveis:
 *  - `MockLLMClient` em `./mock.ts` (testes e desenvolvimento).
 *  - `GoogleLLMClient` em `./google.ts` (produção, via Vercel AI SDK).
 */
import type { ZodSchema, ZodType } from "zod";

/**
 * Modelos suportados pelo sistema.
 *
 * O Auditor exige `gemini-3-pro` (instruction-following mais robusto +
 * janela maior para comparar texto literal contra filesystem). Demais
 * papéis usam `gemini-3.5-flash` (custo / latência).
 */
export type ModeloLLM = "gemini-3.5-flash" | "gemini-3-pro";

/**
 * Mensagem trocada com o LLM (estilo OpenAI / Vercel AI SDK).
 */
export interface MensagemLLM {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Resultado de uma chamada de geração estruturada — o LLM retorna
 * um objeto que valida contra o `schema` fornecido (Zod).
 */
export interface ResultadoGeracaoEstruturada<T> {
  object: T;
  raw: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  modelo: ModeloLLM;
}

/**
 * Opções de uma chamada de `generateObject`.
 */
export interface OpcoesGeracaoEstruturada<T> {
  modelo: ModeloLLM;
  /** System prompt principal (papel + regras). */
  system: string;
  /** Mensagens user/assistant subsequentes. */
  messages: MensagemLLM[];
  /** Schema Zod que o output precisa validar. */
  schema: ZodSchema<T>;
  /** Temperatura (0..2). Default: 0.2 (precisão > criatividade). */
  temperatura?: number;
  /** Identificador da chamada (para logs / tracing). */
  tag?: string;
}

/**
 * Tool exposta ao `streamText` — formato neutro que o client converte
 * pro shape do provider (Vercel AI SDK `tool({...})`).
 *
 * `execute` é assíncrono e devolve resultado JSON-serializável. Erros
 * dentro do execute viram tool-result do tipo error que o LLM vê.
 */
export interface ToolForLLM<TInput = unknown, TOutput = unknown> {
  description: string;
  inputSchema: ZodType<TInput> | Record<string, unknown>;
  execute(input: TInput): Promise<TOutput>;
}

/**
 * Opções de `streamText`.
 *
 * O loop tool-call → resposta → tool-call → ... é gerenciado internamente
 * pelo client (Vercel AI SDK faz isso com `stopWhen: stepCountIs(N)`).
 * `maxSteps` clamp em [1, 20] (default 8) para evitar loops infinitos.
 */
export interface OpcoesStreamText {
  modelo: ModeloLLM;
  system: string;
  messages: MensagemLLM[];
  /** Map de tools disponíveis ao modelo. Default: sem tools (chat puro). */
  tools?: Record<string, ToolForLLM>;
  /** Temperatura. Default 0.5 (chat livre vs structured precisa de margem). */
  temperatura?: number;
  /** Limite de tool-call steps. Default 8. Clampado em [1, 20]. */
  maxSteps?: number;
  /** Identificador para logs/tracing. */
  tag?: string;
  /**
   * Sinal de abort externo. Quando o WebSocket fecha, o caller dispara
   * `abort()` para o streamText encerrar imediatamente sem perder tokens
   * já gerados.
   */
  signal?: AbortSignal;
}

/**
 * Eventos emitidos pelo stream — uma versão simplificada do
 * `result.fullStream` do AI SDK que é estável entre provedores.
 */
export type StreamEvent =
  | { type: "text-delta"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
      isError?: boolean;
    }
  | {
      type: "finish";
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
      modelo: ModeloLLM;
      finishReason: string;
    }
  | { type: "error"; error: string };

/**
 * Contrato do cliente LLM consumido por agentes e pelo chat conversacional.
 *
 * - `generateObject` é o caminho estruturado (PEVS engine).
 * - `streamText` é o caminho livre com tool calling (NotebookLM chat).
 *
 * Ambos têm que ser implementados pelo client real; o mock pode emitir
 * stubs determinísticos pro stream.
 */
export interface LLMClient {
  generateObject<T>(
    opts: OpcoesGeracaoEstruturada<T>,
  ): Promise<ResultadoGeracaoEstruturada<T>>;
  streamText(opts: OpcoesStreamText): AsyncIterable<StreamEvent>;
}
