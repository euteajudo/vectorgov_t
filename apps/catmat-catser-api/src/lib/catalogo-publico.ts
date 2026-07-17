/**
 * Rotas públicas das tools de catálogo do MCP comercial
 * (SPEC-LOOP-TOOLS-CATALOGO-MCP §2) — read-only, mesmos tetos e CORS do
 * `/buscar`, consumidas via service binding pelo `vectorgov-mcp-comercial-v1`:
 *
 *   GET /api/catalogo/grep     — lexical em cascata SINALIZADA (exata→ampla→aproximada)
 *   GET /api/catalogo/navegar  — facetas (dim=...) OU itens filtrados com cursor keyset
 *   GET /api/catalogo/codigo   — fichas por código (batch 1-20, 1 chamada)
 *
 * Reusa as queries validadas pelo LOOP-MONITOR (consultarItens/consultarFacetas)
 * e o motor de busca (grepCatalogoCascata) — nenhuma lógica nova de ranking aqui.
 */
import type { Env } from "../env.js";
import { TipoCatalogoSchema, type TipoCatalogo } from "@vectorgov-t/schemas";
import { grepCatalogoCascata } from "./catalogo-search.js";
import {
  consultarFacetas,
  consultarItens,
  type FiltrosBrowse,
} from "./catalogo-admin.js";

const Q_MAX = 200;
const GREP_TOP_K_MAX = 20;
const NAVEGAR_LIMIT_MAX = 50;
const CODIGO_BATCH_MAX = 20;

type RespostaJson = (data: unknown, status?: number) => Response;

function lerTipo(url: URL): TipoCatalogo | undefined | Response {
  const raw = url.searchParams.get("tipo");
  if (!raw) return undefined;
  const tp = TipoCatalogoSchema.safeParse(raw);
  if (!tp.success) return new Response(null, { status: 400 });
  return tp.data;
}

async function handleGrep(env: Env, url: URL, json: RespostaJson): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > Q_MAX) {
    return json({ error: `parâmetro 'q' (2-${Q_MAX} caracteres) é obrigatório` }, 400);
  }
  const tipo = lerTipo(url);
  if (tipo instanceof Response) {
    return json({ error: "tipo deve ser material|servico" }, 400);
  }
  const topKRaw = url.searchParams.get("top_k");
  const topK = topKRaw === null ? 10 : Number.parseInt(topKRaw, 10);
  if (!Number.isInteger(topK) || topK < 1 || topK > GREP_TOP_K_MAX) {
    return json({ error: `top_k deve estar entre 1 e ${GREP_TOP_K_MAX}` }, 400);
  }
  // ativo=1 (só vendáveis) quando o chamador pedir; ausente = tudo (neutro).
  const apenasAtivos = url.searchParams.get("ativo") === "1";
  return json(await grepCatalogoCascata(env, { padrao: q, tipo, max: topK, apenasAtivos }));
}

/** Filtros aceitos na rota pública — espelho do contrato do browse admin. */
function lerFiltrosPublicos(url: URL): FiltrosBrowse | Response {
  const f: FiltrosBrowse = {};
  const tipo = lerTipo(url);
  if (tipo instanceof Response) return tipo;
  if (tipo) f.tipo = tipo;
  const ativoRaw = url.searchParams.get("ativo");
  if (ativoRaw !== null) {
    if (ativoRaw !== "0" && ativoRaw !== "1") return new Response(null, { status: 400 });
    f.ativo = ativoRaw === "1" ? 1 : 0;
  }
  for (const p of ["grupo", "classe", "pdm", "desc", "ncm_prefix"] as const) {
    const v = url.searchParams.get(p);
    if (v === null) continue;
    if (v.length === 0 || v.length > Q_MAX) return new Response(null, { status: 400 });
    f[p] = v;
  }
  return f;
}

async function handleNavegar(env: Env, url: URL, json: RespostaJson): Promise<Response> {
  const filtros = lerFiltrosPublicos(url);
  if (filtros instanceof Response) {
    return json({ error: "filtro inválido (tipo material|servico; ativo 0|1; padrões 1-200 chars)" }, 400);
  }
  const dim = url.searchParams.get("dim");
  if (dim) {
    const r = await consultarFacetas(env, { dim, filtros });
    if (!r.ok) return json({ error: r.erro }, 400);
    const { ok: _ok, ...corpo } = r;
    return json({ modo: "navegar", ...corpo });
  }
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? 20 : Number.parseInt(limitRaw, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > NAVEGAR_LIMIT_MAX) {
    return json({ error: `limit deve estar entre 1 e ${NAVEGAR_LIMIT_MAX}` }, 400);
  }
  const r = await consultarItens(env, {
    filtros,
    order: "codigo",
    cursor: url.searchParams.get("cursor"),
    limit,
  });
  if (!r.ok) return json({ error: r.erro }, 400);
  const { ok: _ok, order: _order, ...corpo } = r;
  return json({ modo: "navegar", ...corpo });
}

async function handleCodigo(env: Env, url: URL, json: RespostaJson): Promise<Response> {
  const tp = TipoCatalogoSchema.safeParse(url.searchParams.get("tipo"));
  if (!tp.success) {
    return json({ error: "tipo (material|servico) é obrigatório" }, 400);
  }
  const brutos = (url.searchParams.get("codigos") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (brutos.length < 1 || brutos.length > CODIGO_BATCH_MAX) {
    return json({ error: `codigos deve ter 1-${CODIGO_BATCH_MAX} códigos (CSV)` }, 400);
  }
  const codigos: number[] = [];
  for (const c of brutos) {
    const n = Number.parseInt(c, 10);
    if (!Number.isInteger(n) || n <= 0 || String(n) !== c) {
      return json({ error: `código inválido: ${c.slice(0, 20)}` }, 400);
    }
    codigos.push(n);
  }
  const ids = codigos.map((c) => `cat-${tp.data}-${c}`);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT id, codigo, tipo, descricao, grupo, classe, pdm, ncm, ativo, atualizado_em
       FROM catalogo_itens WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<Record<string, unknown>>();
  const porCodigo = new Map((results ?? []).map((r) => [Number(r.codigo), r]));
  // Ordem do pedido preservada; ausente NÃO derruba o lote.
  const itens = codigos.map((c) => {
    const row = porCodigo.get(c);
    return row
      ? { encontrado: true, ...row, ativo: row.ativo !== 0 }
      : { encontrado: false, codigo: c, tipo: tp.data };
  });
  return json({ modo: "codigo", total: itens.length, itens });
}

/**
 * Router das rotas públicas das tools. `json` vem do index (mantém o MESMO
 * envelope/CORS do `/buscar` — superfície pública única e consistente).
 */
export async function publicoRouter(
  request: Request,
  env: Env,
  json: RespostaJson,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return json({ error: "método não permitido" }, 405);
  }
  try {
    switch (url.pathname) {
      case "/api/catalogo/grep":
        return await handleGrep(env, url, json);
      case "/api/catalogo/navegar":
        return await handleNavegar(env, url, json);
      case "/api/catalogo/codigo":
        return await handleCodigo(env, url, json);
      default:
        return json({ error: "rota não encontrada" }, 404);
    }
  } catch (err) {
    // O detalhe (nomes de tabela/índice/infra) vai só para o log; o cliente
    // recebe mensagem genérica + id de correlação (achado P2 da review).
    const correlacao = crypto.randomUUID();
    console.error(
      JSON.stringify({
        evento: "catalogo_publico_erro",
        correlacao,
        rota: url.pathname,
        detalhe: err instanceof Error ? err.message : String(err),
      }),
    );
    return json(
      {
        error: "Falha temporária na consulta de catálogo. Tente novamente.",
        correlacao,
      },
      500,
    );
  }
}
