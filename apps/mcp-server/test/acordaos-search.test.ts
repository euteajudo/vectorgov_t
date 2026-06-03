/**
 * Testes de `buscarAcordaosTcu` (busca semântica em acórdãos do TCU).
 *
 * Inclui a REGRESSÃO do bug que motivou a tool: o client do binding Vectorize
 * estoura `#options` com `returnMetadata:"none"`. O teste garante que usamos
 * sempre `returnMetadata:"all"` (e nunca seta `returnValues`).
 */
import { describe, it, expect } from "vitest";
import { buscarAcordaosTcu } from "../src/lib/acordaos-search.js";
import { createFakeAi } from "./_fakes.js";
import type { Env } from "../src/env.js";

interface VecMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** Vectorize fake que CAPTURA as opções da query (pra checar returnMetadata). */
function fakeVectorizeCapturing(matches: VecMatch[]) {
  const calls: Array<Record<string, unknown> | undefined> = [];
  return {
    lastOptions: () => calls[calls.length - 1],
    query: async (
      _vector: number[] | Float32Array,
      options?: Record<string, unknown>,
    ): Promise<{ matches: VecMatch[] }> => {
      calls.push(options);
      return { matches };
    },
  };
}

const META_VOTO = {
  acordao_id: "acordao-1148-2022-plenario",
  numero: "1148",
  ano: 2022,
  colegiado: "plenario",
  secao: "voto",
  rotulo: "p11",
  texto: "trecho do voto sobre reequilíbrio econômico-financeiro do contrato",
  relator: "Fulano de Tal",
  r2_key: "acordao-1148-2022-plenario/voto/p11.md",
};

const META_ACD = {
  acordao_id: "acordao-1148-2022-plenario",
  numero: "1148",
  ano: 2022,
  colegiado: "plenario",
  secao: "acordao",
  rotulo: "item9.1",
  texto: "determinação 9.1 do acórdão",
};

function envWith(
  vec: ReturnType<typeof fakeVectorizeCapturing>,
  ai: ReturnType<typeof createFakeAi> = createFakeAi(),
): Env {
  return { AI: ai, VECTORIZE_ACORDAOS: vec } as unknown as Env;
}

/** Roda a busca com 1 match e devolve o label gerado (testa buildLabel no path real). */
async function labelFor(meta: Record<string, unknown>): Promise<string> {
  const vec = fakeVectorizeCapturing([
    { id: "x", score: 0.5, metadata: { texto: "trecho", ...meta } },
  ]);
  const hits = await buscarAcordaosTcu(envWith(vec), { query: "abc", top_k: 1 });
  return hits[0]!.label;
}

describe("buscarAcordaosTcu", () => {
  it("retorna snippets com citação (label) ordenados pelo rerank", async () => {
    // reranker stub: candidato 0 -> 0.95, candidato 1 -> 0.7
    const vec = fakeVectorizeCapturing([
      { id: "acordao-1148-2022-plenario#voto-p11", score: 0.3, metadata: META_VOTO },
      {
        id: "acordao-1148-2022-plenario#acordao-item9.1",
        score: 0.2,
        metadata: META_ACD,
      },
    ]);
    const hits = await buscarAcordaosTcu(envWith(vec), {
      query: "reequilíbrio do contrato",
      top_k: 5,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]!.score).toBe(0.95);
    expect(hits[0]!.label).toBe("Acórdão 1148/2022-TCU-Plenário, voto §11");
    expect(hits[0]!.texto).toContain("reequilíbrio");
    expect(hits[1]!.label).toBe("Acórdão 1148/2022-TCU-Plenário, item 9.1");
  });

  it("REGRESSÃO: usa returnMetadata='all' e NUNCA returnValues (evita #options)", async () => {
    const vec = fakeVectorizeCapturing([
      { id: "x", score: 0.1, metadata: META_VOTO },
    ]);
    await buscarAcordaosTcu(envWith(vec), { query: "abc", top_k: 3 });
    const opts = vec.lastOptions()!;
    expect(opts.returnMetadata).toBe("all");
    expect(opts.returnValues).toBeUndefined();
  });

  it("aplica filtros (colegiado/ano/secao) no query.filter", async () => {
    const vec = fakeVectorizeCapturing([]);
    await buscarAcordaosTcu(envWith(vec), {
      query: "abc",
      top_k: 3,
      filtros: { colegiado: "plenario", ano: 2022, secao: "voto" },
    });
    expect(vec.lastOptions()!.filter).toMatchObject({
      colegiado: "plenario",
      ano: 2022,
      secao: "voto",
    });
  });

  it("descarta candidatos sem texto na metadata", async () => {
    const vec = fakeVectorizeCapturing([
      { id: "a", score: 0.3, metadata: { ...META_VOTO } },
      { id: "b", score: 0.2, metadata: { ...META_ACD, texto: "" } },
    ]);
    const hits = await buscarAcordaosTcu(envWith(vec), { query: "abc", top_k: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.item_id).toBe("a");
  });

  it("query com menos de 3 chars retorna [] sem chamar o índice", async () => {
    const vec = fakeVectorizeCapturing([]);
    const hits = await buscarAcordaosTcu(envWith(vec), { query: "ab", top_k: 3 });
    expect(hits).toEqual([]);
    expect(vec.lastOptions()).toBeUndefined();
  });

  it("erra com clareza quando o índice não está configurado", async () => {
    const env = { AI: createFakeAi() } as unknown as Env;
    await expect(
      buscarAcordaosTcu(env, { query: "abc", top_k: 3 }),
    ).rejects.toThrow(/VECTORIZE_ACORDAOS/);
  });

  it("expõe relator e tipo_dispositivo no snippet quando a metadata traz", async () => {
    const vec = fakeVectorizeCapturing([
      {
        id: "a",
        score: 0.3,
        metadata: { ...META_ACD, relator: "Min. Fulano", tipo_dispositivo: "determinacao" },
      },
    ]);
    const hits = await buscarAcordaosTcu(envWith(vec), { query: "abc", top_k: 5 });
    expect(hits[0]!.relator).toBe("Min. Fulano");
    expect(hits[0]!.tipo_dispositivo).toBe("determinacao");
  });
});

describe("buscarAcordaosTcu — buildLabel (fidelidade de citação)", () => {
  const BASE = { numero: "1148", ano: 2022, colegiado: "plenario" };

  it("voto com parágrafo (p11) → §11", async () => {
    expect(await labelFor({ ...BASE, secao: "voto", rotulo: "p11" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário, voto §11",
    );
  });

  it("P0: voto com JANELA (w06) NÃO inventa § — cita só a seção", async () => {
    expect(await labelFor({ ...BASE, secao: "voto", rotulo: "w06" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário, voto",
    );
  });

  it("relatório com parágrafo (p3) → §3; janela (w02) sem §", async () => {
    expect(await labelFor({ ...BASE, secao: "relatorio", rotulo: "p3" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário, relatório §3",
    );
    expect(await labelFor({ ...BASE, secao: "relatorio", rotulo: "w02" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário, relatório",
    );
  });

  it("acordao com item numerado (item9.1) → item 9.1", async () => {
    expect(await labelFor({ ...BASE, secao: "acordao", rotulo: "item9.1" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário, item 9.1",
    );
  });

  it("P0: acordao com rótulo literal 'acordao' NÃO vira 'item acordao' — só a base", async () => {
    expect(await labelFor({ ...BASE, secao: "acordao", rotulo: "acordao" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário",
    );
  });

  it("sumário → sufixo fixo 'sumário'", async () => {
    expect(await labelFor({ ...BASE, secao: "sumario", rotulo: "SUMÁRIO" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário, sumário",
    );
  });

  it("enunciado: número puro ('01') e prefixado ('e05') normalizam para o número", async () => {
    expect(await labelFor({ ...BASE, secao: "enunciado", rotulo: "01" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário, enunciado 01",
    );
    expect(await labelFor({ ...BASE, secao: "enunciado", rotulo: "e05" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário, enunciado 05",
    );
  });

  it("seção desconhecida ou sem rótulo → só a base (nunca rótulo cru)", async () => {
    expect(await labelFor({ ...BASE, secao: "rodape", rotulo: "x9" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário",
    );
    expect(await labelFor({ ...BASE, secao: "voto", rotulo: "" })).toBe(
      "Acórdão 1148/2022-TCU-Plenário",
    );
  });
});

describe("buscarAcordaosTcu — robustez de AI.run", () => {
  it("falha de embed (call 1) propaga como erro — sem vetor não há busca", async () => {
    const vec = fakeVectorizeCapturing([{ id: "a", score: 0.3, metadata: META_VOTO }]);
    const ai = createFakeAi();
    ai.failOnCalls.add(1); // call 1 = embed bge-m3
    await expect(
      buscarAcordaosTcu(envWith(vec, ai), { query: "abc", top_k: 3 }),
    ).rejects.toThrow();
  });

  it("falha de rerank (call 2) degrada para ordem do Vectorize — NÃO derruba a busca", async () => {
    const vec = fakeVectorizeCapturing([
      { id: "a", score: 0.9, metadata: { ...META_VOTO } },
      { id: "b", score: 0.4, metadata: { ...META_ACD } },
    ]);
    const ai = createFakeAi();
    ai.failOnCalls.add(2); // call 1 = embed (ok), call 2 = rerank (falha)
    const hits = await buscarAcordaosTcu(envWith(vec, ai), { query: "abc", top_k: 5 });
    // Sem rerank: ordem e scores caem para o cosine do Vectorize (0.9 antes de 0.4).
    expect(hits.map((h) => h.item_id)).toEqual(["a", "b"]);
    expect(hits[0]!.score).toBe(0.9);
    expect(hits[1]!.score).toBe(0.4);
  });

  it("candidato sem score de rerank usa o cosine e vai depois dos rankeados", async () => {
    // O reranker stub só pontua os índices 0 e 1; o 3º candidato fica sem score.
    const vec = fakeVectorizeCapturing([
      { id: "r0", score: 0.5, metadata: { ...META_VOTO } },
      { id: "r1", score: 0.5, metadata: { ...META_ACD } },
      { id: "semrank", score: 0.42, metadata: { ...META_VOTO, rotulo: "p7" } },
    ]);
    const hits = await buscarAcordaosTcu(envWith(vec), { query: "abc", top_k: 5 });
    // r0 (0.95) e r1 (0.7) pelo rerank; o sem-score vai por último com o cosine.
    expect(hits.map((h) => h.item_id)).toEqual(["r0", "r1", "semrank"]);
    expect(hits[2]!.score).toBe(0.42);
  });
});
