/**
 * Testes de `carregarSkillsPorPapel` — carrega skills ativas e indexa por papel
 * do PEVS (mapeando `agentes_aplicaveis` → `role.nome`). Mocka o registry de
 * skills (que normalmente lê do R2).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("../src/mcp/tools/registry.js", () => ({
  invokeTool: (...args: unknown[]) => invokeMock(...args),
}));

import { carregarSkillsPorPapel } from "../src/lib/skills-pevs.js";
import type { Env } from "../src/env.js";

beforeEach(() => invokeMock.mockReset());

describe("carregarSkillsPorPapel", () => {
  it("mapeia agentes_aplicaveis → role.nome e carrega o corpo", async () => {
    invokeMock.mockImplementation(
      async (_env: unknown, tool: string, args: { nome?: string }) => {
        if (tool === "skill_listar") {
          return {
            skills: [
              { nome: "analise-nexo-causal", agentes_aplicaveis: ["analista-juridico"] },
              {
                nome: "estrutura-parecer",
                agentes_aplicaveis: ["redator", "especialista-reequilibrio"],
              },
              { nome: "fora-do-pevs", agentes_aplicaveis: ["alguem-qualquer"] },
            ],
          };
        }
        if (tool === "skill_carregar") {
          return {
            skill: {
              metadata: { nome: args.nome },
              corpo_markdown: `corpo de ${args.nome}`,
            },
          };
        }
        return {};
      },
    );

    const map = await carregarSkillsPorPapel({} as Env);
    // analista-juridico → analista_juridico; especialista-reequilibrio → esp_reequilibrio
    expect(Object.keys(map).sort()).toEqual([
      "analista_juridico",
      "esp_reequilibrio",
      "redator",
    ]);
    expect(map.analista_juridico!.map((s) => s.id)).toEqual(["analise-nexo-causal"]);
    expect(map.analista_juridico![0]!.conteudo_markdown).toBe(
      "corpo de analise-nexo-causal",
    );
    expect(map.redator!.map((s) => s.id)).toEqual(["estrutura-parecer"]);
    expect(map.esp_reequilibrio!.map((s) => s.id)).toEqual(["estrutura-parecer"]);
  });

  it("best-effort: se skill_listar falha, devolve mapa vazio", async () => {
    invokeMock.mockImplementation(async (_e: unknown, tool: string) => {
      if (tool === "skill_listar") throw new Error("R2 indisponível");
      return {};
    });
    expect(await carregarSkillsPorPapel({} as Env)).toEqual({});
  });

  it("carrega cada skill UMA vez (cache) mesmo servindo vários papéis", async () => {
    let carregarCalls = 0;
    invokeMock.mockImplementation(
      async (_e: unknown, tool: string, args: { nome?: string }) => {
        if (tool === "skill_listar") {
          return {
            skills: [
              {
                nome: "estrutura-parecer",
                agentes_aplicaveis: ["redator", "especialista-reequilibrio"],
              },
            ],
          };
        }
        if (tool === "skill_carregar") {
          carregarCalls += 1;
          return { skill: { metadata: { nome: args.nome }, corpo_markdown: "c" } };
        }
        return {};
      },
    );
    await carregarSkillsPorPapel({} as Env);
    expect(carregarCalls).toBe(1); // 1 skill em 2 papéis → 1 load
  });
});
