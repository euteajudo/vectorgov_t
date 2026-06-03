/**
 * Testes de `buscarAcordaosLexical` (busca FTS5/bm25 em acórdãos do TCU) e do
 * sanitizador `buildMatchQuery`.
 *
 * Cobre: montagem segura do MATCH, guardas (query curta / sem D1), mapeamento
 * do row D1 → snippet (com `buildLabel` reusado), score = -bm25, e o filtro de
 * seção `relatorio` (que SÓ existe no lexical, não na semântica).
 */
import { describe, it, expect } from "vitest";
import {
  buscarAcordaosLexical,
  buildMatchQuery,
} from "../src/lib/acordaos-lexical.js";
import { createFakeD1 } from "./_fakes.js";
import type { Env } from "../src/env.js";

const ROW_VOTO = {
  item_id: "acordao-1148-2022-plenario#voto-p11",
  acordao_id: "acordao-1148-2022-plenario",
  secao: "voto",
  rotulo: "p11",
  texto: "trecho do voto sobre reequilíbrio econômico-financeiro do contrato",
  r2_key: "acordao-1148-2022-plenario/voto/p11.md",
  tipo_dispositivo: null,
  numero: "1148",
  ano: 2022,
  colegiado: "plenario",
  relator: "Min. Fulano",
  rank: -3.1,
  snip: "…sobre [reequilíbrio] econômico-financeiro…",
};
const ROW_REL = {
  item_id: "acordao-1148-2022-plenario#relatorio-p05",
  acordao_id: "acordao-1148-2022-plenario",
  secao: "relatorio",
  rotulo: "p05",
  texto: "no relatório consta o pedido de reequilíbrio",
  r2_key: "acordao-1148-2022-plenario/relatorio/p05.md",
  tipo_dispositivo: null,
  numero: "1148",
  ano: 2022,
  colegiado: "plenario",
  relator: "Min. Fulano",
  rank: -2.0,
  snip: "…pedido de [reequilíbrio]…",
};

function envWithRows(rows: unknown[]): Env {
  return {
    DB_ACORDAOS: createFakeD1({ rules: [{ match: "itens_fts MATCH", rows }] }),
  } as unknown as Env;
}

describe("buildMatchQuery (sanitização do FTS5 MATCH)", () => {
  it("tokeniza, vira prefixo e une por OR", () => {
    expect(buildMatchQuery("reequilíbrio do contrato")).toBe(
      "reequilíbrio* OR do* OR contrato*",
    );
  });

  it("descarta caracteres especiais do FTS5 (não quebra a sintaxe)", () => {
    // aspas, parênteses, hífen, dois-pontos viram fronteira de token.
    expect(buildMatchQuery('fato "do" -príncipe (art:75)')).toBe(
      "fato* OR do* OR príncipe* OR art* OR 75*",
    );
  });

  it("corta tokens de 1 char e retorna null quando não sobra nada", () => {
    expect(buildMatchQuery("a e o")).toBeNull();
    expect(buildMatchQuery("!! -- ::")).toBeNull();
  });

  it("número de processo vira tokens prefixados", () => {
    expect(buildMatchQuery("023.262/2017-6")).toBe("023* OR 262* OR 2017*");
  });
});

describe("buscarAcordaosLexical", () => {
  it("mapeia row D1 → snippet com label canônico, destaque e score=-bm25", async () => {
    const hits = await buscarAcordaosLexical(envWithRows([ROW_VOTO]), {
      query: "reequilíbrio do contrato",
      top_k: 5,
    });
    expect(hits).toHaveLength(1);
    const h = hits[0]!;
    expect(h.label).toBe("Acórdão 1148/2022-TCU-Plenário, voto §11");
    expect(h.score).toBeCloseTo(3.1); // -(-3.1)
    expect(h.destaque).toContain("[reequilíbrio]");
    expect(h.texto).toContain("reequilíbrio");
    expect(h.relator).toBe("Min. Fulano");
  });

  it("cobre a seção 'relatorio' (que a busca semântica não indexa)", async () => {
    const hits = await buscarAcordaosLexical(envWithRows([ROW_REL]), {
      query: "reequilíbrio",
      top_k: 5,
      filtros: { secao: "relatorio" },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.secao).toBe("relatorio");
    expect(hits[0]!.label).toBe("Acórdão 1148/2022-TCU-Plenário, relatório §5"); // p05 → §5
  });

  it("query com menos de 3 chars retorna [] sem tocar o D1", async () => {
    const hits = await buscarAcordaosLexical(envWithRows([ROW_VOTO]), {
      query: "ab",
      top_k: 5,
    });
    expect(hits).toEqual([]);
  });

  it("query só com ruído (sem token utilizável) retorna []", async () => {
    const hits = await buscarAcordaosLexical(envWithRows([ROW_VOTO]), {
      query: "! - :",
      top_k: 5,
    });
    expect(hits).toEqual([]);
  });

  it("erra com clareza quando o D1 de acórdãos não está configurado", async () => {
    const env = {} as unknown as Env;
    await expect(
      buscarAcordaosLexical(env, { query: "reequilíbrio", top_k: 5 }),
    ).rejects.toThrow(/DB_ACORDAOS/);
  });
});
