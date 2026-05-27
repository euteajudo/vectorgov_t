/**
 * Testes das 4 tools semânticas — exercitam dispatch via `tools/call`.
 *
 * Estratégia: usar `findTool().handler(args, env)` em vez de subir o Worker
 * inteiro, para inspecionar o objeto de resposta sem decodificar JSON-RPC.
 */

import { describe, expect, it } from "vitest";
import { findTool } from "../src/mcp/tools/index.js";
import {
  createTestEnv,
  createFakeAi,
  createFakeVectorize,
  createFakeD1,
} from "./_fakes.js";

describe("tool: buscar_legislacao", () => {
  it("rejeita query muito curta com ToolValidationError", async () => {
    const tool = findTool("buscar_legislacao")!;
    await expect(tool.handler({ query: "ab" }, createTestEnv())).rejects.toThrow(
      /argumentos inválidos/,
    );
  });

  it("dispara hybridSearch e devolve resultados", async () => {
    const env = createTestEnv({
      AI: createFakeAi(),
      VECTORIZE: createFakeVectorize({
        matches: [
          {
            id: "lc-123-2006#art3",
            score: 0.8,
            metadata: {
              norma_id: "lc-123-2006",
              artigo: 3,
              texto: "Empresas de pequeno porte...",
            },
          },
        ],
      }),
      DB: createFakeD1({
        rules: [
          {
            match: "dispositivos_fts",
            rows: [
              {
                dispositivo_id: "lc-123-2006#art3",
                norma_id: "lc-123-2006",
                artigo: 3,
                paragrafo: null,
                hierarquia: "art3",
                texto: "Empresas de pequeno porte...",
                rank: -1.5,
              },
            ],
          },
        ],
      }),
    });
    const tool = findTool("buscar_legislacao")!;
    const out = (await tool.handler(
      { query: "microempresa", top_k: 3 },
      env,
    )) as {
      resultados: unknown[];
      metodo: string;
      total: number;
    };
    expect(out.metodo).toBe("hybrid_rrf_rerank");
    expect(out.resultados.length).toBeGreaterThan(0);
    expect(out.total).toBe(out.resultados.length);
  });
});

describe("tool: consultar_artigo", () => {
  it("devolve encontrado=false quando D1 não tem o dispositivo", async () => {
    const env = createTestEnv({
      DB: createFakeD1({ rules: [] }),
    });
    const tool = findTool("consultar_artigo")!;
    const out = (await tool.handler(
      { norma_id: "lei-z", artigo: 5 },
      env,
    )) as { encontrado: boolean };
    expect(out.encontrado).toBe(false);
  });

  it("devolve texto + versão quando D1 acha o dispositivo", async () => {
    const env = createTestEnv({
      DB: createFakeD1({
        rules: [
          {
            match: "FROM dispositivos d",
            rows: [
              {
                dispositivo_id: "lei-z#art5",
                norma_id: "lei-z",
                artigo: 5,
                paragrafo: null,
                inciso: null,
                alinea: null,
                hierarquia_path: "art5",
                texto: "Texto do art 5",
                data_inicio: "2020-01-01",
                data_fim: null,
                norma_que_alterou: null,
                norma_label: "Lei Z",
              },
            ],
          },
        ],
      }),
    });
    const tool = findTool("consultar_artigo")!;
    const out = (await tool.handler(
      { norma_id: "lei-z", artigo: 5 },
      env,
    )) as { encontrado: boolean; texto: string };
    expect(out.encontrado).toBe(true);
    expect(out.texto).toBe("Texto do art 5");
  });
});

describe("tool: listar_artigos_por_tema", () => {
  it("usa metadata para hidratar citação + preview", async () => {
    const env = createTestEnv({
      AI: createFakeAi(),
      VECTORIZE: createFakeVectorize({
        matches: [
          {
            id: "lei-14133#art48",
            score: 0.92,
            metadata: {
              norma_id: "lei-14133-2021",
              norma_label: "Lei 14.133/2021",
              artigo: 48,
              hierarquia_path: "art48",
              texto: "A microempresa terá tratamento favorecido...",
            },
          },
        ],
      }),
    });
    const tool = findTool("listar_artigos_por_tema")!;
    const out = (await tool.handler(
      { tema: "microempresas", top_k: 5 },
      env,
    )) as { artigos: Array<{ citacao: { artigo: number }; preview: string }>; total: number };
    expect(out.total).toBe(1);
    expect(out.artigos[0]!.citacao.artigo).toBe(48);
    expect(out.artigos[0]!.preview.length).toBeLessThanOrEqual(280);
  });
});

describe("tool: comparar_redacoes", () => {
  it("monta diff palavra-a-palavra com primeira e última versão", async () => {
    let call = 0;
    // Cada chamada `.first()` é uma das duas versões.
    const versoes = [
      {
        data_inicio: "2010-01-01",
        data_fim: "2020-01-01",
        texto: "Constitui crime publicar dados sigilosos.",
        norma_que_alterou: null,
      },
      {
        data_inicio: "2020-01-02",
        data_fim: null,
        texto: "Constitui crime publicar dados sigilosos sem autorização.",
        norma_que_alterou: "lei-99",
      },
    ];
    const env = createTestEnv({
      DB: {
        prepare(_sql: string) {
          const p = {
            bind() {
              return p;
            },
            async first() {
              const v = versoes[call] ?? null;
              call += 1;
              return v;
            },
            async all() {
              return { results: [] };
            },
          };
          return p as unknown as D1PreparedStatement;
        },
      } as unknown as D1Database,
    });
    const tool = findTool("comparar_redacoes")!;
    const out = (await tool.handler(
      { dispositivo_id: "lei-y#art10" },
      env,
    )) as {
      diff: Array<{ tipo: string; texto: string }>;
      resumo: { palavras_adicionadas: number };
    };
    expect(out.diff.length).toBeGreaterThan(0);
    expect(out.resumo.palavras_adicionadas).toBeGreaterThan(0);
  });
});
