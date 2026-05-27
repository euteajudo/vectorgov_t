/**
 * Tipos compartilhados do cliente LLM dos agentes.
 *
 * O sistema multi-agente fala com modelos via uma **abstração** (`LLMClient`)
 * que pode ser:
 *  - Mockada em testes (este arquivo expõe `MockLLMClient` em `./mock.ts`).
 *  - Implementada com Vercel AI SDK + @ai-sdk/google no runtime real
 *    (TODO Fase 3, após GOOGLE_API_KEY estar configurada).
 *
 * Conscientemente NÃO importamos `ai` / `@ai-sdk/google` aqui — manter a
 * dependência do runtime separada do contrato deixa os testes triviais
 * (sem network, sem fetch) e facilita trocar de provider mais tarde.
 */
import type { ZodSchema } from "zod";

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
 *
 * `raw` é a string bruta antes da validação (útil para debugging e
 * logs do PEVS engine).
 *
 * `usage` é melhor-esforço: o cliente real (Vercel AI SDK) preenche
 * tokens reais; o mock devolve estimativas a partir do tamanho da
 * string para que os logs do PEVS não fiquem com `null` por toda parte.
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
 * Opções de uma chamada de `generateObject` — abstração ENXUTA do
 * Vercel AI SDK (suficiente para nosso uso).
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
 * Contrato do cliente LLM consumido por todos os agentes.
 *
 * Mantemos só `generateObject` por enquanto — o sistema multi-agente
 * é structured-output-first. Streaming / texto livre podem ser
 * adicionados depois sem quebrar consumidores existentes.
 *
 * TODO (Fase 3): implementação real usando Vercel AI SDK:
 *
 *   import { generateObject } from "ai";
 *   import { google } from "@ai-sdk/google";
 *   const result = await generateObject({
 *     model: google(opts.modelo),
 *     system: opts.system,
 *     messages: opts.messages,
 *     schema: opts.schema,
 *     temperature: opts.temperatura ?? 0.2,
 *   });
 *   return { object: result.object, raw: result.text, usage: {...}, modelo: opts.modelo };
 */
export interface LLMClient {
  generateObject<T>(
    opts: OpcoesGeracaoEstruturada<T>,
  ): Promise<ResultadoGeracaoEstruturada<T>>;
}
