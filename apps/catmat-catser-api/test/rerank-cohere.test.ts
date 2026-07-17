/**
 * Testes do rerank Cohere: montagem do documento, parse defensivo da resposta,
 * threshold de relevância e o modo degradado (100% RRF, sem mistura de escalas).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buscarCatalogoHibrido,
  classeValida,
  montarDocRerank,
  parseCohereResults,
} from "../src/lib/catalogo-search.js";
import {
  createFakeAi,
  createFakeD1,
  createFakeVectorize,
  createTestEnv,
} from "./_fakes.js";

const NOTEBOOK = {
  catalogo_id: "cat-material-1",
  codigo: 1,
  tipo: "material",
  descricao: "NOTEBOOK PROFISSIONAL 16GB",
  grupo: "EQUIPAMENTOS DE TIC",
  classe: "COMPUTADORES",
  pdm: "NOTEBOOK",
  ativo: 1,
  rank: -2.0,
};

const MOUSE = {
  catalogo_id: "cat-material-2",
  codigo: 2,
  tipo: "material",
  descricao: "MOUSE OPTICO USB",
  grupo: "EQUIPAMENTOS DE TIC",
  classe: "INVALIDO",
  pdm: null,
  ativo: 1,
  rank: -1.0,
};

function envHibrido(overrides: { apiKey?: string } = {}) {
  const ai = createFakeAi();
  const env = createTestEnv({
    AI: ai,
    VECTORIZE_CATMAT: createFakeVectorize({ matches: [] }),
    DB: createFakeD1({
      regras: [
        { match: "catalogo_fts", rows: [NOTEBOOK, MOUSE] },
        { match: "catalogo_trgm", rows: [] },
      ],
    }),
    COHERE_API_KEY: overrides.apiKey,
  });
  return { env, ai };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classeValida", () => {
  it("rejeita placeholder INVALIDO/INVALIDA (com ou sem acento), vazio e null", () => {
    expect(classeValida("INVALIDO")).toBe(false);
    expect(classeValida("inválida")).toBe(false);
    expect(classeValida("   ")).toBe(false);
    expect(classeValida(null)).toBe(false);
    expect(classeValida(undefined)).toBe(false);
  });

  it("aceita classe real", () => {
    expect(classeValida("COMPUTADORES")).toBe(true);
  });
});

describe("montarDocRerank", () => {
  it("compõe descricao + (pdm) + classe válida", () => {
    expect(
      montarDocRerank({
        descricao: "NOTEBOOK PROFISSIONAL 16GB",
        pdm: "NOTEBOOK",
        classe: "COMPUTADORES",
      }),
    ).toBe("NOTEBOOK PROFISSIONAL 16GB (NOTEBOOK) COMPUTADORES");
  });

  it("omite pdm vazio e classe inválida", () => {
    expect(
      montarDocRerank({ descricao: "MOUSE OPTICO USB", pdm: null, classe: "INVALIDO" }),
    ).toBe("MOUSE OPTICO USB");
    expect(
      montarDocRerank({ descricao: "MOUSE OPTICO USB", pdm: "  ", classe: "" }),
    ).toBe("MOUSE OPTICO USB");
  });
});

describe("parseCohereResults — cobertura total ou null", () => {
  it("aceita resposta com cobertura completa e preserva index/score", () => {
    const out = parseCohereResults(
      { results: [{ index: 1, relevance_score: 0.8 }, { index: 0, relevance_score: 0.1 }] },
      2,
    );
    expect(out).toEqual([
      { index: 1, score: 0.8 },
      { index: 0, score: 0.1 },
    ]);
  });

  it("cobertura PARCIAL vira null (senão candidatos sem score sumiriam em silêncio)", () => {
    // 2 candidatos, 1 resultado: sem o guard, o item sem score viraria
    // undefined e cairia no threshold — a busca devolveria 1 item em vez de
    // degradar para RRF com os 2.
    expect(
      parseCohereResults({ results: [{ index: 0, relevance_score: 0.9 }] }, 2),
    ).toBeNull();
  });

  it("índice duplicado vira null", () => {
    expect(
      parseCohereResults(
        {
          results: [
            { index: 0, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.8 },
          ],
        },
        2,
      ),
    ).toBeNull();
  });

  it("qualquer entrada inválida (range, não-inteiro, score não numérico) vira null", () => {
    expect(
      parseCohereResults(
        { results: [{ index: 5, relevance_score: 0.9 }, { index: 1, relevance_score: 0.7 }] },
        2,
      ),
    ).toBeNull();
    expect(
      parseCohereResults(
        { results: [{ index: 0.5, relevance_score: 0.9 }, { index: 1, relevance_score: 0.7 }] },
        2,
      ),
    ).toBeNull();
    expect(
      parseCohereResults(
        { results: [{ index: 0, relevance_score: "alto" }, { index: 1, relevance_score: 0.7 }] },
        2,
      ),
    ).toBeNull();
  });

  it("payload sem results (ou não-objeto) vira null", () => {
    expect(parseCohereResults(null, 2)).toBeNull();
    expect(parseCohereResults({}, 2)).toBeNull();
    expect(parseCohereResults({ results: "x" }, 2)).toBeNull();
  });
});

describe("buscarCatalogoHibrido — rerank Cohere", () => {
  it("ordena 100% pelo rerank e descarta itens abaixo do threshold 0.02", async () => {
    const { env } = envHibrido({ apiKey: "chave-teste" });
    const corpos: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        corpos.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({
            results: [
              { index: 0, relevance_score: 0.91 },
              { index: 1, relevance_score: 0.001 },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const r = await buscarCatalogoHibrido(env, {
      descricao: "notebook 16gb",
      top_k: 10,
    });

    expect(r.modo).toBe("hibrido");
    // mouse (0.001 < 0.02) descartado; notebook fica com o score do rerank
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]!.codigo).toBe(1);
    expect(r.itens[0]!.score).toBeCloseTo(0.91);
    // documento do rerank = descricao + (pdm) + classe válida
    const body = corpos[0] as { model: string; documents: string[] };
    expect(body.model).toBe("rerank-v4.0-fast");
    expect(body.documents[0]).toBe(
      "NOTEBOOK PROFISSIONAL 16GB (NOTEBOOK) COMPUTADORES",
    );
    // classe INVALIDO do mouse não entra no documento
    expect(body.documents[1]).toBe("MOUSE OPTICO USB");
  });

  it("degrada para 100% RRF quando não há COHERE_API_KEY (sem threshold)", async () => {
    const { env, ai } = envHibrido({ apiKey: undefined });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const r = await buscarCatalogoHibrido(env, {
      descricao: "notebook 16gb",
      top_k: 10,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    // nenhum item cortado; scores na escala RRF (~1/61)
    expect(r.itens).toHaveLength(2);
    expect(r.itens[0]!.score).toBeGreaterThan(0);
    expect(r.itens[0]!.score!).toBeLessThan(0.1);
    // sinônimos entram no texto embedado (antes do FTS/embed)
    expect(ai.textsSeen[0]![0]).toContain("laptop");
  });

  it("degrada para 100% RRF quando a chamada Cohere falha", async () => {
    const { env } = envHibrido({ apiKey: "chave-teste" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    const r = await buscarCatalogoHibrido(env, {
      descricao: "notebook 16gb",
      top_k: 10,
    });
    expect(r.itens).toHaveLength(2);
    // ordenação RRF: notebook veio primeiro no FTS → rank melhor
    expect(r.itens[0]!.codigo).toBe(1);
  });
});
