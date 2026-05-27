/**
 * Handler MCP — implementa o subset JSON-RPC 2.0 com tools reais.
 *
 * Métodos suportados:
 *  - `tools/list` → catálogo unificado de 13 tools (9 leis Track D + 4 skills Track E).
 *  - `tools/call` → dispatch para o handler da tool correspondente.
 *
 * Códigos de erro JSON-RPC seguidos:
 *  - `-32700` Parse error (corpo inválido).
 *  - `-32600` Invalid Request (envelope JSON-RPC ausente / malformado).
 *  - `-32601` Method not found (método não suportado ou tool inexistente).
 *  - `-32602` Invalid params (parâmetros faltando / mal tipados ou validação Zod).
 *  - `-32603` Internal error (exceção inesperada do servidor).
 */

import type { Env } from "../env.js";
import {
  jsonResponse,
  jsonRpcError,
  jsonRpcSuccess,
  type JsonRpcId,
} from "../lib/responses.js";
import {
  MCP_TOOLS,
  findTool,
  ToolValidationError,
  // Skills (Track E) via registry
  listToolDescriptors,
  invokeTool,
  findSkillTool,
  ToolInputError,
  ToolExecutionError,
} from "./tools/index.js";

/**
 * Estrutura mínima de uma requisição JSON-RPC 2.0.
 */
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

/**
 * Resultado de `tools/list`. Array de descritores serializáveis (sem `handler`).
 */
interface ToolsListResult {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

/**
 * Parâmetros aceitos por `tools/call`.
 */
interface ToolsCallParams {
  name?: unknown;
  arguments?: unknown;
}

/**
 * Envelope MCP de resposta de tool — texto serializado em JSON.
 *
 * Spec MCP: `content: [{ type: 'text', text: string }]`. Para tools
 * estruturadas, embrulhamos o `result` em JSON.stringify.
 */
interface ToolCallEnvelope {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Type guard: verifica se o body parseado é um objeto não-array.
 */
function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extrai o ID da requisição de forma defensiva.
 */
function extractId(raw: unknown): JsonRpcId {
  if (raw === null) return null;
  if (typeof raw === "string" || typeof raw === "number") return raw;
  return null;
}

/**
 * Monta o envelope MCP de sucesso para `tools/call`.
 */
function toolEnvelope(result: unknown): ToolCallEnvelope {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}

/**
 * Monta o envelope MCP de erro para `tools/call` (devolvido como resultado
 * "ok" no envelope JSON-RPC com `isError: true`, conforme spec MCP).
 */
function toolErrorEnvelope(message: string, details?: unknown): ToolCallEnvelope {
  const payload = details ? { error: message, details } : { error: message };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
  };
}

/**
 * Catálogo unificado de tools (leis + skills).
 *
 * Calculado uma vez por isolate (módulo carregado uma só vez).
 * Ordem: leis primeiro (Track D), depois skills (Track E via registry).
 */
function buildCatalog(): ToolsListResult {
  const leis = MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  const skills = listToolDescriptors();
  return { tools: [...leis, ...skills] };
}

const TOOLS_CATALOG: ToolsListResult = buildCatalog();

/**
 * Roteia o método JSON-RPC para o handler apropriado.
 */
async function dispatch(
  method: string,
  params: unknown,
  id: JsonRpcId,
  env: Env,
): Promise<ReturnType<typeof jsonRpcSuccess> | ReturnType<typeof jsonRpcError>> {
  switch (method) {
    case "tools/list": {
      return jsonRpcSuccess(id, TOOLS_CATALOG);
    }

    case "tools/call": {
      if (!isObjectLike(params)) {
        return jsonRpcError(
          id,
          -32602,
          "Invalid params: 'params' deve ser um objeto",
        );
      }
      const callParams = params as ToolsCallParams;
      if (typeof callParams.name !== "string" || callParams.name.length === 0) {
        return jsonRpcError(
          id,
          -32602,
          "Invalid params: 'name' (string) é obrigatório",
        );
      }

      // 1. Tenta tool de LEI (Track D)
      const leiTool = findTool(callParams.name);
      if (leiTool) {
        try {
          const args = callParams.arguments ?? {};
          const result = await leiTool.handler(args, env);
          return jsonRpcSuccess(id, toolEnvelope(result));
        } catch (err) {
          if (err instanceof ToolValidationError) {
            return jsonRpcSuccess(
              id,
              toolErrorEnvelope(err.message, err.details),
            );
          }
          const msg = err instanceof Error ? err.message : "tool execution failed";
          return jsonRpcError(id, -32603, "Internal error", { reason: msg });
        }
      }

      // 2. Tenta tool de SKILL (Track E via registry)
      if (findSkillTool(callParams.name)) {
        try {
          const data = await invokeTool(env, callParams.name, callParams.arguments);
          return jsonRpcSuccess(id, { content: data });
        } catch (err) {
          if (err instanceof ToolInputError) {
            return jsonRpcError(id, -32602, err.message, err.details);
          }
          if (err instanceof ToolExecutionError) {
            return jsonRpcError(id, -32603, err.message, err.details);
          }
          const message = err instanceof Error ? err.message : "Unknown error";
          return jsonRpcError(id, -32603, "Internal error", { reason: message });
        }
      }

      // 3. Tool não encontrada em nenhum registry
      return jsonRpcError(id, -32601, `Tool not found: ${callParams.name}`);
    }

    default: {
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  }
}

/**
 * Handler HTTP do endpoint `POST /mcp/v1`.
 */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      jsonRpcError(null, -32700, "Parse error: corpo da requisição não é JSON válido"),
      200,
    );
  }

  if (!isObjectLike(body)) {
    return jsonResponse(
      jsonRpcError(null, -32600, "Invalid Request: payload deve ser objeto JSON-RPC"),
      200,
    );
  }

  const rpcRequest = body as JsonRpcRequest;
  const id = extractId(rpcRequest.id ?? null);

  if (rpcRequest.jsonrpc !== "2.0") {
    return jsonResponse(
      jsonRpcError(id, -32600, "Invalid Request: campo 'jsonrpc' deve ser '2.0'"),
      200,
    );
  }

  if (typeof rpcRequest.method !== "string" || rpcRequest.method.length === 0) {
    return jsonResponse(
      jsonRpcError(id, -32600, "Invalid Request: campo 'method' obrigatório"),
      200,
    );
  }

  try {
    const result = await dispatch(rpcRequest.method, rpcRequest.params, id, env);
    return jsonResponse(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(
      jsonRpcError(id, -32603, "Internal error", { reason: message }),
      200,
    );
  }
}
