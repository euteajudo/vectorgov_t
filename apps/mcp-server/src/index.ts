/**
 * Entry point do Worker — roteia HTTP, aplica middlewares e delega ao MCP.
 *
 * Rotas:
 *  - `GET  /health`     → status simples + uptime + versão.
 *  - `GET  /version`    → metadados do build (name, version, mcp_protocol).
 *  - `GET  /robots.txt` → bloqueia indexação (endpoint não é público).
 *  - `POST /mcp/v1`     → handler JSON-RPC do MCP.
 *  - `OPTIONS *`        → CORS preflight (sem rate-limit).
 *  - qualquer outro     → 404.
 *
 * Middleware aplicado:
 *  1. Rate limit (60 req/min/IP) — primeiro, para barrar abuso cedo.
 *  2. Roteamento HTTP.
 *  3. `withSecurity()` em cima da resposta final (CORS + security headers).
 */

import type { Env } from "./env.js";
import { handleMcp } from "./mcp/server.js";
import { enforceRateLimit } from "./lib/rate-limit.js";
import { corsHeaders, withSecurity } from "./lib/security.js";
import { errorResponse, jsonResponse } from "./lib/responses.js";

/**
 * Versão do servidor — bumpar manualmente em cada release até existir CI.
 */
const SERVER_NAME = "@vectorgov-t/mcp-server";
const SERVER_VERSION = "0.1.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";
const BUILD_DATE = "2026-05-26";

/**
 * Marca o instante de "boot" do isolate para reportar uptime em `/health`.
 * Por se tratar de Workers, esse valor reseta a cada cold start do isolate.
 */
const BOOT_TIME_MS = Date.now();

/**
 * Resposta de pre-flight CORS — usa 204 e ecoa os headers permitidos.
 */
function handlePreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

/**
 * Handler do `GET /health`.
 */
function handleHealth(): Response {
  return jsonResponse({
    status: "ok",
    uptime_seconds: Math.floor((Date.now() - BOOT_TIME_MS) / 1000),
    version: SERVER_VERSION,
  });
}

/**
 * Handler do `GET /version`.
 */
function handleVersion(): Response {
  return jsonResponse({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    mcp_protocol: MCP_PROTOCOL_VERSION,
    build_date: BUILD_DATE,
  });
}

/**
 * Handler do `GET /robots.txt` — bloqueia rastreadores.
 */
function handleRobots(): Response {
  return new Response("User-agent: *\nDisallow: /\n", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Roteador principal — `pathname` exato + método HTTP.
 *
 * Mantém o switch o mais "flat" possível: cada rota é um handler isolado
 * que devolve uma `Response`. Middleware (rate-limit, security) fica fora.
 */
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

  if (request.method === "POST" && url.pathname === "/mcp/v1") {
    return handleMcp(request, env);
  }

  return errorResponse("Not Found", 404);
}

/**
 * Default export do Worker — assinatura padrão Cloudflare.
 *
 * Ordem do fluxo:
 *  1. Rate-limit antes de qualquer trabalho.
 *  2. Roteamento.
 *  3. Wrap final em `withSecurity()`.
 *  4. Captura de exceções não tratadas → 500 com mensagem genérica.
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      const limited = await enforceRateLimit(request, env);
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
