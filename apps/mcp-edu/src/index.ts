/**
 * Entry point do Worker MCP dos ALUNOS — versão read-only enxuta.
 *
 * Expõe SOMENTE 6 tools de pesquisa (CATMAT/CATSER, preços, acórdãos TCU)
 * via `POST /mcp`. Sem rotas de ingestão/peticoes/notebooks/skills/config.
 *
 * Rotas:
 *  - `GET  /health`        → status + uptime.
 *  - `GET  /version`       → metadados do build.
 *  - `GET  /robots.txt`    → bloqueia indexação.
 *  - `POST /mcp` | `/mcp/v1` → handler JSON-RPC do MCP (6 tools).
 *  - `OPTIONS *`           → CORS preflight (sem rate-limit).
 *  - qualquer outro        → 404.
 *
 * Middleware: rate-limit por IP (proteção única — não há auth) → roteamento →
 * `withSecurity()` (CORS + security headers).
 *
 * Helpers (responses/security/rate-limit) são importados do
 * `@vectorgov-t/mcp-server` — fonte única, sem duplicar.
 */

import type { Env } from "../../mcp-server/src/env.js";
import { enforceRateLimit } from "../../mcp-server/src/lib/rate-limit.js";
import { corsHeaders, withSecurity } from "../../mcp-server/src/lib/security.js";
import { errorResponse, jsonResponse } from "../../mcp-server/src/lib/responses.js";
import { handleMcp } from "./mcp.js";

const SERVER_NAME = "@vectorgov-t/mcp-edu";
const SERVER_VERSION = "0.1.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";
const BUILD_DATE = "2026-06-15";

/**
 * Limites por IP para a turma — mais conservadores que o servidor completo,
 * para conter o custo de Workers AI (embeddings/rerank por busca).
 */
const RATE_LIMIT = { limitPerMinute: 30, limitPerDay: 1000 };

const BOOT_TIME_MS = Date.now();

function handlePreflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function handleHealth(): Response {
  return jsonResponse({
    status: "ok",
    uptime_seconds: Math.floor((Date.now() - BOOT_TIME_MS) / 1000),
    version: SERVER_VERSION,
  });
}

function handleVersion(): Response {
  return jsonResponse({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    mcp_protocol: MCP_PROTOCOL_VERSION,
    build_date: BUILD_DATE,
    tools: [
      "buscar_catalogo_semantico",
      "grep_catalogo",
      "consultar_precos_praticados",
      "buscar_acordaos_tcu",
      "buscar_acordaos_lexical",
      "listar_acordaos",
    ],
  });
}

function handleRobots(): Response {
  return new Response("User-agent: *\nDisallow: /\n", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return handlePreflight();
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return handleHealth();
  }
  if (request.method === "GET" && url.pathname === "/version") {
    return handleVersion();
  }
  if (request.method === "GET" && url.pathname === "/robots.txt") {
    return handleRobots();
  }
  if (
    request.method === "POST" &&
    (url.pathname === "/mcp/v1" || url.pathname === "/mcp")
  ) {
    return handleMcp(request, env);
  }

  return errorResponse("Not Found", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const limited = await enforceRateLimit(request, env, RATE_LIMIT);
      if (limited) {
        return withSecurity(limited);
      }
      const response = await route(request, env);
      return withSecurity(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal Server Error";
      return withSecurity(errorResponse(message, 500));
    }
  },
} satisfies ExportedHandler<Env>;
