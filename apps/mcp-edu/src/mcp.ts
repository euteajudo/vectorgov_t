/**
 * Handler MCP do servidor dos ALUNOS — JSON-RPC 2.0 com apenas 6 tools de
 * pesquisa (read-only). Reaproveita os `ToolDescriptor` e helpers do
 * `@vectorgov-t/mcp-server` por import direto — fonte única, sem duplicar.
 *
 * Diferença para o `mcp/server.ts` completo: catálogo fixo de 6 tools e SEM
 * o registry de skills (Track E). O dispatch só percorre o caminho de "lei".
 */

import type { Env } from "../../mcp-server/src/env.js";
import {
  jsonResponse,
  jsonRpcError,
  jsonRpcSuccess,
  type JsonRpcId,
} from "../../mcp-server/src/lib/responses.js";
import {
  ToolValidationError,
  type ToolDescriptor,
} from "../../mcp-server/src/mcp/tools/types.js";

// As 7 tools de pesquisa — importadas direto dos módulos de origem.
import { buscarLegislacaoTool } from "../../mcp-server/src/mcp/tools/semantic/buscar-legislacao.js";
import { buscarCatalogoSemanticoTool } from "../../mcp-server/src/mcp/tools/catalogo/buscar-catalogo-semantico.js";
import { grepCatalogoTool } from "../../mcp-server/src/mcp/tools/catalogo/grep-catalogo.js";
import { consultarPrecosPraticadosTool } from "../../mcp-server/src/mcp/tools/precos/consultar-precos-praticados.js";
import { buscarAcordaosTcuTool } from "../../mcp-server/src/mcp/tools/semantic/buscar-acordaos-tcu.js";
import { buscarAcordaosLexicalTool } from "../../mcp-server/src/mcp/tools/semantic/buscar-acordaos-lexical.js";
import { listarAcordaosTool } from "../../mcp-server/src/mcp/tools/semantic/listar-acordaos.js";

/**
 * Catálogo dos ALUNOS — ordem: legislação, catálogo, preços, acórdãos.
 */
const TOOLS: ToolDescriptor[] = [
  buscarLegislacaoTool,
  buscarCatalogoSemanticoTool,
  grepCatalogoTool,
  consultarPrecosPraticadosTool,
  buscarAcordaosTcuTool,
  buscarAcordaosLexicalTool,
  listarAcordaosTool,
];

const BY_NAME = new Map<string, ToolDescriptor>(
  TOOLS.map((t) => [t.name, t] as const),
);

const TOOLS_CATALOG = {
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
};

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface ToolsCallParams {
  name?: unknown;
  arguments?: unknown;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractId(raw: unknown): JsonRpcId {
  if (raw === null) return null;
  if (typeof raw === "string" || typeof raw === "number") return raw;
  return null;
}

/** Envelope MCP de sucesso — texto JSON, conforme spec. */
function toolEnvelope(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

/** Envelope MCP de erro (resultado "ok" com isError, conforme spec). */
function toolErrorEnvelope(message: string, details?: unknown) {
  const payload = details ? { error: message, details } : { error: message };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    isError: true,
  };
}

async function dispatch(
  method: string,
  params: unknown,
  id: JsonRpcId,
  env: Env,
) {
  switch (method) {
    case "initialize": {
      return jsonRpcSuccess(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "vectorgov-edu", version: "0.1.0" },
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled": {
      return jsonRpcSuccess(id, null);
    }

    case "tools/list": {
      return jsonRpcSuccess(id, TOOLS_CATALOG);
    }

    case "tools/call": {
      if (!isObjectLike(params)) {
        return jsonRpcError(id, -32602, "Invalid params: 'params' deve ser um objeto");
      }
      const callParams = params as ToolsCallParams;
      if (typeof callParams.name !== "string" || callParams.name.length === 0) {
        return jsonRpcError(id, -32602, "Invalid params: 'name' (string) é obrigatório");
      }

      const tool = BY_NAME.get(callParams.name);
      if (!tool) {
        return jsonRpcError(id, -32601, `Tool not found: ${callParams.name}`);
      }

      try {
        const args = callParams.arguments ?? {};
        const result = await tool.handler(args, env);
        return jsonRpcSuccess(id, toolEnvelope(result));
      } catch (err) {
        if (err instanceof ToolValidationError) {
          return jsonRpcSuccess(id, toolErrorEnvelope(err.message, err.details));
        }
        const msg = err instanceof Error ? err.message : "tool execution failed";
        return jsonRpcError(id, -32603, "Internal error", { reason: msg });
      }
    }

    default: {
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  }
}

/**
 * Handler HTTP do endpoint `POST /mcp` (e `/mcp/v1`).
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
    return jsonResponse(jsonRpcError(id, -32603, "Internal error", { reason: message }), 200);
  }
}
