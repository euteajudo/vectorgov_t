/**
 * Testes das tools filesystem.
 */

import { describe, expect, it } from "vitest";
import { findTool } from "../src/mcp/tools/index.js";
import { createFakeD1, createFakeR2, createTestEnv } from "./_fakes.js";

describe("tool: fs_listar_normas", () => {
  it("devolve normas do _index.json (R2) e marca fonte r2", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "_index.json": {
          normas: [
            {
              norma_id: "lei-14133-2021",
              tipo: "lei",
              numero: "14133",
              ano: 2021,
              ementa: "Lei de licitacoes",
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

  it("segunda chamada le do cache KV", async () => {
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
            {
              norma_id: "x",
              tipo: "lei",
              numero: "1",
              ano: 2020,
              ementa: null,
              r2_path: "x/",
            },
            {
              norma_id: "y",
              tipo: "decreto",
              numero: "2",
              ano: 2021,
              ementa: null,
              r2_path: "y/",
            },
          ],
        },
      }),
    });
    const tool = findTool("fs_listar_normas")!;
    const out = (await tool.handler({ tipo: "decreto" }, env)) as {
      total: number;
    };
    expect(out.total).toBe(1);
  });
});

describe("tool: fs_listar_estrutura", () => {
  it("le _sumario.json no formato novo e devolve estrutura", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "lei-x/_sumario.json": {
          estrutura: [
            {
              tipo: "titulo",
              numero: "I",
              titulo: "Disposicoes gerais",
              caminho: "tit1",
              filhos: [
                {
                  tipo: "artigo",
                  numero: "1",
                  titulo: null,
                  caminho: "art1",
                  filhos: [],
                },
                {
                  tipo: "artigo",
                  numero: "2",
                  titulo: null,
                  caminho: "art2",
                  filhos: [],
                },
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

  it("normaliza _sumario.json bruto do parser", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "lei-x/_sumario.json": {
          artigos: {
            "10": {
              id: "lei-x-art-010",
              titulo: "Contratacao direta",
              filhos: {
                paragrafos: {
                  "1": { id: "lei-x-art-010-p-1" },
                },
              },
            },
          },
        },
      }),
    });
    const tool = findTool("fs_listar_estrutura")!;
    const out = (await tool.handler({ norma_id: "lei-x" }, env)) as {
      total_dispositivos: number;
      estrutura: Array<{ tipo: string; filhos: unknown[] }>;
    };
    expect(out.total_dispositivos).toBe(2);
    expect(out.estrutura[0]!.tipo).toBe("artigo");
    expect(out.estrutura[0]!.filhos).toHaveLength(1);
  });

  it("falha quando sumario nao existe", async () => {
    const env = createTestEnv({ R2_LEIS: createFakeR2({}) });
    const tool = findTool("fs_listar_estrutura")!;
    await expect(tool.handler({ norma_id: "inexistente" }, env)).rejects.toThrow(
      /nao encontrado/,
    );
  });
});

describe("tool: fs_ler_dispositivo", () => {
  it("resolve no D1 e devolve texto do Markdown R2 quando existe", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "lei-z/dispositivos/livro-i/art-010.md":
          "---\nid: \"lei-z-art-010\"\n---\n\nTexto do artigo 10",
      }),
      DB: createFakeD1({
        rules: [
          {
            match: "FROM dispositivos d",
            rows: [
              {
                texto: "Conteudo via D1",
                r2_path_versao: "lei-z/dispositivos/livro-i/art-010.md",
                norma_id: "lei-z",
                artigo: 10,
                paragrafo: null,
                inciso: null,
                alinea: null,
                hierarquia_path: "Livro I -> Art. 10",
                norma_label: "Lei Z",
              },
            ],
          },
        ],
      }),
    });
    const tool = findTool("fs_ler_dispositivo")!;
    const out = (await tool.handler({ norma_id: "lei-z", artigo: 10 }, env)) as {
      texto: string;
      fonte: string;
    };
    expect(out.fonte).toBe("r2");
    expect(out.texto).toBe("Texto do artigo 10");
  });

  it("cai para D1 quando o artefato R2 nao existe", async () => {
    const env = createTestEnv({
      R2_LEIS: createFakeR2({}),
      DB: createFakeD1({
        rules: [
          {
            match: "FROM dispositivos d",
            rows: [
              {
                texto: "Conteudo via D1",
                r2_path_versao: null,
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
    const out = (await tool.handler({ norma_id: "lei-z", artigo: 10 }, env)) as {
      texto: string;
      fonte: string;
    };
    expect(out.fonte).toBe("d1");
    expect(out.texto).toBe("Conteudo via D1");
  });

  it("trunca texto longo respeitando max_tokens", async () => {
    const longo = "palavra ".repeat(3000);
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "lei-z/dispositivos/livro-i/art-010.md":
          `---\nid: "lei-z-art-010"\n---\n\n${longo}`,
      }),
      DB: createFakeD1({
        rules: [
          {
            match: "FROM dispositivos d",
            rows: [
              {
                texto: "fallback",
                r2_path_versao: "lei-z/dispositivos/livro-i/art-010.md",
                norma_id: "lei-z",
                artigo: 10,
                paragrafo: null,
                inciso: null,
                alinea: null,
                hierarquia_path: "Livro I -> Art. 10",
                norma_label: "Lei Z",
              },
            ],
          },
        ],
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
  it("le N artigos em paralelo a partir de D1 + R2", async () => {
    const rows = new Map<number, Record<string, unknown>>([
      [
        1,
        {
          texto: "fallback art1",
          r2_path_versao: "lei-z/dispositivos/livro-i/art-001.md",
          norma_id: "lei-z",
          artigo: 1,
          paragrafo: null,
          inciso: null,
          alinea: null,
          hierarquia_path: "Livro I -> Art. 1",
          norma_label: "Lei Z",
        },
      ],
      [
        2,
        {
          texto: "fallback art2",
          r2_path_versao: "lei-z/dispositivos/livro-i/art-002.md",
          norma_id: "lei-z",
          artigo: 2,
          paragrafo: null,
          inciso: null,
          alinea: null,
          hierarquia_path: "Livro I -> Art. 2",
          norma_label: "Lei Z",
        },
      ],
    ]);
    const env = createTestEnv({
      R2_LEIS: createFakeR2({
        "lei-z/dispositivos/livro-i/art-001.md":
          "---\nid: \"lei-z-art-001\"\n---\n\nart1",
        "lei-z/dispositivos/livro-i/art-002.md":
          "---\nid: \"lei-z-art-002\"\n---\n\nart2",
      }),
      DB: {
        prepare(_sql: string) {
          let bound: unknown[] = [];
          const stmt = {
            bind(...args: unknown[]) {
              bound = args;
              return stmt;
            },
            async first() {
              return rows.get(Number(bound[1])) ?? null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return { success: true };
            },
          };
          return stmt as unknown as D1PreparedStatement;
        },
      } as unknown as D1Database,
    });
    const tool = findTool("fs_ler_intervalo")!;
    const out = (await tool.handler(
      { norma_id: "lei-z", artigo_inicio: 1, artigo_fim: 2 },
      env,
    )) as { dispositivos: Array<{ texto: string }>; truncado: boolean; total: number };
    expect(out.total).toBe(2);
    expect(out.truncado).toBe(false);
    expect(out.dispositivos.map((d) => d.texto)).toEqual(["art1", "art2"]);
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
  it("modo FTS5 default devolve rows com rank", async () => {
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
                texto: "mencao a contratacao direta",
                rank: -1.1,
                norma_label: "Lei Y",
              },
            ],
          },
        ],
      }),
    });
    const tool = findTool("fs_grep")!;
    const out = (await tool.handler({ padrao: "contratacao" }, env)) as {
      modo: string;
      total: number;
      fonte: string;
    };
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
    const out2 = (await tool.handler({ padrao: "xpto" }, env)) as {
      fonte: string;
    };
    expect(out2.fonte).toBe("cache");
  });

  it("modo regex rejeita padrao catastrofico", async () => {
    const env = createTestEnv({ DB: createFakeD1({}) });
    const tool = findTool("fs_grep")!;
    await expect(
      tool.handler({ padrao: "(.*)+abc", regex: true }, env),
    ).rejects.toThrow(/catastr/);
  });

  it("modo regex aceita padrao simples e filtra em memoria", async () => {
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
    const out = (await tool.handler({ padrao: "^abc", regex: true }, env)) as {
      modo: string;
      total: number;
    };
    expect(out.modo).toBe("regex");
    expect(out.total).toBe(1);
  });
});
