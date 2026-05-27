/**
 * Entry point do Worker — roteia HTTP, aplica middlewares e delega ao MCP.
 *
 * Rotas:
 *  - `GET  /health`                  → status simples + uptime + versão.
 *  - `GET  /version`                 → metadados do build (name, version, mcp_protocol).
 *  - `GET  /robots.txt`              → bloqueia indexação (endpoint não é público).
 *  - `POST /mcp/v1`                  → handler JSON-RPC do MCP.
 *  - `POST /ingestao/iniciar`        → dispara pipeline de ingestão (multipart).
 *  - `GET  /ingestao/status/:id`     → status de uma ingestão em andamento.
 *  - `OPTIONS *`                     → CORS preflight (sem rate-limit).
 *  - qualquer outro                  → 404.
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
import {
  handleIngestaoIniciar,
  handleIngestaoStatus,
} from "./pipeline/handlers.js";
import {
  handleGerarParecer,
  handleGetParecer,
  handlePeticaoStatus,
  handlePeticaoUpload,
} from "./api/peticoes.js";
import { handleListarHistorico } from "./api/historico.js";
import {
  handleCarregarSkill,
  handleListarSkills,
  handlePublicarSkill,
} from "./api/skills.js";

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
 *
 * O `ctx` é repassado quando o handler precisa agendar trabalho de
 * background (ex.: pipeline de ingestão via `ctx.waitUntil()`).
 */
async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
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

  if (request.method === "POST" && url.pathname === "/ingestao/iniciar") {
    return handleIngestaoIniciar(request, env, ctx);
  }

  if (request.method === "GET" && url.pathname.startsWith("/ingestao/status/")) {
    return handleIngestaoStatus(request, env);
  }

  // -----------------------------------------------------------------------
  // API REST consumida pela web-ui (Track H).
  // -----------------------------------------------------------------------
  if (request.method === "POST" && url.pathname === "/api/peticoes/upload") {
    return handlePeticaoUpload(request, env, ctx);
  }
  // GET /api/peticoes/:id/parecer
  if (
    request.method === "GET" &&
    /^\/api\/peticoes\/[^/]+\/parecer$/.test(url.pathname)
  ) {
    return handleGetParecer(request, env);
  }
  // POST /api/peticoes/:id/parecer
  if (
    request.method === "POST" &&
    /^\/api\/peticoes\/[^/]+\/parecer$/.test(url.pathname)
  ) {
    return handleGerarParecer(request, env);
  }
  // GET /api/peticoes/:id (sem /parecer)
  if (
    request.method === "GET" &&
    /^\/api\/peticoes\/[^/]+$/.test(url.pathname)
  ) {
    return handlePeticaoStatus(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/historico") {
    return handleListarHistorico(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/skills") {
    return handleListarSkills(request, env);
  }
  // POST /api/skills/:nome/publicar
  if (
    request.method === "POST" &&
    /^\/api\/skills\/[^/]+\/publicar$/.test(url.pathname)
  ) {
    return handlePublicarSkill(request, env);
  }
  // GET /api/skills/:nome
  if (
    request.method === "GET" &&
    /^\/api\/skills\/[^/]+$/.test(url.pathname)
  ) {
    return handleCarregarSkill(request, env);
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const limited = await enforceRateLimit(request, env);
      if (limited) {
        return withSecurity(limited);
      }
      const response = await route(request, env, ctx);
      return withSecurity(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal Server Error";
      return withSecurity(errorResponse(message, 500));
    }
  },
} satisfies ExportedHandler<Env>;
