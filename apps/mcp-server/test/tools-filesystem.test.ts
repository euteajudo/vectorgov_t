/**
 * Testes das 5 tools filesystem.
 */

import { describe, expect, it } from "vitest";
import { findTool } from "../src/mcp/tools/index.js";
import {
  createTestEnv,
  createFakeR2,
  createFakeD1,
} from "./_fakes.js";

describe("tool: fs_listar_normas", () => {
  it("devolve normas do _index.json (R2) e marca fonte 'r2'", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "_index.json": {
          normas: [
            {
              norma_id: "lei-14133-2021",
              tipo: "lei",
              numero: "14133",
              ano: 2021,
              ementa: "Lei de licitações",
              r2_path: "lei-14133-2021/",
            },
          ],
        },
      }),
    });
    const tool = findTool("fs_listar_normas")!;
    const out = (await tool.handler({}, env)) as {
      total: number;
      fonte: string;
      normas: Array<{ tipo: string }>;
    };
    expect(out.total).toBe(1);
    expect(out.fonte).toBe("r2");
    expect(out.normas[0]!.tipo).toBe("lei");
  });

  it("segunda chamada lê do cache KV", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "_index.json": { normas: [] },
      }),
    });
    const tool = findTool("fs_listar_normas")!;
    await tool.handler({}, env);
    const out2 = (await tool.handler({}, env)) as { fonte: string };
    expect(out2.fonte).toBe("cache");
  });

  it("filtra por tipo quando passado", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "_index.json": {
          normas: [
            { norma_id: "x", tipo: "lei", numero: "1", ano: 2020, ementa: null, r2_path: "x/" },
            { norma_id: "y", tipo: "decreto", numero: "2", ano: 2021, ementa: null, r2_path: "y/" },
          ],
        },
      }),
    });
    const tool = findTool("fs_listar_normas")!;
    const out = (await tool.handler({ tipo: "decreto" }, env)) as { total: number };
    expect(out.total).toBe(1);
  });
});

describe("tool: fs_listar_estrutura", () => {
  it("lê _sumario.json e devolve estrutura", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "lei-x/_sumario.json": {
          estrutura: [
            {
              tipo: "titulo",
              numero: "I",
              titulo: "Disposições gerais",
              caminho: "tit1",
              filhos: [
                { tipo: "artigo", numero: "1", titulo: null, caminho: "art1", filhos: [] },
                { tipo: "artigo", numero: "2", titulo: null, caminho: "art2", filhos: [] },
              ],
            },
          ],
          total_dispositivos: 2,
        },
      }),
    });
    const tool = findTool("fs_listar_estrutura")!;
    const out = (await tool.handler({ norma_id: "lei-x" }, env)) as {
      total_dispositivos: number;
      estrutura: unknown[];
    };
    expect(out.total_dispositivos).toBe(2);
    expect(out.estrutura).toHaveLength(1);
  });

  it("falha (ToolValidationError) quando sumário não existe", async () => {
    const env = createTestEnv({ R2_LEIS: createFakeR2({}) });
    const tool = findTool("fs_listar_estrutura")!;
    await expect(tool.handler({ norma_id: "inexistente" }, env)).rejects.toThrow(
      /não encontrado/,
    );
  });
});

describe("tool: fs_ler_dispositivo", () => {
  it("R2 first — devolve texto do R2 quando existe", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "lei-z/art10.json": {
          texto: "Texto do artigo 10",
          norma_label: "Lei Z",
        },
      }),
    });
    const tool = findTool("fs_ler_dispositivo")!;
    const out = (await tool.handler(
      { norma_id: "lei-z", artigo: 10 },
      env,
    )) as { texto: string; fonte: string };
    expect(out.fonte).toBe("r2");
    expect(out.texto).toBe("Texto do artigo 10");
  });

  it("fallback D1 quando R2 não tem o objeto", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({}),
      DB: createFakeD1({
        rules: [
          {
            match: "FROM dispositivos d",
            rows: [
              {
                texto: "Conteúdo via D1",
                norma_id: "lei-z",
                artigo: 10,
                paragrafo: null,
                inciso: null,
                alinea: null,
                hierarquia_path: "art10",
                norma_label: "Lei Z",
              },
            ],
          },
        ],
      }),
    });
    const tool = findTool("fs_ler_dispositivo")!;
    const out = (await tool.handler(
      { norma_id: "lei-z", artigo: 10 },
      env,
    )) as { texto: string; fonte: string };
    expect(out.fonte).toBe("d1");
    expect(out.texto).toBe("Conteúdo via D1");
  });

  it("trunca texto longo respeitando max_tokens", async () => {
    const longo = "palavra ".repeat(3000); // ~3000 palavras, ~6000 tokens
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "lei-z/art10.json": { texto: longo },
      }),
    });
    const tool = findTool("fs_ler_dispositivo")!;
    const out = (await tool.handler(
      { norma_id: "lei-z", artigo: 10, max_tokens: 500 },
      env,
    )) as { truncado: boolean; proximo_cursor: number | null };
    expect(out.truncado).toBe(true);
    expect(out.proximo_cursor).not.toBeNull();
  });
});

describe("tool: fs_ler_intervalo", () => {
  it("lê N artigos em paralelo e marca truncado quando > 20", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "lei-z/art1.json": { texto: "art1" },
        "lei-z/art2.json": { texto: "art2" },
      }),
      DB: createFakeD1({ rules: [] }),
    });
    const tool = findTool("fs_ler_intervalo")!;
    const out = (await tool.handler(
      { norma_id: "lei-z", artigo_inicio: 1, artigo_fim: 2 },
      env,
    )) as { dispositivos: unknown[]; truncado: boolean; total: number };
    expect(out.total).toBe(2);
    expect(out.truncado).toBe(false);
  });

  it("rejeita intervalo invertido", async () => {
    const env = createTestEnv({ R2_LEIS: createFakeR2({}), DB: createFakeD1({}) });
    const tool = findTool("fs_ler_intervalo")!;
    await expect(
      tool.handler({ norma_id: "x", artigo_inicio: 10, artigo_fim: 5 }, env),
    ).rejects.toThrow(/artigo_fim/);
  });

  it("trunca em 20 quando intervalo > 20", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({}),
      DB: createFakeD1({ rules: [] }),
    });
    const tool = findTool("fs_ler_intervalo")!;
    const out = (await tool.handler(
      { norma_id: "x", artigo_inicio: 1, artigo_fim: 30 },
      env,
    )) as { truncado: boolean };
    expect(out.truncado).toBe(true);
  });
});

describe("tool: fs_grep", () => {
  it("modo FTS5 default — devolve rows com rank", async () => {
    const env = createTestEnv({
      DB: createFakeD1({
        rules: [
          {
            match: "dispositivos_fts",
            rows: [
              {
                dispositivo_id: "lei-y#art1",
                norma_id: "lei-y",
                artigo: 1,
                paragrafo: null,
                hierarquia: "art1",
                texto: "menção a contratação direta",
                rank: -1.1,
                norma_label: "Lei Y",
              },
            ],
          },
        ],
      }),
    });
    const tool = findTool("fs_grep")!;
    const out = (await tool.handler(
      { padrao: "contratação" },
      env,
    )) as { modo: string; total: number; fonte: string };
    expect(out.modo).toBe("fts5");
    expect(out.total).toBe(1);
    expect(out.fonte).toBe("live");
  });

  it("segunda chamada vem do cache", async () => {
    const env = createTestEnv({
      DB: createFakeD1({
        rules: [
          {
            match: "dispositivos_fts",
            rows: [],
          },
        ],
      }),
    });
    const tool = findTool("fs_grep")!;
    await tool.handler({ padrao: "xpto" }, env);
    const out2 = (await tool.handler({ padrao: "xpto" }, env)) as { fonte: string };
    expect(out2.fonte).toBe("cache");
  });

  it("modo regex rejeita padrão catastrófico", async () => {
    const env = createTestEnv({ DB: createFakeD1({}) });
    const tool = findTool("fs_grep")!;
    await expect(
      tool.handler({ padrao: "(.*)+abc", regex: true }, env),
    ).rejects.toThrow(/catastrófico/);
  });

  it("modo regex aceita padrão simples e filtra in-memory", async () => {
    const env = createTestEnv({
      DB: createFakeD1({
        rules: [
          {
            match: "WHERE v.data_fim IS NULL",
            rows: [
              {
                dispositivo_id: "lei-y#art1",
                norma_id: "lei-y",
                artigo: 1,
                paragrafo: null,
                hierarquia: "art1",
                texto: "abc 123",
                norma_label: "Lei Y",
              },
              {
                dispositivo_id: "lei-y#art2",
                norma_id: "lei-y",
                artigo: 2,
                paragrafo: null,
                hierarquia: "art2",
                texto: "xyz",
                norma_label: "Lei Y",
              },
            ],
          },
        ],
      }),
    });
    const tool = findTool("fs_grep")!;
    const out = (await tool.handler(
      { padrao: "^abc", regex: true },
      env,
    )) as { modo: string; total: number };
    expect(out.modo).toBe("regex");
    expect(out.total).toBe(1);
  });
});
