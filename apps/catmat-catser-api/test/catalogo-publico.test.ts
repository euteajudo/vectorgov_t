/**
 * Rotas públicas das tools do MCP comercial (SPEC-LOOP-TOOLS-CATALOGO-MCP,
 * Fase 0): cascata sinalizada do grep, navegar (facetas/itens keyset),
 * codigo em batch e tetos de entrada.
 *
 * Testa o publicoRouter direto (não o index.ts — o chat-engine importa .md
 * que o vitest não transforma); o wiring é coberto pelo curl de fumaça.
 */
import { describe, expect, it } from "vitest";
import { publicoRouter } from "../src/lib/catalogo-publico.js";
import {
  createFakeD1,
  createTestEnv,
  type RegraD1,
} from "./_fakes.js";

const jsonPublico = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function req(path: string, method = "GET"): Request {
  return new Request(`https://x.example/api/catalogo/${path}`, { method });
}

function envCom(regras: RegraD1[]) {
  return createTestEnv({ DB: createFakeD1({ regras }) });
}

const LINHA = (codigo: number, descricao: string) => ({
  catalogo_id: `cat-material-${codigo}`,
  id: `cat-material-${codigo}`,
  codigo,
  tipo: "material",
  descricao,
  grupo: "G",
  classe: "C",
  pdm: null,
  ncm: null,
  ativo: 1,
  atualizado_em: null,
  rank: -1.0,
});

async function corpo(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("grep — cascata sinalizada", () => {
  it("hit no passe AND → modo_busca 'exata'", async () => {
    const env = envCom([
      {
        match: "catalogo_fts",
        resolver: (_sql, binds) =>
          String(binds[0]).includes(" OR ") ? [] : [LINHA(1, "NOTEBOOK X")],
      },
    ]);
    const res = await publicoRouter(req("grep?q=NOTEBOOK"), env, jsonPublico);
    const b = await corpo(res);
    expect(res.status).toBe(200);
    expect(b.modo_busca).toBe("exata");
    expect(b.total).toBe(1);
  });

  it("AND vazio, OR acha → 'ampla'", async () => {
    const env = envCom([
      {
        match: "catalogo_fts",
        resolver: (_sql, binds) =>
          String(binds[0]).includes(" OR ") ? [LINHA(2, "NOTEBOOK Y")] : [],
      },
    ]);
    const res = await publicoRouter(req("grep?q=notebook%20xyz"), env, jsonPublico);
    const b = await corpo(res);
    expect(b.modo_busca).toBe("ampla");
    expect(b.total).toBe(1);
  });

  it("full-text vazio, substring acha → 'aproximada'", async () => {
    const env = envCom([
      { match: "catalogo_fts", rows: [] },
      { match: "catalogo_trgm", rows: [LINHA(3, "NOTEBOOK Z")] },
    ]);
    const res = await publicoRouter(req("grep?q=NOTEBOK"), env, jsonPublico);
    const b = await corpo(res);
    expect(b.modo_busca).toBe("aproximada");
    expect(b.total).toBe(1);
  });

  it("nada em nenhum nível → total 0, ainda sinalizado 'aproximada'", async () => {
    const env = envCom([
      { match: "catalogo_fts", rows: [] },
      { match: "catalogo_trgm", rows: [] },
    ]);
    const b = await corpo(await publicoRouter(req("grep?q=zzzzzz"), env, jsonPublico));
    expect(b.modo_busca).toBe("aproximada");
    expect(b.total).toBe(0);
  });

  it("tetos: q curto → 400; top_k>20 → 400; tipo inválido → 400", async () => {
    const env = envCom([]);
    expect((await publicoRouter(req("grep?q=a"), env, jsonPublico)).status).toBe(400);
    expect(
      (await publicoRouter(req("grep?q=abc&top_k=21"), env, jsonPublico)).status,
    ).toBe(400);
    expect(
      (await publicoRouter(req("grep?q=abc&tipo=obra"), env, jsonPublico)).status,
    ).toBe(400);
  });
});

describe("navegar", () => {
  it("com dim → facetas com contagens e distintos_total", async () => {
    const env = envCom([
      {
        match: "GROUP BY",
        rows: [
          { valor: "PASTA ARQUIVO", n: 1325 },
          { valor: "DETERGENTE", n: 110 },
        ],
      },
      { match: "COUNT(DISTINCT", rows: [{ n: 2 }] },
    ]);
    const b = await corpo(
      await publicoRouter(req("navegar?dim=pdm&classe=*LIMPEZA*"), env, jsonPublico),
    );
    expect(b.modo).toBe("navegar");
    expect((b.facetas as unknown[]).length).toBe(2);
    expect(b.distintos_total).toBe(2);
  });

  it("sem dim → itens com total e next_cursor quando a página enche", async () => {
    const env = envCom([
      {
        match: "FROM catalogo_itens WHERE",
        resolver: (sql) =>
          sql.includes("COUNT(*)") ? [{ n: 3 }] : [LINHA(1, "A"), LINHA(2, "B")],
      },
    ]);
    const b = await corpo(
      await publicoRouter(req("navegar?classe=C&limit=2"), env, jsonPublico),
    );
    expect(b.modo).toBe("navegar");
    expect((b.itens as unknown[]).length).toBe(2);
    expect(b.total).toBe(3);
    expect(typeof b.next_cursor).toBe("string");
  });

  it("tetos: limit>50 → 400; dim inválida → 400; cursor lixo → 400", async () => {
    const env = envCom([]);
    expect(
      (await publicoRouter(req("navegar?limit=51"), env, jsonPublico)).status,
    ).toBe(400);
    expect(
      (await publicoRouter(req("navegar?dim=descricao"), env, jsonPublico)).status,
    ).toBe(400);
    expect(
      (await publicoRouter(req("navegar?cursor=%%%"), env, jsonPublico)).status,
    ).toBe(400);
  });
});

describe("codigo — batch", () => {
  it("ordem do pedido preservada; ausente vira encontrado:false sem derrubar o lote", async () => {
    const env = envCom([
      {
        match: "WHERE id IN",
        rows: [LINHA(98191, "NOTEBOOK"), LINHA(3999, "LIMPEZA")],
      },
    ]);
    const b = await corpo(
      await publicoRouter(
        req("codigo?tipo=material&codigos=3999,999999,98191"),
        env,
        jsonPublico,
      ),
    );
    expect(b.modo).toBe("codigo");
    const itens = b.itens as Array<Record<string, unknown>>;
    expect(itens.map((i) => i.codigo)).toEqual([3999, 999999, 98191]);
    expect(itens.map((i) => i.encontrado)).toEqual([true, false, true]);
    expect(itens[0]!.ativo).toBe(true);
  });

  it("tetos: sem tipo → 400; batch>20 → 400; código não-numérico → 400", async () => {
    const env = envCom([]);
    expect(
      (await publicoRouter(req("codigo?codigos=1"), env, jsonPublico)).status,
    ).toBe(400);
    const muitos = Array.from({ length: 21 }, (_, i) => i + 1).join(",");
    expect(
      (
        await publicoRouter(
          req(`codigo?tipo=material&codigos=${muitos}`),
          env,
          jsonPublico,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await publicoRouter(req("codigo?tipo=material&codigos=abc"), env, jsonPublico)
      ).status,
    ).toBe(400);
  });
});

describe("router", () => {
  it("método não-GET → 405; rota desconhecida → 404", async () => {
    const env = envCom([]);
    expect(
      (await publicoRouter(req("grep?q=abc", "POST"), env, jsonPublico)).status,
    ).toBe(405);
    expect(
      (await publicoRouter(req("inexistente"), env, jsonPublico)).status,
    ).toBe(404);
  });
});
