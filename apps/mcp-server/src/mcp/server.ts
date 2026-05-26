/**
 * Handler MCP base — implementa o subset JSON-RPC 2.0 necessário
 * para `tools/list` e `tools/call`.
 *
 * Nesta fase (F1.C.2) o servidor apenas responde:
 *  - `tools/list` → `{ tools: [] }` (registro vazio; F2 adicionará tools).
 *  - `tools/call` → erro `-32601` ("Tool not found") porque ainda não há tools.
 *
 * Códigos de erro JSON-RPC seguidos:
 *  - `-32700` Parse error (corpo inválido).
 *  - `-32600` Invalid Request (envelope JSON-RPC ausente / malformado).
 *  - `-32601` Method not found (método não suportado ou tool inexistente).
 *  - `-32602` Invalid params (parâmetros faltando / mal tipados).
 *  - `-32603` Internal error (exceção inesperada do servidor).
 */

import type { Env } from "../env.js";
import {
  jsonResponse,
  jsonRpcError,
  jsonRpcSuccess,
  type JsonRpcId,
} from "../lib/responses.js";

/**
 * Estrutura mínima de uma requisição JSON-RPC 2.0.
 *
 * `id` é opcional na spec (omissão indica notificação), mas neste handler
 * tratamos qualquer requisição sem `id` como `null` para simplificar.
 */
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

/**
 * Resultado de `tools/list`. Futuro: array de descritores de tools com
 * `name`, `description` e `inputSchema` (JSON Schema).
 */
interface ToolsListResult {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
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
 * Type guard: verifica se o body parseado é um objeto não-array.
 */
function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extrai o ID da requisição de forma defensiva (sempre devolvendo
 * um `JsonRpcId` válido para que mesmo respostas de erro tenham `id`).
 */
function extractId(raw: unknown): JsonRpcId {
  if (raw === null) return null;
  if (typeof raw === "string" || typeof raw === "number") return raw;
  return null;
}

/**
 * Roteia o método JSON-RPC para o handler apropriado.
 *
 * Mantemos a tabela de métodos pequena e explícita: qualquer expansão
 * (notifications, ping, resources) deve adicionar um `case` aqui.
 */
async function dispatch(
  method: string,
  params: unknown,
  id: JsonRpcId,
  _env: Env,
): Promise<ReturnType<typeof jsonRpcSuccess> | ReturnType<typeof jsonRpcError>> {
  switch (method) {
    case "tools/list": {
      const result: ToolsListResult = { tools: [] };
      return jsonRpcSuccess(id, result);
    }
    case "tools/call": {
      // Validação mínima de params — protege contra payloads malformados
      // mesmo sem nenhuma tool cadastrada.
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
      // Nenhuma tool cadastrada ainda — F2 implementa o registry real.
      return jsonRpcError(
        id,
        -32601,
        `Tool not found: ${callParams.name}`,
      );
    }
    default: {
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  }
}

/**
 * Handler HTTP do endpoint `POST /mcp/v1`.
 *
 * Responsabilidades:
 *  1. Parsear o corpo JSON com tratamento de erro (-32700).
 *  2. Validar envelope JSON-RPC (-32600).
 *  3. Dispachar pelo método (-32601 quando desconhecido).
 *  4. Encapsular qualquer exceção como erro interno (-32603).
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
