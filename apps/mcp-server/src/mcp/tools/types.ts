/**
 * Tipos compartilhados pelas tools MCP — minimal por design.
 *
 * Cada tool é descrita por um `ToolDescriptor` contendo o catálogo
 * (name, description, JSON Schema) e o `handler` runtime. O registry
 * mapeia `name → ToolDescriptor` para o dispatch em `tools/call`.
 */

import type { Env } from "../../env.js";

/**
 * Handler runtime de uma tool.
 *
 * Recebe os `arguments` brutos vindos do JSON-RPC (já validados como
 * objeto, mas ainda não validados contra o schema Zod) e o `Env`.
 *
 * Retorna o `result` puro (sem envelope JSON-RPC) — o dispatcher
 * embrulha em `{ content: [...] }` conforme spec MCP.
 *
 * Em caso de erro de validação ou de runtime, a tool DEVE lançar `Error`.
 * O dispatcher converte para `-32602` (params inválidos) ou `-32603`
 * (erro interno) conforme o tipo do erro.
 */
export type ToolHandler = (
  args: unknown,
  env: Env,
) => Promise<unknown>;

/**
 * Erro semântico de validação de parâmetros — sinaliza ao dispatcher
 * que deve responder com `-32602` em vez de `-32603`.
 */
export class ToolValidationError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ToolValidationError";
  }
}

/**
 * Descritor completo de uma tool — usado tanto em `tools/list` quanto
 * no dispatch.
 */
export interface ToolDescriptor {
  /** Nome snake_case (visível ao agente). */
  name: string;
  /** Descrição em PT-BR clara (curta — uma linha quando possível). */
  description: string;
  /** JSON Schema (Draft 2020-12) gerado a partir do schema Zod. */
  inputSchema: Record<string, unknown>;
  /** Handler que executa a tool. */
  handler: ToolHandler;
}
