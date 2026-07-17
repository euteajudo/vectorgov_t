/**
 * Rotas admin do inspetor (SPEC-LOOP-MONITOR-CATALOGO, Fase 0):
 * auth timing-safe, 503 sem secret, OPTIONS→405 sem CORS, tetos,
 * escape de LIKE, cursor keyset e raio-X do item com diff D1×metadata.
 *
 * Testa o adminRouter direto (não o index.ts): importar o index puxa o
 * chat-engine, que importa skills .md via Rules do wrangler — o vitest não
 * transforma. O wiring index→adminRouter é coberto pelo curl de fumaça da
 * Fase 0 em produção.
 */
import { describe, expect, it } from "vitest";
import {
  adminRouter,
  decodeCursor,
  encodeCursor,
  montarWhere,
  padraoParaSql,
} from "../src/lib/catalogo-admin.js";
import {
  createFakeAi,
  createFakeD1,
  createFakeVectorize,
  createTestEnv,
  type RegraD1,
} from "./_fakes.js";

const KEY = "chave-teste-do-inspetor";
const BASE = "https://x.example/api/catalogo/admin";

function req(path: string, opts: { key?: string; method?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.key) headers["X-Catalogo-Admin-Key"] = opts.key;
  return new Request(`${BASE}/${path}`, { method: opts.method ?? "GET", headers });
}

function envAdmin(regras: RegraD1[] = [], overrides: Record<string, unknown> = {}) {
  return createTestEnv({
    CATALOGO_ADMIN_KEY: KEY,
    DB: createFakeD1({ regras }),
    VECTORIZE_CATMAT: createFakeVectorize({}),
    AI: createFakeAi(),
    ...overrides,
  });
}

describe("auth das rotas admin", () => {
  const rotas = ["stats", "browse", "facetas?dim=pdm", "item?codigo=1&tipo=material", "lanes?q=abc"];

  it("sem key → 401 em todas as rotas", async () => {
    for (const r of rotas) {
      const res = await adminRouter(req(r), envAdmin());
      expect(res.status, r).toBe(401);
    }
  });

  it("key errada → 401", async () => {
    const res = await adminRouter(req("stats", { key: "errada" }), envAdmin());
    expect(res.status).toBe(401);
  });

  it("secret ausente no worker → 503 (distingue setup de key errada)", async () => {
    const env = createTestEnv({ DB: createFakeD1({ regras: [] }) });
    const res = await adminRouter(req("stats", { key: KEY }), env);
    expect(res.status).toBe(503);
  });

  it("OPTIONS → 405 e SEM headers CORS", async () => {
    const res = await adminRouter(req("stats", { method: "OPTIONS" }), envAdmin());
    expect(res.status).toBe(405);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("respostas admin levam Cache-Control no-store e nunca CORS", async () => {
    const res = await adminRouter(req("stats", { key: KEY }), envAdmin());
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("tetos e validação de entrada", () => {
  it("lanes: top_k > 20 → 400 (pool de candidatos é 20)", async () => {
    const res = await adminRouter(req("lanes?q=parafuso&top_k=21", { key: KEY }), envAdmin());
    expect(res.status).toBe(400);
  });

  it("lanes: q longa (>200) → 400; q curta → 400", async () => {
    const longa = "a".repeat(201);
    expect((await adminRouter(req(`lanes?q=${longa}`, { key: KEY }), envAdmin())).status).toBe(400);
    expect((await adminRouter(req("lanes?q=a", { key: KEY }), envAdmin())).status).toBe(400);
  });

  it("browse: limit > 100 → 400; cursor inválido → 400; order desconhecido → 400", async () => {
    expect((await adminRouter(req("browse?limit=101", { key: KEY }), envAdmin())).status).toBe(400);
    expect((await adminRouter(req("browse?cursor=%%%", { key: KEY }), envAdmin())).status).toBe(400);
    expect((await adminRouter(req("browse?order=rowid", { key: KEY }), envAdmin())).status).toBe(400);
  });

  it("facetas: dim fora da whitelist → 400", async () => {
    const res = await adminRouter(req("facetas?dim=descricao", { key: KEY }), envAdmin());
    expect(res.status).toBe(400);
  });
});

describe("padrão `*` → LIKE com escape", () => {
  it("sem `*` vira igualdade exata", () => {
    expect(padraoParaSql("LIMPEZA")).toEqual({ op: "=", valor: "LIMPEZA" });
  });

  it("`*` vira % e metacaracteres literais são escapados", () => {
    expect(padraoParaSql("*LIMPEZA*")).toEqual({ op: "LIKE", valor: "%LIMPEZA%" });
    expect(padraoParaSql("*100%_A\\B*")).toEqual({
      op: "LIKE",
      valor: "%100\\%\\_A\\\\B%",
    });
  });

  it("montarWhere combina filtros com binds (nunca interpola)", () => {
    const { where, binds } = montarWhere({
      tipo: "servico",
      ativo: 1,
      classe: "*LIMPEZA*",
    });
    expect(where).toBe("tipo = ? AND ativo = ? AND classe LIKE ? ESCAPE '\\'");
    expect(binds).toEqual(["servico", 1, "%LIMPEZA%"]);
  });
});

describe("cursor keyset", () => {
  it("roundtrip encode/decode", () => {
    const c: [string, number, string] = ["2026-01-01T00:00:00", 98191, "material"];
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("decode rejeita lixo e formatos errados", () => {
    expect(decodeCursor("nao-e-base64!!")).toBeNull();
    expect(decodeCursor(encodeCursor(["x", 1, "material"]).slice(0, 4))).toBeNull();
  });
});

describe("raio-X do item", () => {
  const ROW = {
    id: "cat-servico-3999",
    codigo: 3999,
    tipo: "servico",
    descricao: 'LIMPEZA E CONSERVACAO PREDIAL "INATIVO"',
    grupo: "OUTROS",
    classe: "OUTROS",
    pdm: null,
    ncm: null,
    ativo: 0,
    atualizado_em: "2026-01-01T00:00:00",
  };

  function envItem() {
    return envAdmin(
      [
        { match: "FROM catalogo_itens WHERE id = ?", rows: [ROW] },
        { match: "FROM catalogo_fts WHERE catalogo_id", rows: [{ n: 1 }] },
        { match: "FROM catalogo_trgm WHERE catalogo_id", rows: [{ n: 1 }] },
      ],
      {
        VECTORIZE_CATMAT: createFakeVectorize({
          byId: {
            "cat-servico-3999": {
              // metadata congelada no embed diz ativo=1 — D1 (verdade) diz 0.
              metadata: { codigo: 3999, tipo: "servico", ativo: 1 },
            },
          },
        }),
      },
    );
  }

  it("diff D1×metadata aponta o campo divergente (ativo)", async () => {
    const res = await adminRouter(
      req("item?codigo=3999&tipo=servico", { key: KEY }),
      envItem(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      encontrado: boolean;
      indices_lexicais: { fts: boolean; trgm: boolean };
      vetor: { existe: boolean; divergencias: Array<{ campo: string }> };
      aviso_texto_embed: string;
    };
    expect(body.encontrado).toBe(true);
    expect(body.indices_lexicais).toEqual({ fts: true, trgm: true });
    expect(body.vetor.existe).toBe(true);
    expect(body.vetor.divergencias.map((d) => d.campo)).toContain("ativo");
    expect(body.aviso_texto_embed).toContain("reconstruído");
  });

  it("código inexistente → 404 com corpo limpo", async () => {
    const res = await adminRouter(
      req("item?codigo=999999&tipo=material", { key: KEY }),
      envAdmin([{ match: "FROM catalogo_itens WHERE id = ?", rows: [] }]),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { encontrado: boolean };
    expect(body.encontrado).toBe(false);
  });
});

describe("sonda de órfãos no stats (Fase 4)", () => {
  it("id excluído do D1 mas vivo no índice semântico = órfão confirmado", async () => {
    const env = envAdmin(
      [
        {
          match: "FROM catalogo_etl_state",
          rows: [
            {
              run_id: "123",
              executado_em: "2026-07-17T12:00:00Z",
              tipo: "catalogo",
              inseridos: 1,
              atualizados: 2,
              excluidos: 2,
              modo: "apply",
              status: "ok",
              amostra_exclusoes: '["cat-material-999","cat-servico-1"]',
            },
          ],
        },
      ],
      {
        VECTORIZE_CATMAT: createFakeVectorize({
          // cat-material-999 ainda existe no índice (órfão); cat-servico-1 não.
          byId: { "cat-material-999": { metadata: {} } },
        }),
      },
    );
    const res = await adminRouter(req("stats", { key: KEY }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sonda_orfaos: { amostra: number; orfaos_confirmados: number; exemplos: string[] } | null;
      etl: { runs: Array<Record<string, unknown>> };
    };
    expect(body.sonda_orfaos).not.toBeNull();
    expect(body.sonda_orfaos!.amostra).toBe(2);
    expect(body.sonda_orfaos!.orfaos_confirmados).toBe(1);
    expect(body.sonda_orfaos!.exemplos).toEqual(["cat-material-999"]);
    // a amostra bruta NÃO vaza na lista de runs
    expect("amostra_exclusoes" in (body.etl.runs[0] ?? {})).toBe(false);
  });
});

describe("lanes (via executor com trace)", () => {
  it("responde requested/effective/pool + public_result + trace", async () => {
    const LINHA = {
      catalogo_id: "cat-material-1",
      codigo: 1,
      tipo: "material",
      descricao: "PARAFUSO AÇO",
      grupo: "G",
      classe: "C",
      pdm: null,
      ncm: null,
      ativo: 1,
      rank: -1.0,
    };
    const env = envAdmin(
      [
        { match: "catalogo_fts", rows: [LINHA] },
        { match: "catalogo_trgm", rows: [] },
      ],
      {
        VECTORIZE_CATMAT: createFakeVectorize({
          matches: [{ id: "cat-material-1", score: 0.9, metadata: {} }],
        }),
      },
    );
    const res = await adminRouter(req("lanes?q=parafuso&top_k=5", { key: KEY }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requested_top_k: number;
      candidate_pool_size: number;
      public_result: { modo: string; itens: unknown[] };
      trace: { rrf_k: number; lanes: Record<string, { status: string }> };
    };
    expect(body.requested_top_k).toBe(5);
    expect(body.candidate_pool_size).toBe(20);
    expect(body.public_result.modo).toBe("hibrido");
    expect(body.trace.rrf_k).toBe(60);
    expect(body.trace.lanes.semantica.status).toBe("ok");
  });
});

describe("facetas materializadas — fast-path vs fallback (Fase A)", () => {
  const MAT = [
    { valor: "DETERGENTE", n: 102 },
    { valor: "AROMATIZANTE", n: 37 },
  ];
  const AOVIVO = [{ valor: "AO_VIVO_GROUP_BY", n: 5 }];

  // Fake que distingue leitura da tabela materializada vs GROUP BY ao vivo.
  function envFacetas(opts: { materializada: boolean }) {
    const regras: RegraD1[] = [
      {
        match: "FROM catalogo_facetas",
        resolver: (sql) =>
          opts.materializada
            ? sql.includes("COUNT(*)")
              ? [{ n: MAT.length }]
              : MAT
            : [], // tabela vazia → dispara fallback
      },
      {
        match: "GROUP BY",
        resolver: (sql) => (sql.includes("COUNT(DISTINCT") ? [{ n: 1 }] : AOVIVO),
      },
    ];
    return envAdmin(regras);
  }

  it("dim sem filtro (escopo all) lê a tabela materializada", async () => {
    const res = await adminRouter(req("facetas?dim=grupo", { key: KEY }), envFacetas({ materializada: true }));
    const b = (await res.json()) as { facetas: Array<{ valor: string }>; fonte: string; distintos_total: number };
    expect(b.fonte).toBe("materializada");
    expect(b.facetas.map((f) => f.valor)).toContain("DETERGENTE");
    expect(b.distintos_total).toBe(2);
  });

  it("dim sem filtro (ativo=1 → escopo active) também usa a materializada", async () => {
    const res = await adminRouter(req("facetas?dim=classe&ativo=1", { key: KEY }), envFacetas({ materializada: true }));
    const b = (await res.json()) as { fonte: string };
    expect(b.fonte).toBe("materializada");
  });

  it("COM filtro (classe=*X*) NUNCA usa a materializada — vai ao vivo", async () => {
    const res = await adminRouter(req("facetas?dim=pdm&classe=*LIMPEZA*", { key: KEY }), envFacetas({ materializada: true }));
    const b = (await res.json()) as { facetas: Array<{ valor: string }>; fonte: string };
    expect(b.fonte).toBe("ao_vivo");
    expect(b.facetas.map((f) => f.valor)).toContain("AO_VIVO_GROUP_BY");
  });

  it("ativo=0 (só inativos) não é escopo materializado → ao vivo", async () => {
    const res = await adminRouter(req("facetas?dim=grupo&ativo=0", { key: KEY }), envFacetas({ materializada: true }));
    const b = (await res.json()) as { fonte: string };
    expect(b.fonte).toBe("ao_vivo");
  });

  it("tabela vazia (miss) → fallback silencioso ao vivo", async () => {
    const res = await adminRouter(req("facetas?dim=grupo", { key: KEY }), envFacetas({ materializada: false }));
    const b = (await res.json()) as { facetas: Array<{ valor: string }>; fonte: string };
    expect(b.fonte).toBe("ao_vivo");
    expect(b.facetas.map((f) => f.valor)).toContain("AO_VIVO_GROUP_BY");
  });
});
