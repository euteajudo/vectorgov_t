/**
 * Helpers para respostas HTTP e payloads JSON-RPC 2.0.
 *
 * Centralizar a montagem de respostas mantém os handlers HTTP enxutos
 * e garante consistência de Content-Type, status e envelope JSON-RPC.
 */

/**
 * IDs JSON-RPC podem ser string, número ou null (notificações).
 * Mantemos o mesmo tipo nas respostas para satisfazer a spec 2.0.
 */
export type JsonRpcId = string | number | null;

/**
 * Resposta JSON-RPC bem-sucedida (campo `result` obrigatório).
 */
export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: T;
}

/**
 * Resposta JSON-RPC de erro (campo `error` obrigatório).
 */
export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Envelope discriminado: pode ser sucesso OU erro, nunca ambos.
 */
export type JsonRpcResponse<T = unknown> =
  | JsonRpcSuccessResponse<T>
  | JsonRpcErrorResponse;

/**
 * Constrói uma Response JSON-padronizada (UTF-8, application/json).
 *
 * @param data - payload serializável (será passado por JSON.stringify).
 * @param status - status HTTP (default 200).
 * @param extraHeaders - headers adicionais que precisam acompanhar a resposta.
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

/**
 * Atalho para respostas de erro simples (não JSON-RPC).
 *
 * Útil em handlers HTTP puros (ex.: 404 de rota desconhecida).
 */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Monta o envelope JSON-RPC 2.0 de sucesso.
 */
export function jsonRpcSuccess<T>(
  id: JsonRpcId,
  result: T,
): JsonRpcSuccessResponse<T> {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Monta o envelope JSON-RPC 2.0 de erro com `code`/`message` obrigatórios.
 */
export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  const error: JsonRpcErrorResponse["error"] = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id, error };
}
