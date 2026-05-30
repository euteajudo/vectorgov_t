/**
 * Testes da busca de catálogo (grep lexical + híbrido semântico), com fakes de
 * D1/AI/Vectorize. O motor (RRF/rerank) é reusado das leis; aqui validamos a
 * fiação sobre catalogo_fts + VECTORIZE_CATMAT.
 */
import { describe, expect, it } from "vitest";
import {
  buscarCatalogoHibrido,
  grepCatalogo,
} from "../src/lib/catalogo-search.js";
import {
  createTestEnv,
  createFakeD1,
  createFakeAi,
  createFakeVectorize,
} from "./_fakes.js";

const LINHA_FTS = {
  catalogo_id: "cat-material-269894",
  codigo: 269894,
  tipo: "material",
  descricao: "LUVA PARA PROCEDIMENTO NAO CIRURGICO",
  grupo: "MATERIAL HOSPITALAR",
  classe: "VESTUARIO HOSPITALAR",
  rank: -1.2,
};

describe("grepCatalogo", () => {
  it("devolve itens do FTS5 com modo grep", async () => {
    const env = createTestEnv({
      DB: createFakeD1({ rules: [{ match: "catalogo_fts", rows: [LINHA_FTS] }] }),
    });
    const r = await grepCatalogo(env, { padrao: "luva procedimento", max: 20 });
    expect(r.modo).toBe("grep");
    expect(r.total).toBe(1);
    expect(r.itens[0]!.codigo).toBe(269894);
    expect(r.itens[0]!.tipo).toBe("material");
  });
});

describe("buscarCatalogoHibrido", () => {
  it("funde Vectorize + FTS5 e devolve modo semantico", async () => {
    const env = createTestEnv({
      AI: createFakeAi(),
      VECTORIZE_CATMAT: createFakeVectorize({
        matches: [
          {
            id: "cat-material-100",
            score: 0.9,
            metadata: {
              codigo: 100,
              tipo: "material",
              descricao: "LUVA NITRILICA DESCARTAVEL",
              grupo: "",
              classe: "",
            },
          },
        ],
      }),
      DB: createFakeD1({ rules: [{ match: "catalogo_fts", rows: [LINHA_FTS] }] }),
    });
    const r = await buscarCatalogoHibrido(env, {
      descricao: "luva procedimento",
      top_k: 5,
    });
    expect(r.modo).toBe("semantico");
    expect(r.total).toBeGreaterThanOrEqual(1);
    const codigos = r.itens.map((i) => i.codigo);
    expect(codigos).toContain(269894); // veio do FTS
  });

  it("erra com clareza se VECTORIZE_CATMAT não está configurado", async () => {
    const env = createTestEnv({
      AI: createFakeAi(),
      DB: createFakeD1({ rules: [{ match: "catalogo_fts", rows: [] }] }),
    });
    await expect(
      buscarCatalogoHibrido(env, { descricao: "luva", top_k: 5 }),
    ).rejects.toThrow(/catmat-catser|VECTORIZE_CATMAT/);
  });
});
