/**
 * Rotas admin do inspetor de catálogo (`/api/catalogo/admin/*`) —
 * SPEC-LOOP-MONITOR-CATALOGO, Fase 0.
 *
 * Regras herdadas da spec:
 *  - auth por `X-Catalogo-Admin-Key` (digest SHA-256 + comparação
 *    constant-time) ANTES de qualquer parsing; secret ausente → 503;
 *  - SEM CORS (nenhum header CORS; OPTIONS → 405) — o consumidor é um route
 *    handler server-side, nunca um browser;
 *  - leitura pura; binds sempre; tetos validados antes de tocar o D1;
 *  - erro de fornecedor nunca vaza stacktrace/corpo — mensagem neutra.
 */
import type { Env } from "../env.js";
import { TipoCatalogoSchema, type TipoCatalogo } from "@vectorgov-t/schemas";
import { buscarCatalogoHibrido, classeValida } from "./catalogo-search.js";

const LIMIT_MAX = 100;
const LANES_TOP_K_MAX = 20; // = PER_RANKER_TOP_K: pedir mais simularia outro algoritmo
const Q_MAX = 200;
const FACETAS_TOP = 200;
const TOTAL_CAP = 10_000;

function jsonAdmin(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, private",
    },
  });
}

// ============================================================================
// Auth
// ============================================================================

async function sha256(texto: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return new Uint8Array(buf);
}

/** Comparação constant-time sobre digests de mesmo tamanho (32 bytes). */
function digestsIguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** null = autorizado; Response = erro pronto (401/503). */
export async function validarChaveAdmin(
  env: Env,
  request: Request,
): Promise<Response | null> {
  const esperado = env.CATALOGO_ADMIN_KEY?.trim();
  if (!esperado) {
    return jsonAdmin({ error: "inspetor não configurado" }, 503);
  }
  const recebido = request.headers.get("X-Catalogo-Admin-Key") ?? "";
  const [dEsperado, dRecebido] = await Promise.all([
    sha256(esperado),
    sha256(recebido),
  ]);
  if (!digestsIguais(dEsperado, dRecebido)) {
    return jsonAdmin({ error: "não autorizado" }, 401);
  }
  return null;
}

// ============================================================================
// Filtros (padrão `*` → LIKE parametrizado) e cursor keyset
// ============================================================================

/**
 * Sem `*` no padrão → igualdade exata. Com `*` → LIKE com `ESCAPE '\'`:
 * `%`, `_` e `\` literais do padrão são escapados e cada `*` vira `%`.
 */
export function padraoParaSql(
  padrao: string,
): { op: "="; valor: string } | { op: "LIKE"; valor: string } {
  if (!padrao.includes("*")) return { op: "=", valor: padrao };
  const escapado = padrao
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return { op: "LIKE", valor: escapado.replace(/\*/g, "%") };
}

export interface FiltrosBrowse {
  tipo?: TipoCatalogo;
  ativo?: 0 | 1;
  grupo?: string;
  classe?: string;
  pdm?: string;
  desc?: string;
  ncm_prefix?: string;
  codigo_min?: number;
  codigo_max?: number;
}

const COLUNA_PADRAO: Record<string, string> = {
  grupo: "grupo",
  classe: "classe",
  pdm: "pdm",
  desc: "descricao",
};

export function montarWhere(f: FiltrosBrowse): {
  where: string;
  binds: unknown[];
} {
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (f.tipo) {
    conds.push("tipo = ?");
    binds.push(f.tipo);
  }
  if (f.ativo !== undefined) {
    conds.push("ativo = ?");
    binds.push(f.ativo);
  }
  for (const [param, coluna] of Object.entries(COLUNA_PADRAO)) {
    const v = (f as Record<string, unknown>)[param];
    if (typeof v !== "string" || v.length === 0) continue;
    const p = padraoParaSql(v);
    if (p.op === "=") {
      conds.push(`${coluna} = ?`);
      binds.push(p.valor);
    } else {
      conds.push(`${coluna} LIKE ? ESCAPE '\\'`);
      binds.push(p.valor);
    }
  }
  if (f.ncm_prefix) {
    const esc = f.ncm_prefix
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    conds.push("ncm LIKE ? ESCAPE '\\'");
    binds.push(`${esc}%`);
  }
  if (f.codigo_min !== undefined) {
    conds.push("codigo >= ?");
    binds.push(f.codigo_min);
  }
  if (f.codigo_max !== undefined) {
    conds.push("codigo <= ?");
    binds.push(f.codigo_max);
  }
  return { where: conds.length > 0 ? conds.join(" AND ") : "1=1", binds };
}

type Cursor = [orderVal: string | number, codigo: number, tipo: string];

export function encodeCursor(c: Cursor): string {
  const b = new TextEncoder().encode(JSON.stringify(c));
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [ov, codigo, tipo] = parsed as unknown[];
    if (typeof codigo !== "number" || typeof tipo !== "string") return null;
    if (typeof ov !== "string" && typeof ov !== "number") return null;
    return [ov, codigo, tipo];
  } catch {
    return null;
  }
}

// ============================================================================
// Handlers
// ============================================================================

async function handleStats(env: Env): Promise<Response> {
  const q = async (sql: string): Promise<Record<string, unknown>[]> => {
    const { results } = await env.DB.prepare(sql).all<Record<string, unknown>>();
    return results ?? [];
  };
  const [contagens, porTipo, frescor] = await Promise.all([
    q(
      "SELECT (SELECT COUNT(*) FROM catalogo_itens) AS itens, (SELECT COUNT(*) FROM catalogo_fts) AS fts, (SELECT COUNT(*) FROM catalogo_trgm) AS trgm",
    ),
    q(
      "SELECT tipo, COUNT(*) AS total, SUM(ativo) AS ativos FROM catalogo_itens GROUP BY tipo",
    ),
    q(
      "SELECT tipo, MAX(atualizado_em) AS max_atualizado_em FROM catalogo_itens GROUP BY tipo",
    ),
  ]);
  // catalogo_etl_state pode não existir antes da 0008 — estado vira null.
  let etl: Record<string, unknown> | null = null;
  let sondaOrfaos: Record<string, unknown> | null = null;
  try {
    const rows = await q(
      "SELECT run_id, executado_em, tipo, inseridos, atualizados, excluidos, modo, status, amostra_exclusoes FROM catalogo_etl_state ORDER BY executado_em DESC LIMIT 5",
    );
    etl = {
      runs: rows.map(({ amostra_exclusoes: _a, ...resto }) => resto),
    };
    // Sonda REAL de órfãos (spec §Fase 4): ids excluídos do D1 no último
    // apply que AINDA existem no índice semântico = órfãos confirmados.
    const comAmostra = rows.find(
      (r) =>
        r.modo === "apply" &&
        r.status === "ok" &&
        typeof r.amostra_exclusoes === "string" &&
        r.amostra_exclusoes.length > 2,
    );
    if (comAmostra) {
      try {
        const ids = (JSON.parse(String(comAmostra.amostra_exclusoes)) as unknown[])
          .filter((x): x is string => typeof x === "string")
          .slice(0, 50);
        if (ids.length > 0) {
          const vivos = await env.VECTORIZE_CATMAT.getByIds(ids);
          sondaOrfaos = {
            run_id: comAmostra.run_id,
            amostra: ids.length,
            orfaos_confirmados: (vivos ?? []).length,
            exemplos: (vivos ?? []).slice(0, 5).map((v) => v.id),
          };
        }
      } catch {
        sondaOrfaos = null;
      }
    }
  } catch {
    etl = null;
  }
  let indice: unknown;
  try {
    indice = await env.VECTORIZE_CATMAT.describe();
  } catch {
    indice = undefined;
  }
  const itens = Number((contagens[0] as { itens?: unknown })?.itens ?? 0);
  const vectorCount = Number(
    (indice as { vectorCount?: unknown } | undefined)?.vectorCount ?? NaN,
  );
  return jsonAdmin({
    d1: { ...contagens[0], por_tipo: porTipo, frescor },
    indice_semantico: indice,
    drift: Number.isFinite(vectorCount)
      ? { valor: vectorCount - itens, indicador_grosseiro: true }
      : null,
    etl,
    sonda_orfaos: sondaOrfaos,
  });
}

/**
 * Consulta de itens com keyset — COMPARTILHADA entre a rota admin (browse)
 * e a rota pública `navegar` da tool do MCP (SPEC-LOOP-TOOLS-CATALOGO-MCP).
 */
export async function consultarItens(
  env: Env,
  opts: {
    filtros: FiltrosBrowse;
    order: "codigo" | "atualizado_em";
    cursor?: string | null;
    limit: number;
  },
): Promise<
  | {
      ok: true;
      itens: Record<string, unknown>[];
      total: number;
      total_capado: boolean;
      next_cursor: string | null;
      order: string;
    }
  | { ok: false; erro: string }
> {
  const { filtros, order, limit } = opts;
  const { where, binds } = montarWhere(filtros);

  // Ordenação TOTAL (order, codigo, tipo) + cursor keyset — sem OFFSET.
  const orderExpr =
    order === "codigo" ? "codigo, tipo" : "IFNULL(atualizado_em,''), codigo, tipo";
  const tupla =
    order === "codigo"
      ? "(codigo, tipo)"
      : "(IFNULL(atualizado_em,''), codigo, tipo)";
  let cursorCond = "";
  const cursorBinds: unknown[] = [];
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (!c) return { ok: false, erro: "cursor inválido" };
    if (order === "codigo") {
      cursorCond = " AND (codigo, tipo) > (?, ?)";
      cursorBinds.push(c[1], c[2]);
    } else {
      cursorCond = ` AND ${tupla} > (?, ?, ?)`;
      cursorBinds.push(c[0], c[1], c[2]);
    }
  }
  const sql = `SELECT id, codigo, tipo, descricao, grupo, classe, pdm, ncm, ativo, atualizado_em
    FROM catalogo_itens WHERE ${where}${cursorCond}
    ORDER BY ${orderExpr} LIMIT ?`;
  const { results } = await env.DB.prepare(sql)
    .bind(...binds, ...cursorBinds, limit)
    .all<Record<string, unknown>>();
  const rows = results ?? [];

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT 1 FROM catalogo_itens WHERE ${where} LIMIT ${TOTAL_CAP + 1})`,
  )
    .bind(...binds)
    .first<{ n: number }>();
  const n = totalRow?.n ?? 0;

  let next_cursor: string | null = null;
  if (rows.length === limit) {
    const ult = rows[rows.length - 1] as {
      codigo: number;
      tipo: string;
      atualizado_em: string | null;
    };
    next_cursor = encodeCursor([
      order === "codigo" ? ult.codigo : (ult.atualizado_em ?? ""),
      ult.codigo,
      ult.tipo,
    ]);
  }
  return {
    ok: true,
    itens: rows,
    total: Math.min(n, TOTAL_CAP),
    total_capado: n > TOTAL_CAP,
    next_cursor,
    order,
  };
}

const COLUNAS_DIM: Record<string, string> = {
  grupo: "grupo",
  classe: "classe",
  pdm: "pdm",
  ncm: "ncm",
};

/** Facetas (valores distintos + contagens) — compartilhada admin/pública. */
export async function consultarFacetas(
  env: Env,
  opts: { dim: string; filtros: FiltrosBrowse },
): Promise<
  | { ok: true; dim: string; facetas: Record<string, unknown>[]; distintos_total: number }
  | { ok: false; erro: string }
> {
  const coluna = COLUNAS_DIM[opts.dim];
  if (!coluna) return { ok: false, erro: "dim deve ser grupo|classe|pdm|ncm" };
  const { where, binds } = montarWhere(opts.filtros);
  const [{ results: facetas }, distintos] = await Promise.all([
    env.DB.prepare(
      `SELECT ${coluna} AS valor, COUNT(*) AS n FROM catalogo_itens
       WHERE ${where} AND ${coluna} IS NOT NULL
       GROUP BY ${coluna} ORDER BY n DESC, valor ASC LIMIT ${FACETAS_TOP}`,
    )
      .bind(...binds)
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT ${coluna}) AS n FROM catalogo_itens WHERE ${where} AND ${coluna} IS NOT NULL`,
    )
      .bind(...binds)
      .first<{ n: number }>(),
  ]);
  return {
    ok: true,
    dim: opts.dim,
    facetas: facetas ?? [],
    distintos_total: distintos?.n ?? 0,
  };
}

async function handleBrowse(env: Env, url: URL): Promise<Response> {
  const filtros = lerFiltros(url);
  if (filtros instanceof Response) return filtros;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? 50 : Number.parseInt(limitRaw, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) {
    return jsonAdmin({ error: `limit deve estar entre 1 e ${LIMIT_MAX}` }, 400);
  }
  const order = url.searchParams.get("order") ?? "codigo";
  if (order !== "codigo" && order !== "atualizado_em") {
    return jsonAdmin({ error: "order deve ser codigo|atualizado_em" }, 400);
  }
  const r = await consultarItens(env, {
    filtros,
    order,
    cursor: url.searchParams.get("cursor"),
    limit,
  });
  if (!r.ok) return jsonAdmin({ error: r.erro }, 400);
  const { ok: _ok, ...corpo } = r;
  return jsonAdmin(corpo);
}

async function handleFacetas(env: Env, url: URL): Promise<Response> {
  const filtros = lerFiltros(url);
  if (filtros instanceof Response) return filtros;
  const r = await consultarFacetas(env, {
    dim: url.searchParams.get("dim") ?? "",
    filtros,
  });
  if (!r.ok) return jsonAdmin({ error: r.erro }, 400);
  const { ok: _ok, ...corpo } = r;
  return jsonAdmin(corpo);
}

/** Reconstrói o texto de embed pela regra ATUAL do ETL — rotulado na resposta. */
export function reconstruirTextoEmbed(d: {
  descricao: string;
  pdm: string | null;
  classe: string | null;
}): string {
  let t = d.descricao;
  const pdm = d.pdm?.trim();
  if (pdm) t += ` (${pdm})`;
  if (classeValida(d.classe)) t += ` [${d.classe!.trim()}]`;
  return t;
}

const CAMPOS_DIFF = [
  "codigo",
  "tipo",
  "descricao",
  "grupo",
  "classe",
  "pdm",
  "ncm",
  "ativo",
] as const;

async function handleItem(env: Env, url: URL): Promise<Response> {
  const codigo = Number.parseInt(url.searchParams.get("codigo") ?? "", 10);
  const tp = TipoCatalogoSchema.safeParse(url.searchParams.get("tipo"));
  if (!Number.isInteger(codigo) || codigo <= 0 || !tp.success) {
    return jsonAdmin(
      { error: "codigo (inteiro positivo) e tipo (material|servico) obrigatórios" },
      400,
    );
  }
  const id = `cat-${tp.data}-${codigo}`;
  const row = await env.DB.prepare(
    "SELECT id, codigo, tipo, descricao, grupo, classe, pdm, ncm, ativo, atualizado_em FROM catalogo_itens WHERE id = ?",
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) {
    return jsonAdmin({ id, encontrado: false }, 404);
  }

  // Presença nas tabelas-sombra: varredura única sobre coluna UNINDEXED —
  // admitida em chamada admin unitária, PROIBIDA em loops (ver spec §3.4).
  const [fts, trgm] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM catalogo_fts WHERE catalogo_id = ?")
      .bind(id)
      .first<{ n: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM catalogo_trgm WHERE catalogo_id = ?",
    )
      .bind(id)
      .first<{ n: number }>(),
  ]);

  let vetor: { existe: boolean; metadata?: Record<string, unknown> } = {
    existe: false,
  };
  try {
    const got = await env.VECTORIZE_CATMAT.getByIds([id]);
    const v = got?.[0];
    if (v) {
      vetor = {
        existe: true,
        metadata: (v.metadata ?? {}) as Record<string, unknown>,
      };
    }
  } catch {
    vetor = { existe: false };
  }

  // Diff D1 × metadata congelada no embed (normalizações do embed.mjs:
  // descricao ≤400, pdm ≤120, ativo 0/1, ncm "" quando nulo).
  const diffs: Array<{ campo: string; d1: unknown; vetor: unknown }> = [];
  if (vetor.existe && vetor.metadata) {
    const norm: Record<string, unknown> = {
      codigo: row.codigo,
      tipo: row.tipo,
      descricao: String(row.descricao ?? "").slice(0, 400),
      grupo: row.grupo ?? "",
      classe: row.classe ?? "",
      pdm: String(row.pdm ?? "").slice(0, 120),
      ncm: row.ncm ?? "",
      ativo: row.ativo === 0 ? 0 : 1,
    };
    for (const campo of CAMPOS_DIFF) {
      const meta = vetor.metadata[campo];
      if (meta !== undefined && meta !== norm[campo]) {
        diffs.push({ campo, d1: norm[campo], vetor: meta });
      }
    }
  }

  return jsonAdmin({
    id,
    encontrado: true,
    d1: row,
    indices_lexicais: { fts: (fts?.n ?? 0) > 0, trgm: (trgm?.n ?? 0) > 0 },
    vetor: { ...vetor, divergencias: diffs },
    texto_embed_reconstruido: reconstruirTextoEmbed({
      descricao: String(row.descricao ?? ""),
      pdm: (row.pdm as string | null) ?? null,
      classe: (row.classe as string | null) ?? null,
    }),
    aviso_texto_embed:
      "reconstruído pela regra ATUAL do ETL — não prova o que foi embedado (ver embed_text_hash quando disponível)",
  });
}

async function handleLanes(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return jsonAdmin({ error: "q (mín. 2 chars) obrigatório" }, 400);
  if (q.length > Q_MAX) {
    return jsonAdmin({ error: `q excede o teto de ${Q_MAX} caracteres` }, 400);
  }
  const tipoRaw = url.searchParams.get("tipo");
  const tp = tipoRaw ? TipoCatalogoSchema.safeParse(tipoRaw) : null;
  if (tipoRaw && !tp?.success) {
    return jsonAdmin({ error: "tipo deve ser material|servico" }, 400);
  }
  const topKRaw = url.searchParams.get("top_k");
  const topK = topKRaw === null ? 10 : Number.parseInt(topKRaw, 10);
  if (!Number.isInteger(topK) || topK < 1 || topK > LANES_TOP_K_MAX) {
    return jsonAdmin(
      { error: `top_k deve estar entre 1 e ${LANES_TOP_K_MAX} (= pool de candidatos)` },
      400,
    );
  }
  try {
    const r = await buscarCatalogoHibrido(
      env,
      { descricao: q, tipo: tp?.success ? tp.data : undefined, top_k: topK },
      { trace: true },
    );
    const { trace, ...publico } = r;
    return jsonAdmin({
      requested_top_k: topK,
      effective_result_limit: topK,
      candidate_pool_size: LANES_TOP_K_MAX,
      public_result: publico,
      trace,
    });
  } catch {
    return jsonAdmin({ error: "falha na execução da busca" }, 500);
  }
}

function lerFiltros(url: URL): FiltrosBrowse | Response {
  const f: FiltrosBrowse = {};
  const tipoRaw = url.searchParams.get("tipo");
  if (tipoRaw) {
    const tp = TipoCatalogoSchema.safeParse(tipoRaw);
    if (!tp.success) return jsonAdmin({ error: "tipo deve ser material|servico" }, 400);
    f.tipo = tp.data;
  }
  const ativoRaw = url.searchParams.get("ativo");
  if (ativoRaw !== null) {
    if (ativoRaw !== "0" && ativoRaw !== "1") {
      return jsonAdmin({ error: "ativo deve ser 0|1" }, 400);
    }
    f.ativo = ativoRaw === "1" ? 1 : 0;
  }
  for (const p of ["grupo", "classe", "pdm", "desc", "ncm_prefix"] as const) {
    const v = url.searchParams.get(p);
    if (v === null) continue;
    if (v.length === 0 || v.length > Q_MAX) {
      return jsonAdmin({ error: `${p} deve ter 1-${Q_MAX} caracteres` }, 400);
    }
    f[p] = v;
  }
  for (const p of ["codigo_min", "codigo_max"] as const) {
    const v = url.searchParams.get(p);
    if (v === null) continue;
    const n = Number.parseInt(v, 10);
    if (!Number.isInteger(n) || n < 0) {
      return jsonAdmin({ error: `${p} deve ser inteiro ≥ 0` }, 400);
    }
    f[p] = n;
  }
  return f;
}

// ============================================================================
// Router admin
// ============================================================================

export async function adminRouter(request: Request, env: Env): Promise<Response> {
  // OPTIONS → 405 sem CORS: rotas admin não são para browsers.
  if (request.method === "OPTIONS") {
    return jsonAdmin({ error: "método não permitido" }, 405);
  }
  if (request.method !== "GET") {
    return jsonAdmin({ error: "método não permitido" }, 405);
  }
  const erroAuth = await validarChaveAdmin(env, request);
  if (erroAuth) return erroAuth;

  const url = new URL(request.url);
  const rota = url.pathname.replace(/^\/api\/catalogo\/admin\//, "");
  try {
    switch (rota) {
      case "stats":
        return await handleStats(env);
      case "browse":
        return await handleBrowse(env, url);
      case "facetas":
        return await handleFacetas(env, url);
      case "item":
        return await handleItem(env, url);
      case "lanes":
        return await handleLanes(env, url);
      default:
        return jsonAdmin({ error: "rota não encontrada" }, 404);
    }
  } catch {
    // Mensagem neutra — nunca stacktrace/corpo de fornecedor.
    return jsonAdmin({ error: "erro interno do inspetor" }, 500);
  }
}
