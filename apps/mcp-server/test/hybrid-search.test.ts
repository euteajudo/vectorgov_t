/**
 * Testes da função `hybridSearch` e do RRF auxiliar.
 *
 * Foco: garantir que a fusão de rankings, o re-rank e o mapeamento para
 * `Snippet` funcionam com fakes de AI/Vectorize/D1.
 */

import { describe, expect, it } from "vitest";
import { hybridSearch, reciprocalRankFusion } from "../src/lib/hybrid-search.js";
import {
  createTestEnv,
  createFakeAi,
  createFakeVectorize,
  createFakeD1,
} from "./_fakes.js";

describe("reciprocalRankFusion", () => {
  it("soma 1/(k+rank) para cada item, k=60 default", () => {
    const a = [{ id: "x" }, { id: "y" }];
    const b = [{ id: "y" }, { id: "z" }];
    const scores = reciprocalRankFusion([a, b]);
    // y aparece em rank 2 em A e rank 1 em B
    const expectedY = 1 / (60 + 2) + 1 / (60 + 1);
    expect(scores.get("y")).toBeCloseTo(expectedY, 10);
    // x e z aparecem só uma vez
    expect(scores.get("x")).toBeCloseTo(1 / 61, 10);
    expect(scores.get("z")).toBeCloseTo(1 / 62, 10);
  });

  it("k customizado afeta os scores", () => {
    const scores = reciprocalRankFusion([[{ id: "a" }]], 10);
    expect(scores.get("a")).toBeCloseTo(1 / 11, 10);
  });
});

describe("hybridSearch", () => {
  it("retorna snippets do FTS5 e fim do RRF + re-rank", async () => {
    const ai = createFakeAi({
      responses: {
        "@cf/baai/bge-reranker-base": {
          response: [
            { id: 0, score: 0.9 },
            { id: 1, score: 0.6 },
          ],
        },
      },
    });
    const vectorize = createFakeVectorize({
      matches: [
        {
          id: "lei-x#art1",
          score: 0.88,
          metadata: { norma_id: "lei-x", artigo: 1, texto: "texto vector" },
        },
      ],
    });
    const db = createFakeD1({
      rules: [
        {
          match: "dispositivos_fts",
          rows: [
            {
              dispositivo_id: "lei-x#art1",
              norma_id: "lei-x",
              artigo: 1,
              paragrafo: null,
              hierarquia: "art1",
              texto: "texto fts",
              rank: -1.2,
            },
            {
              dispositivo_id: "lei-x#art2",
              norma_id: "lei-x",
              artigo: 2,
              paragrafo: null,
              hierarquia: "art2",
              texto: "outro texto",
              rank: -0.9,
            },
          ],
        },
      ],
    });
    const env = createTestEnv({ AI: ai, VECTORIZE: vectorize, DB: db });

    const hits = await hybridSearch(env, {
      query: "contratação direta",
      topK: 2,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.snippet.citacao.norma_id).toBe("lei-x");
    expect(hits[0]!.scoreFinal).toBeGreaterThan(0);
    expect(hits[0]!.scores.rrf).toBeGreaterThan(0);
  });

  it("retorna array vazio quando ambos rankers vazios", async () => {
    const env = createTestEnv({
      AI: createFakeAi(),
      VECTORIZE: createFakeVectorize({ matches: [] }),
      DB: createFakeD1({ rules: [] }),
    });
    const hits = await hybridSearch(env, { query: "qualquer coisa", topK: 5 });
    expect(hits).toEqual([]);
  });
});
