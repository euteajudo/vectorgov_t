/**
 * Registry de tools MCP — interface comum + agregação por categoria.
 *
 * O handler MCP em `mcp/server.ts` consulta este registry para responder
 * `tools/list` e despachar `tools/call`. Cada tool é declarada como um
 * `ToolDefinition` independente do transporte JSON-RPC.
 *
 * Padrão:
 *   - `inputSchema` é o JSON Schema enviado ao cliente em `tools/list`.
 *   - `parse(args)`  valida os argumentos via Zod (devolve dado tipado).
 *   - `handler(env, input)` executa a tool e devolve `unknown` (caller
 *     serializa).
 *
 * Erros de validação Zod são convertidos em `ToolInputError` para o
 * handler MCP mapear para `-32602 Invalid params`.
 */

import type { z } from "zod";
import type { Env } from "../../env.js";

/**
 * Erro de validação de input. O handler MCP traduz para `-32602`.
 */
export class ToolInputError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ToolInputError";
  }
}

/**
 * Erro de execução interna controlada (ex.: skill não encontrada).
 * O handler MCP traduz para `-32603` com `data` opcional.
 */
export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

/**
 * Descritor minimal de tool. Genérico em `Input` para preservar tipagem.
 */
export interface ToolDefinition<
  // O genérico não precisa ser usado em todas as propriedades — `parse`
  // já garante o tipo. Usar `z.ZodTypeAny` permite registro homogêneo.
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: string;
  description: string;
  /** JSON Schema servido em `tools/list` (gerado manualmente para evitar dep). */
  inputSchema: Record<string, unknown>;
  /** Schema Zod para validação real dos argumentos. */
  zodSchema: TSchema;
  /** Executa a tool — recebe o input já validado. */
  handler: (env: Env, input: z.infer<TSchema>) => Promise<unknown>;
}

/**
 * Registry interno — mutável apenas durante o boot (módulos chamam `register`
 * uma vez ao serem importados). Após boot, opera read-only.
 */
const toolsByName = new Map<string, ToolDefinition>();

/**
 * Registra uma tool. Erro fatal se já existir uma com o mesmo nome —
 * conflito indica bug de duplicidade.
 */
export function registerTool<T extends z.ZodTypeAny>(
  tool: ToolDefinition<T>,
): void {
  if (toolsByName.has(tool.name)) {
    throw new Error(`Tool já registrada: ${tool.name}`);
  }
  toolsByName.set(tool.name, tool as ToolDefinition);
}

/**
 * Devolve a lista de descritores para `tools/list` — sem o `handler` nem o
 * `zodSchema` (objetos não serializáveis em JSON pelo runtime do MCP).
 */
export function listToolDescriptors(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return Array.from(toolsByName.values()).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

/**
 * Busca tool por nome. Devolve `undefined` se não existir — caller decide
 * se vira `-32601` ou outro erro.
 */
export function findTool(name: string): ToolDefinition | undefined {
  return toolsByName.get(name);
}

/**
 * Executa uma tool: valida input via Zod (convertendo erro em `ToolInputError`)
 * e roda o handler. Não captura `ToolExecutionError` — caller decide o code.
 */
export async function invokeTool(
  env: Env,
  name: string,
  args: unknown,
): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) {
    throw new ToolExecutionError(`Tool não encontrada: ${name}`);
  }
  const parsed = tool.zodSchema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new ToolInputError(
      `Argumentos inválidos para '${name}'`,
      parsed.error.issues,
    );
  }
  return tool.handler(env, parsed.data);
}

/**
 * Apenas para testes — limpa o registry entre suites para evitar vazamento
 * de estado entre testes que importam módulos com side-effect de register.
 */
export function __resetRegistryForTests(): void {
  toolsByName.clear();
}
