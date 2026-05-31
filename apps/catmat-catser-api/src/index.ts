/**
 * Worker dedicado da busca de catálogo CATMAT/CATSER (camada agêntica).
 *
 * Rotas:
 *   GET /health
 *   GET /api/catalogo/buscar?q=<termo>&tipo=<material|servico>&modo=<modo>&limit=<n>
 *
 * `modo`: `semantico` (default, híbrido 3-way + rerank) | `fuzzy` (trigram) |
 *         `grep` (FTS5 full-text). CORS aberto (consumido por vectorgov.io).
 */
import type { Env } from "./env.js";
import { TipoCatalogoSchema } from "@vectorgov-t/schemas";
import {
  buscarCatalogoFuzzy,
  buscarCatalogoHibrido,
  grepCatalogo,
} from "./lib/catalogo-search.js";
import { conversarCatalogo, type ChatMensagem } from "./lib/chat-engine.js";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Google-API-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

async function buscar(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return json({ error: "parâmetro 'q' (mín. 2 caracteres) é obrigatório" }, 400);
  }
  const tipoRaw = url.searchParams.get("tipo");
  const tp = tipoRaw ? TipoCatalogoSchema.safeParse(tipoRaw) : null;
  const tipo = tp?.success ? tp.data : undefined;

  const modo = url.searchParams.get("modo") ?? "semantico";
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 50)
    : 10;

  try {
    const resultado =
      modo === "fuzzy"
        ? await buscarCatalogoFuzzy(env, { padrao: q, tipo, max: limit })
        : modo === "grep"
          ? await grepCatalogo(env, { padrao: q, tipo, max: limit })
          : await buscarCatalogoHibrido(env, { descricao: q, tipo, top_k: limit });
    return json(resultado);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro na busca";
    return json({ error: `Falha na busca de catálogo: ${msg}` }, 500);
  }
}

async function chat(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get("X-Google-API-Key")?.trim();
  if (!apiKey) {
    return json({ error: "header X-Google-API-Key obrigatório" }, 401);
  }
  let body: { messages?: ChatMensagem[] };
  try {
    body = (await request.json()) as { messages?: ChatMensagem[] };
  } catch {
    return json({ error: "corpo JSON inválido" }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: "messages (array) obrigatório" }, 400);
  }
  try {
    return json(await conversarCatalogo(env, apiKey, body.messages));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro no chat";
    return json({ error: `chat falhou: ${msg}` }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "catmat-catser-api" });
    }
    if (request.method === "GET" && url.pathname === "/api/catalogo/buscar") {
      return buscar(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/catalogo/chat") {
      return chat(request, env);
    }
    return json({ error: "rota não encontrada" }, 404);
  },
};
