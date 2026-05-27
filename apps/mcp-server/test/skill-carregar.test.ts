/**
 * Testes da tool `skill_carregar`.
 *
 * Cobre:
 *   - R2 hit → parse + cache populado.
 *   - Cache hit (segunda chamada).
 *   - Skill inexistente → ToolExecutionError.
 *   - Front-matter inválido → ToolExecutionError.
 */

import { describe, expect, it } from "vitest";
import { SKILL_KV_KEY_SKILL_PREFIX } from "@vectorgov-t/schemas";
import { __test as carregar } from "../src/mcp/tools/skills/skill-carregar.js";
import { ToolExecutionError } from "../src/mcp/tools/registry.js";
import { createTestEnv, createFakeR2 } from "./_fakes.js";
import { fixtureSkillMd } from "./_skill-fixtures.js";

describe("skill_carregar — handler", () => {
  it("lê do R2 e popula cache na primeira chamada", async () => {
    const r2 = createFakeR2();
    r2.__seed({
      "active/minha-skill.md": fixtureSkillMd({ nome: "minha-skill" }),
    });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const out = await carregar.handler(env, { nome: "minha-skill" });
    expect(out.fonte).toBe("r2");
    expect(out.skill.metadata.nome).toBe("minha-skill");
    expect(out.skill.corpo_markdown).toContain("Quando usar");

    // Cache populado.
    const cached = await env.CACHE.get(
      `${SKILL_KV_KEY_SKILL_PREFIX}minha-skill`,
    );
    expect(cached).not.toBeNull();

    const out2 = await carregar.handler(env, { nome: "minha-skill" });
    expect(out2.fonte).toBe("cache");
    expect(out2.skill.metadata.nome).toBe("minha-skill");
  });

  it("lança ToolExecutionError quando skill não existe", async () => {
    const env = createTestEnv({ R2_SKILLS: createFakeR2() });
    await expect(
      carregar.handler(env, { nome: "nao-existe" }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it("lança ToolExecutionError quando front-matter quebrado", async () => {
    const r2 = createFakeR2();
    r2.__seed({
      "active/quebrada.md": "---\nnome: quebrada\nsem fechamento",
    });
    const env = createTestEnv({ R2_SKILLS: r2 });

    await expect(
      carregar.handler(env, { nome: "quebrada" }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it("lança ToolExecutionError quando metadata inválido", async () => {
    const r2 = createFakeR2();
    // Falta vários campos obrigatórios.
    r2.__seed({
      "active/incompleta.md":
        '---\nnome: incompleta\ndescricao: "x"\n---\ncorpo',
    });
    const env = createTestEnv({ R2_SKILLS: r2 });

    await expect(
      carregar.handler(env, { nome: "incompleta" }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});
