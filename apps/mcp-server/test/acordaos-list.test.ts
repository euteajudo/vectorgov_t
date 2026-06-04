/**
 * Testes de `listarAcordaos` (listagem de acórdãos carregados via D1).
 */
import { describe, it, expect } from "vitest";
import { listarAcordaos } from "../src/lib/acordaos-list.js";
import { createFakeD1 } from "./_fakes.js";
import type { Env } from "../src/env.js";

const ROW = {
  acordao_id: "acordao-1148-2022-plenario",
  numero: "1148",
  ano: 2022,
  colegiado: "plenario",
  relator: "Min. Fulano",
  processo_tc: "023.262/2017-6",
  data_sessao: "2022-05-25",
  criado_em: "2026-06-03T02:09:40Z",
  total_itens: 69,
  total_indexados: 15,
};

function envWith(rows: unknown[]): Env {
  return {
    DB_ACORDAOS: createFakeD1({ rules: [{ match: "FROM acordaos", rows }] }),
  } as unknown as Env;
}

describe("listarAcordaos", () => {
  it("mapeia os rows do D1 para o resumo (cabeçalho + contagens)", async () => {
    const out = await listarAcordaos(envWith([ROW]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      acordao_id: "acordao-1148-2022-plenario",
      numero: "1148",
      ano: 2022,
      colegiado: "plenario",
      relator: "Min. Fulano",
      processo_tc: "023.262/2017-6",
      total_itens: 69,
      total_indexados: 15,
    });
  });

  it("normaliza campos nulos (relator/processo ausentes → null; contagens → 0)", async () => {
    const out = await listarAcordaos(
      envWith([
        {
          acordao_id: "x",
          numero: "1",
          ano: 2020,
          colegiado: "plenario",
          relator: null,
          processo_tc: null,
          data_sessao: null,
          criado_em: null,
          total_itens: null,
          total_indexados: null,
        },
      ]),
    );
    expect(out[0]!.relator).toBeNull();
    expect(out[0]!.processo_tc).toBeNull();
    expect(out[0]!.total_itens).toBe(0);
    expect(out[0]!.total_indexados).toBe(0);
  });

  it("lista vazia quando não há acórdãos", async () => {
    expect(await listarAcordaos(envWith([]))).toEqual([]);
  });

  it("erra com clareza quando o D1 de acórdãos não está configurado", async () => {
    const env = {} as unknown as Env;
    await expect(listarAcordaos(env)).rejects.toThrow(/DB_ACORDAOS/);
  });
});
