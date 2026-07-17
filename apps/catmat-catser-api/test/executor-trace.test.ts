/**
 * Executor compartilhado com trace (SPEC-LOOP-MONITOR-CATALOGO §2.1):
 * o campo `trace` só existe quando pedido (rota pública byte-idêntica),
 * o public_result de um run com trace é o MESMO payload do run público,
 * e uma lane que falha vira status "error" (com trace) em vez de derrubar.
 */
import { describe, expect, it } from "vitest";
import { buscarCatalogoHibrido } from "../src/lib/catalogo-search.js";
import {
  createFakeAi,
  createFakeD1,
  createFakeVectorize,
  createTestEnv,
} from "./_fakes.js";

const LINHA = (codigo: number, descricao: string) => ({
  catalogo_id: `cat-material-${codigo}`,
  codigo,
  tipo: "material",
  descricao,
  grupo: "GRUPO",
  classe: "CLASSE",
  pdm: null,
  ncm: null,
  ativo: 1,
  rank: -1.5,
});

function envBase(opts: { queryThrows?: boolean } = {}) {
  return createTestEnv({
    AI: createFakeAi(),
    VECTORIZE_CATMAT: createFakeVectorize({
      matches: [
        { id: "cat-material-1", score: 0.9, metadata: {} },
        { id: "cat-material-2", score: 0.8, metadata: {} },
      ],
      queryThrows: opts.queryThrows,
    }),
    DB: createFakeD1({
      regras: [
        { match: "catalogo_fts", rows: [LINHA(1, "PARAFUSO AÇO")] },
        { match: "catalogo_trgm", rows: [LINHA(2, "PARAFUSO INOX")] },
        {
          match: "FROM catalogo_itens WHERE id IN",
          rows: [LINHA(1, "PARAFUSO AÇO"), LINHA(2, "PARAFUSO INOX")],
        },
      ],
    }),
    // Sem COHERE_API_KEY → modo RRF (determinístico nos fakes).
  });
}

describe("executor compartilhado — trace", () => {
  it("sem opts: resposta NÃO tem campo trace (contrato público intocado)", async () => {
    const r = await buscarCatalogoHibrido(envBase(), {
      descricao: "parafuso",
      top_k: 5,
    });
    expect("trace" in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain("trace");
  });

  it("trace:true: public_result idêntico ao run público + trace completo", async () => {
    const publico = await buscarCatalogoHibrido(envBase(), {
      descricao: "parafuso",
      top_k: 5,
    });
    const { trace, ...espelho } = await buscarCatalogoHibrido(
      envBase(),
      { descricao: "parafuso", top_k: 5 },
      { trace: true },
    );
    expect(espelho).toEqual(publico);
    expect(trace).toBeDefined();
    expect(trace!.rrf_k).toBe(60);
    expect(trace!.rerank.modo).toBe("rrf_puro");
    expect(trace!.rerank.threshold).toBe(0.02);
    expect(trace!.lanes.lexical.status).toBe("ok");
    expect(trace!.lanes.aproximada.status).toBe("ok");
    expect(trace!.lanes.semantica.status).toBe("ok");
    expect(trace!.fusao.length).toBeGreaterThan(0);
    for (const f of trace!.fusao) {
      expect(["entrou", "cortado_threshold", "fora_do_top_k"]).toContain(
        f.veredito,
      );
    }
    // ranks por lane consistentes com os fakes
    const f1 = trace!.fusao.find((f) => f.id === "cat-material-1")!;
    expect(f1.rank_por_lane.semantica).toBe(1);
    expect(f1.rank_por_lane.lexical).toBe(1);
    expect(trace!.fusao_parcial).toBe(false);
  });

  it("lane semântica falha COM trace: status error, fusão parcial, demais ok", async () => {
    const r = await buscarCatalogoHibrido(
      envBase({ queryThrows: true }),
      { descricao: "parafuso", top_k: 5 },
      { trace: true },
    );
    expect(r.trace!.lanes.semantica.status).toBe("error");
    expect(r.trace!.lanes.semantica.causa).toBe("upstream");
    expect(r.trace!.lanes.lexical.status).toBe("ok");
    expect(r.trace!.fusao_parcial).toBe(true);
    // itens seguem vindos das lanes vivas
    expect(r.total).toBeGreaterThan(0);
  });

  it("lane falha SEM trace: lança como sempre lançou (público preservado)", async () => {
    await expect(
      buscarCatalogoHibrido(envBase({ queryThrows: true }), {
        descricao: "parafuso",
        top_k: 5,
      }),
    ).rejects.toThrow();
  });
});
