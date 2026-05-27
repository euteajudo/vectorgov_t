/**
 * Implementação real do `LLMClient` usando Vercel AI SDK + @ai-sdk/google.
 *
 * Cobre os dois modos do contrato:
 *  - `generateObject` (structured) — chamado pelos agentes do PEVS engine.
 *  - `streamText` (free-form + tools) — chamado pelo chat conversacional.
 *
 * Thinking: o Flash recebe `thinkingLevel: "minimal"` para reduzir latência
 * e custo. Gemini 3.x Flash não garante thinking totalmente desligado.
 * O Pro mantém o default do modelo (não passa providerOptions).
 *
 * Limites: a chave Google chega como `env.GOOGLE_API_KEY`. Sem ela o
 * construtor arremessa — falhar cedo é melhor que erro críptico na
 * primeira chamada.
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  generateObject as aiGenerateObject,
  jsonSchema as aiJsonSchema,
  streamText as aiStreamText,
  stepCountIs,
  tool as aiTool,
} from "ai";
import type {
  LLMClient,
  ModeloLLM,
  OpcoesGeracaoEstruturada,
  OpcoesStreamText,
  ResultadoGeracaoEstruturada,
  StreamEvent,
} from "./types.js";

/**
 * Mapeia o modelo lógico do projeto pro nome de modelo do provider.
 *
 * Mantemos a separação porque modelos do Google às vezes mudam de nome
 * (preview → stable, suffix de versão, etc.). Centralizar aqui evita
 * caçar substrings pelo código depois.
 */
function resolveModelId(modelo: ModeloLLM): string {
  switch (modelo) {
    case "gemini-3.5-flash":
      return "gemini-3.5-flash";
    case "gemini-3-pro":
      return "gemini-3-pro-preview";
  }
}

/**
 * Provider options aplicados por modelo.
 *
 * Flash: thinking mínimo — para o uso do orquestrador do chat
 * conversacional, raciocínio extra adiciona latência sem ganho claro em
 * decomposição de tarefa simples.
 * Pro: sem options — o Auditor depende do reasoning profundo.
 */
function providerOptionsFor(
  modelo: ModeloLLM,
): Record<string, unknown> | undefined {
  if (modelo === "gemini-3.5-flash") {
    return { google: { thinkingConfig: { thinkingLevel: "minimal" } } };
  }
  return undefined;
}

function toSdkInputSchema(schema: unknown): unknown {
  if (
    schema &&
    typeof schema === "object" &&
    typeof (schema as { safeParse?: unknown }).safeParse === "function"
  ) {
    return schema;
  }
  return aiJsonSchema(schema as never);
}

/**
 * Implementação concreta do LLMClient via Vercel AI SDK.
 *
 * Usamos `as never` casts pontuais em alguns argumentos do AI SDK porque
 * a tipagem deles (Tool<never,never>, providerOptions strict) é incompatível
 * com o nosso shape neutro. O runtime aceita os mesmos shapes — só os tipos
 * são restritos demais.
 */
export class GoogleLLMClient implements LLMClient {
  private readonly providerFactory: ReturnType<typeof createGoogleGenerativeAI>;

  /**
   * `apiKey` é obrigatório — em ambiente Workers vem de `env.GOOGLE_API_KEY`.
   * Aceitamos no construtor pra evitar dependência de variáveis globais.
   */
  constructor(apiKey: string) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(
        "GoogleLLMClient: apiKey obrigatória (passe env.GOOGLE_API_KEY).",
      );
    }
    // Cria provider isolado com a chave (não usa env global do processo).
    this.providerFactory = createGoogleGenerativeAI({ apiKey });
  }

  async generateObject<T>(
    opts: OpcoesGeracaoEstruturada<T>,
  ): Promise<ResultadoGeracaoEstruturada<T>> {
    const modelId = resolveModelId(opts.modelo);
    const providerOptions = providerOptionsFor(opts.modelo);
    // Cast do objeto inteiro pra `never` — os tipos do AI SDK v5 dependem
    // de inferência de schema/output que TS não consegue resolver com o
    // nosso schema neutro `ZodSchema<T>`. Runtime é compatível.
    const result = await (aiGenerateObject as never as (
      opts: unknown,
    ) => Promise<{
      object: unknown;
      usage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }>)({
      model: this.providerFactory(modelId),
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      schema: opts.schema,
      temperature: opts.temperatura ?? 0.2,
      ...(providerOptions ? { providerOptions } : {}),
    });
    // O AI SDK valida o output contra o schema antes de devolver;
    // se chegou aqui, `result.object` é T.
    return {
      object: result.object as T,
      raw: JSON.stringify(result.object),
      usage: {
        promptTokens: result.usage.inputTokens ?? 0,
        completionTokens: result.usage.outputTokens ?? 0,
        totalTokens: result.usage.totalTokens ?? 0,
      },
      modelo: opts.modelo,
    };
  }

  async *streamText(opts: OpcoesStreamText): AsyncIterable<StreamEvent> {
    const modelId = resolveModelId(opts.modelo);
    const providerOptions = providerOptionsFor(opts.modelo);
    const maxSteps = Math.max(1, Math.min(20, opts.maxSteps ?? 8));

    // Converte nossas tools para o formato do AI SDK.
    const sdkTools: Record<string, unknown> = {};
    if (opts.tools) {
      for (const [name, def] of Object.entries(opts.tools)) {
        sdkTools[name] = aiTool({
          description: def.description,
          inputSchema: toSdkInputSchema(def.inputSchema) as never,
          execute: async (input: unknown) => {
            try {
              return await def.execute(input);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return { error: msg };
            }
          },
        });
      }
    }

    const result = aiStreamText({
      model: this.providerFactory(modelId),
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts.temperatura ?? 0.5,
      ...(Object.keys(sdkTools).length > 0 ? { tools: sdkTools as never } : {}),
      stopWhen: stepCountIs(maxSteps),
      ...(providerOptions ? { providerOptions: providerOptions as never } : {}),
      ...(opts.signal ? { abortSignal: opts.signal } : {}),
    });

    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            // AI SDK v5: part.text contém o delta textual
            yield { type: "text-delta", text: (part as { text: string }).text };
            break;
          case "tool-call":
            yield {
              type: "tool-call",
              toolCallId: (part as { toolCallId: string }).toolCallId,
              toolName: (part as { toolName: string }).toolName,
              input: (part as { input: unknown }).input,
            };
            break;
          case "tool-result": {
            const p = part as {
              toolCallId: string;
              toolName: string;
              output: unknown;
            };
            const isError =
              !!(p.output &&
                typeof p.output === "object" &&
                "error" in (p.output as Record<string, unknown>));
            yield {
              type: "tool-result",
              toolCallId: p.toolCallId,
              toolName: p.toolName,
              output: p.output,
              isError,
            };
            break;
          }
          case "finish": {
            const p = part as {
              finishReason: string;
              totalUsage: {
                inputTokens?: number;
                outputTokens?: number;
                totalTokens?: number;
              };
            };
            yield {
              type: "finish",
              usage: {
                promptTokens: p.totalUsage?.inputTokens ?? 0,
                completionTokens: p.totalUsage?.outputTokens ?? 0,
                totalTokens: p.totalUsage?.totalTokens ?? 0,
              },
              modelo: opts.modelo,
              finishReason: p.finishReason ?? "stop",
            };
            break;
          }
          case "error": {
            const errPart = part as { error: unknown };
            const msg =
              errPart.error instanceof Error
                ? errPart.error.message
                : String(errPart.error);
            yield { type: "error", error: msg };
            return;
          }
          default:
            // Ignora outros tipos (reasoning, source, etc.) no chat.
            break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "error", error: msg };
    }
  }
}

/**
 * Factory ergonômica — recebe o `env` do Worker e devolve o client.
 * Arremessa cedo se a key não estiver configurada (vê secret no
 * wrangler.toml ou .dev.vars).
 */
export function criarGoogleLLM(env: { GOOGLE_API_KEY?: string }): GoogleLLMClient {
  const key = env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_API_KEY não configurada — defina via `wrangler secret put GOOGLE_API_KEY` ou em .dev.vars",
    );
  }
  return new GoogleLLMClient(key);
}
