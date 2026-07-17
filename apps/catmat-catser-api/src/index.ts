/**
 * Worker dedicado da busca de catálogo CATMAT/CATSER (camada agêntica).
 *
 * Rotas:
 *   GET /health
 *   GET /api/catalogo/buscar?q=<termo>&tipo=<material|servico>&modo=<modo>&top_k=<n>
 *
 * `modo`: `hibrido` (default, 3-way + rerank Cohere; `semantico` é alias
 *         legado) | `fuzzy` (trigram) | `grep` (FTS5 full-text, AND-first).
 * `top_k` limita o resultado (1-50; `limit` é alias legado). CORS aberto
 * (consumido por vectorgov.io e pelo proxy do MCP comercial via service binding).
 */
import type { Env } from "./env.js";
import { TipoCatalogoSchema } from "@vectorgov-t/schemas";
import {
  buscarCatalogoFuzzy,
  buscarCatalogoHibrido,
  grepCatalogo,
} from "./lib/catalogo-search.js";
import { conversarCatalogo, type ChatMensagem } from "./lib/chat-engine.js";
import { adminRouter } from "./lib/catalogo-admin.js";
import { publicoRouter } from "./lib/catalogo-publico.js";

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

  // "semantico" segue aceito como alias de "hibrido" (consumidores antigos).
  const modo = url.searchParams.get("modo") ?? "hibrido";
  // `top_k` é o contrato; `limit` fica como alias legado.
  const topKRaw = Number.parseInt(
    url.searchParams.get("top_k") ?? url.searchParams.get("limit") ?? "",
    10,
  );
  const topK = Number.isFinite(topKRaw)
    ? Math.min(Math.max(topKRaw, 1), 50)
    : 10;
  // ativo=1 filtra só vendáveis; ausente = tudo (a interface vectorgov.io e
  // consumidores antigos seguem vendo tudo — quem quer só ativos passa ativo=1).
  const apenasAtivos = url.searchParams.get("ativo") === "1";

  try {
    const resultado =
      modo === "fuzzy"
        ? await buscarCatalogoFuzzy(env, { padrao: q, tipo, max: topK, apenasAtivos })
        : modo === "grep"
          ? await grepCatalogo(env, { padrao: q, tipo, max: topK, apenasAtivos })
          : await buscarCatalogoHibrido(env, { descricao: q, tipo, top_k: topK, apenasAtivos });
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
    // Rotas admin do inspetor ANTES do OPTIONS global: sem CORS por design
    // (consumidor é server-side; OPTIONS → 405 lá dentro).
    if (url.pathname.startsWith("/api/catalogo/admin/")) {
      return adminRouter(request, env);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "catmat-catser-api" });
    }
    if (request.method === "GET" && url.pathname === "/api/catalogo/buscar") {
      return buscar(request, env);
    }
    // Rotas públicas das tools do MCP comercial (grep/navegar/codigo) —
    // mesmo envelope/CORS do /buscar (SPEC-LOOP-TOOLS-CATALOGO-MCP §2).
    if (
      url.pathname === "/api/catalogo/grep" ||
      url.pathname === "/api/catalogo/navegar" ||
      url.pathname === "/api/catalogo/codigo"
    ) {
      return publicoRouter(request, env, json);
    }
    if (request.method === "POST" && url.pathname === "/api/catalogo/chat") {
      return chat(request, env);
    }
    return json({ error: "rota não encontrada" }, 404);
  },
};
