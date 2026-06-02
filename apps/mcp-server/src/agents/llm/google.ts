/**
 * Implementação real do `LLMClient` via Vercel AI SDK + Cloudflare AI Gateway.
 *
 * O Gemini é acessado pelo endpoint **OpenAI-compatible** do AI Gateway
 * (`@ai-sdk/openai-compatible`), NÃO mais direto pelo `@ai-sdk/google`. A chave
 * do Google fica guardada **dentro do gateway** (BYOK / Stored Keys); o Worker
 * só carrega o token do gateway (`env.CF_AIG_TOKEN`) e o envia no header
 * `cf-aig-authorization`. Assim a chave do Gemini não passa pelo browser nem
 * pelo Worker — mesma estratégia já validada no worker `catmat-catser-api`.
 *
 * Cobre os dois modos do contrato:
 *  - `generateObject` (structured) — chamado pelos agentes do PEVS engine.
 *    A saída estruturada vai como `response_format: json_schema` (suportado
 *    pelo gateway → google-ai-studio, validado ao vivo).
 *  - `streamText` (free-form + tools) — chamado pelo chat conversacional.
 *
 * Limites: o token do gateway chega como `env.CF_AIG_TOKEN`. Sem ele o
 * construtor arremessa — falhar cedo é melhor que erro críptico na
 * primeira chamada.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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
 * Base do endpoint OpenAI-compatible do AI Gateway `vectorgov-t`. O SDK
 * acrescenta `/chat/completions`. Override por `env.CF_AIG_BASE_URL` se algum
 * dia o gateway/conta mudarem (ver `criarGoogleLLM`).
 */
const GATEWAY_COMPAT_BASE =
  "https://gateway.ai.cloudflare.com/v1/a89dbdb0224cd8d2292cda8a038bc297/vectorgov-t/compat";

/**
 * Prefixo do provider no gateway: o modelo é endereçado como
 * `google-ai-studio/<modelo>` no endpoint compat (roteia para o Google AI
 * Studio com a chave em BYOK).
 */
const PROVIDER_PREFIX = "google-ai-studio/";

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
      // `gemini-3-pro-preview` foi descontinuado ("no longer available").
      // O Pro corrente é `gemini-3.1-pro-preview` (validado contra a
      // models.list da API em 2026-05). Mantemos o nome lógico
      // `gemini-3-pro` no código pra não quebrar config persistida no KV.
      return "gemini-3.1-pro-preview";
  }
}

interface ToolCallDelta {
  id?: string;
  index?: number;
  extra_content?: { google?: { thought_signature?: string } } | unknown;
}

/** Captura a assinatura de thinking de um tool_call (req/resp) no mapa. */
function capturarSig(
  toolCalls: ToolCallDelta[] | undefined,
  sigByCallId: Map<string, string>,
): void {
  for (const tc of toolCalls ?? []) {
    const sig = (tc.extra_content as { google?: { thought_signature?: string } })
      ?.google?.thought_signature;
    if (tc.id && sig) sigByCallId.set(tc.id, sig);
  }
}

/**
 * Patches em UM chunk do compat do Gemini que o `@ai-sdk/openai-compatible`
 * não tolera:
 *  - `tool_calls[].index` AUSENTE: o Gemini não manda `index` nos deltas de
 *    streaming; o schema do SDK o exige (number). Preenchemos por posição.
 * Também captura o `thought_signature` de cada tool_call (req/resp).
 */
function patchChunk(
  obj: { choices?: Array<{ delta?: { tool_calls?: ToolCallDelta[] }; message?: { tool_calls?: ToolCallDelta[] } }> },
  sigByCallId: Map<string, string>,
): void {
  for (const ch of obj.choices ?? []) {
    const tcs = ch.delta?.tool_calls ?? ch.message?.tool_calls;
    if (!Array.isArray(tcs)) continue;
    tcs.forEach((tc, i) => {
      if (typeof tc.index !== "number") tc.index = i;
    });
    capturarSig(tcs, sigByCallId);
  }
}

/**
 * Stream SSE → reescreve cada `data: {json}` aplicando `patchChunk`. Buffer de
 * linhas porque chunks de rede não respeitam fronteiras de evento.
 */
function transformarSSE(
  body: ReadableStream<Uint8Array>,
  sigByCallId: Map<string, string>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  const processarLinha = (linha: string): string => {
    if (!linha.startsWith("data:")) return linha;
    const payload = linha.slice(5).trim();
    if (payload === "" || payload === "[DONE]") return linha;
    try {
      const obj = JSON.parse(payload);
      patchChunk(obj, sigByCallId);
      return `data: ${JSON.stringify(obj)}`;
    } catch {
      return linha;
    }
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true });
        const linhas = buf.split("\n");
        buf = linhas.pop() ?? "";
        for (const l of linhas) {
          controller.enqueue(encoder.encode(processarLinha(l) + "\n"));
        }
      },
      flush(controller) {
        if (buf) controller.enqueue(encoder.encode(processarLinha(buf)));
      },
    }),
  );
}

/**
 * Constrói um `fetch` que faz a ponte com o AI Gateway:
 *
 *  1. Troca a autenticação: remove qualquer `authorization` que o SDK injete
 *     (não temos chave do Google no app) e seta
 *     `cf-aig-authorization: Bearer <token>` — o gateway injeta a chave BYOK.
 *  2. Propaga o `thought_signature` do Gemini entre turnos de tool-call. O
 *     endpoint compat devolve a assinatura em `extra_content.google` de cada
 *     `tool_call`; nos requests seguintes ela precisa voltar no mesmo lugar,
 *     senão o tool-calling com modelos de thinking quebra. O `@ai-sdk/*` não
 *     conhece esse campo, então re-injetamos na mão (mesma lógica do
 *     `catmat-catser-api`). O `sigByCallId` é por-chamada.
 *  3. Conserta a resposta de streaming do Gemini, que omite `tool_calls.index`
 *     (o schema do `@ai-sdk/openai-compatible` exige) — ver `patchChunk`.
 */
function criarCfFetch(token: string): typeof fetch {
  const sigByCallId = new Map<string, string>();
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    headers.set("cf-aig-authorization", `Bearer ${token}`);

    let body = init?.body;
    if (typeof body === "string" && sigByCallId.size > 0) {
      try {
        const parsed = JSON.parse(body) as {
          messages?: Array<{ role?: string; tool_calls?: ToolCallDelta[] }>;
        };
        for (const msg of parsed.messages ?? []) {
          if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
          for (const tc of msg.tool_calls) {
            const sig = tc.id ? sigByCallId.get(tc.id) : undefined;
            if (sig && !tc.extra_content) {
              tc.extra_content = { google: { thought_signature: sig } };
            }
          }
        }
        body = JSON.stringify(parsed);
      } catch {
        // body não-JSON ou shape inesperado — segue sem tocar.
      }
    }

    const res = await fetch(input, { ...init, body, headers });
    const contentType = res.headers.get("content-type") ?? "";

    // Streaming (SSE): transforma o corpo para consertar index + captura sig.
    if (contentType.includes("text/event-stream") && res.body) {
      return new Response(transformarSSE(res.body, sigByCallId), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }

    // Não-streaming (generateObject / generateText): captura sig sem consumir
    // o corpo original (clone).
    try {
      const data = (await res.clone().json()) as {
        choices?: Array<{ message?: { tool_calls?: ToolCallDelta[] } }>;
      };
      capturarSig(data.choices?.[0]?.message?.tool_calls, sigByCallId);
    } catch {
      // não-JSON — nada a capturar.
    }
    return res;
  };
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
  private readonly gatewayToken: string;
  private readonly baseURL: string;

  /**
   * `gatewayToken` é o token do AI Gateway (`env.CF_AIG_TOKEN`), NÃO a chave do
   * Google — essa fica em BYOK no gateway. `baseURL` default aponta para o
   * gateway `vectorgov-t`; override só em testes/migração.
   */
  constructor(gatewayToken: string, baseURL: string = GATEWAY_COMPAT_BASE) {
    if (!gatewayToken || gatewayToken.trim().length === 0) {
      throw new Error(
        "GoogleLLMClient: CF_AIG_TOKEN obrigatório (token do AI Gateway, BYOK).",
      );
    }
    this.gatewayToken = gatewayToken.trim();
    this.baseURL = baseURL;
  }

  /**
   * Cria o modelo do AI SDK apontado para o gateway. Fresh por chamada para
   * que o `sigByCallId` do `cfFetch` (propagação de thought_signature) seja
   * isolado por chamada — não vaza assinatura entre conversas.
   */
  private model(modelo: ModeloLLM) {
    const provider = createOpenAICompatible({
      name: "cf-aig-google",
      baseURL: this.baseURL,
      // Faz o generateObject usar `response_format: json_schema` (strict), que
      // o gateway → google-ai-studio honra. Sem isso o SDK cai em "JSON mode"
      // frouxo e o modelo desvia do schema.
      supportsStructuredOutputs: true,
      fetch: criarCfFetch(this.gatewayToken),
    });
    return provider(`${PROVIDER_PREFIX}${resolveModelId(modelo)}`);
  }

  async generateObject<T>(
    opts: OpcoesGeracaoEstruturada<T>,
  ): Promise<ResultadoGeracaoEstruturada<T>> {
    // Cast do objeto inteiro pra `never` — os tipos do AI SDK v5 dependem
    // de inferência de schema/output que TS não consegue resolver com o
    // nosso schema neutro `ZodSchema<T>`. Runtime é compatível. O SDK manda
    // `response_format: json_schema` no compat (validado ao vivo no gateway).
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
      model: this.model(opts.modelo),
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      schema: opts.schema,
      temperature: opts.temperatura ?? 0.2,
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
      model: this.model(opts.modelo),
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts.temperatura ?? 0.5,
      ...(Object.keys(sdkTools).length > 0 ? { tools: sdkTools as never } : {}),
      stopWhen: stepCountIs(maxSteps),
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
 * Factory ergonômica — recebe o `env` do Worker e devolve o client apontado
 * para o AI Gateway. O secret `CF_AIG_TOKEN` autentica no gateway; a chave do
 * Google fica em BYOK lá. `CF_AIG_BASE_URL` permite override da base (default:
 * gateway `vectorgov-t`).
 */
export function criarGoogleLLM(env: {
  CF_AIG_TOKEN?: string;
  CF_AIG_BASE_URL?: string;
}): GoogleLLMClient {
  const token = env.CF_AIG_TOKEN;
  if (!token) {
    throw new Error(
      "CF_AIG_TOKEN ausente — configure o secret do AI Gateway: " +
        "`wrangler secret put CF_AIG_TOKEN`",
    );
  }
  return new GoogleLLMClient(token, env.CF_AIG_BASE_URL ?? GATEWAY_COMPAT_BASE);
}

/**
 * Provider OpenAI-compatible cru apontado para o AI Gateway — para chamadas
 * pontuais ao AI SDK (`generateObject`/`generateText`) fora do `LLMClient`,
 * como a tool de sugestão de skills. O modelo deve ser endereçado como
 * `google-ai-studio/<modelo>` (ex.: `google-ai-studio/gemini-2.5-flash`).
 */
export function criarProviderGateway(env: {
  CF_AIG_TOKEN?: string;
  CF_AIG_BASE_URL?: string;
}): ReturnType<typeof createOpenAICompatible> {
  const token = env.CF_AIG_TOKEN;
  if (!token) {
    throw new Error(
      "CF_AIG_TOKEN ausente — configure o secret do AI Gateway.",
    );
  }
  return createOpenAICompatible({
    name: "cf-aig-google",
    baseURL: env.CF_AIG_BASE_URL ?? GATEWAY_COMPAT_BASE,
    supportsStructuredOutputs: true,
    fetch: criarCfFetch(token.trim()),
  });
}

/**
 * Testa a conectividade com o AI Gateway (token + BYOK) fazendo uma chamada
 * mínima. Custa ~5 tokens. Retorna `{ok: true}` em sucesso ou
 * `{ok: false, message: ...}` em qualquer erro de auth/rede.
 *
 * O parâmetro continua se chamando `token` — é o `env.CF_AIG_TOKEN`, não mais
 * a chave do Google (que vive no gateway).
 */
export async function testarChaveGoogle(
  token: string,
  modelo: ModeloLLM = "gemini-3.5-flash",
): Promise<{ ok: boolean; message?: string }> {
  if (!token || token.trim().length === 0) {
    return { ok: false, message: "token vazio" };
  }
  try {
    const client = new GoogleLLMClient(token.trim());
    const stream = client.streamText({
      modelo,
      system: "ping",
      messages: [{ role: "user", content: "ok" }],
      maxSteps: 1,
      temperatura: 0,
      tag: "test-key",
    });
    for await (const ev of stream) {
      if (ev.type === "error") {
        return { ok: false, message: ev.error };
      }
      if (ev.type === "finish") {
        return { ok: true };
      }
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}
