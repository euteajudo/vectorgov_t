/**
 * Testes do gerador automático de meta-skill
 * (`src/lib/skills-meta-generator.ts`).
 *
 * Verifica:
 *   - Lê apenas `active/*.md` (ignora outros prefixos).
 *   - Skills inválidas vão pro array de `erros` sem derrubar a regen.
 *   - Gera `_meta.md` e `_meta.json` em formato esperado.
 *   - Invalida a chave KV `skill:_meta`.
 *   - Conta tokens / tamanho do markdown gerado.
 */

import { describe, expect, it } from "vitest";
import {
  MetaIndex,
  SKILL_KV_KEY_META,
  SKILL_R2_KEY_META_JSON,
  SKILL_R2_KEY_META_MD,
} from "@vectorgov-t/schemas";
import { regenerarMeta } from "../src/lib/skills-meta-generator.js";
import { createTestEnv, createFakeR2 } from "./_fakes.js";
import { fixtureSkillMd } from "./_skill-fixtures.js";

describe("regenerarMeta — happy path", () => {
  it("gera _meta.md e _meta.json a partir de 3 skills válidas", async () => {
    const r2 = createFakeR2();
    r2.__seed({
      "active/skill-a.md": fixtureSkillMd({
        nome: "skill-a",
        categoria: "analise-peticao",
      }),
      "active/skill-b.md": fixtureSkillMd({
        nome: "skill-b",
        categoria: "geracao-parecer",
      }),
      "active/skill-c.md": fixtureSkillMd({
        nome: "skill-c",
        categoria: "calculo-tributario",
      }),
    });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const result = await regenerarMeta(env);

    expect(result.total_skills_consideradas).toBe(3);
    expect(result.total_skills_indexadas).toBe(3);
    expect(result.erros).toHaveLength(0);
    expect(result.tamanho_meta_md_bytes).toBeGreaterThan(0);

    const snap = r2.__snapshot();
    expect(snap[SKILL_R2_KEY_META_MD]).toContain("# Skills disponíveis");
    expect(snap[SKILL_R2_KEY_META_MD]).toContain("`skill-a`");

    const json = JSON.parse(snap[SKILL_R2_KEY_META_JSON]!);
    const parsed = MetaIndex.parse(json);
    expect(parsed.total_skills).toBe(3);
    expect(parsed.skills.map((s) => s.nome).sort()).toEqual([
      "skill-a",
      "skill-b",
      "skill-c",
    ]);
  });

  it("invalida cache KV skill:_meta após regeneração", async () => {
    const r2 = createFakeR2();
    r2.__seed({
      "active/x.md": fixtureSkillMd({ nome: "skill-x" }),
    });
    const env = createTestEnv({ R2_SKILLS: r2 });

    // Pré-popula cache para simular hit antigo.
    await env.CACHE.put(SKILL_KV_KEY_META, JSON.stringify({ stale: true }));
    expect(await env.CACHE.get(SKILL_KV_KEY_META)).not.toBeNull();

    await regenerarMeta(env);
    expect(await env.CACHE.get(SKILL_KV_KEY_META)).toBeNull();
  });
});

describe("regenerarMeta — robustez", () => {
  it("ignora skills com YAML quebrado mas continua processando o resto", async () => {
    const r2 = createFakeR2();
    r2.__seed({
      "active/boa.md": fixtureSkillMd({ nome: "skill-boa" }),
      "active/quebrada.md": "---\nnome: invalida\nsem fim do front matter",
      "active/sem-categoria.md":
        "---\nnome: faltou-categoria\ndescricao: \"x\"\n---\ncorpo",
    });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const result = await regenerarMeta(env);

    expect(result.total_skills_consideradas).toBe(3);
    expect(result.total_skills_indexadas).toBe(1);
    expect(result.erros).toHaveLength(2);
    const erroKeys = result.erros.map((e) => e.key).sort();
    expect(erroKeys).toEqual(["active/quebrada.md", "active/sem-categoria.md"]);
  });

  it("não inclui no índice arquivos sem prefixo active/", async () => {
    const r2 = createFakeR2();
    r2.__seed({
      "active/ok.md": fixtureSkillMd({ nome: "skill-ok" }),
      "candidate/em-teste.md": fixtureSkillMd({ nome: "skill-em-teste" }),
      "archive/antiga.md": fixtureSkillMd({ nome: "skill-antiga" }),
    });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const result = await regenerarMeta(env);

    expect(result.total_skills_indexadas).toBe(1);
    const json = JSON.parse(r2.__snapshot()[SKILL_R2_KEY_META_JSON]!);
    expect(MetaIndex.parse(json).skills[0]!.nome).toBe("skill-ok");
  });

  it("retorna meta vazio quando bucket está vazio", async () => {
    const env = createTestEnv({ R2_SKILLS: createFakeR2() });
    const result = await regenerarMeta(env);
    expect(result.total_skills_indexadas).toBe(0);
    expect(result.erros).toHaveLength(0);
  });
});

describe("regenerarMeta — _meta.md compacto", () => {
  it("mantém o _meta.md abaixo de 2KB com 10 skills (cabe em ~500 tokens)", async () => {
    const r2 = createFakeR2();
    const seed: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      const nome = `skill-numero-${String(i).padStart(2, "0")}`;
      seed[`active/${nome}.md`] = fixtureSkillMd({ nome });
    }
    r2.__seed(seed);
    const env = createTestEnv({ R2_SKILLS: r2 });

    const result = await regenerarMeta(env);
    // 2KB ≈ 500 tokens ASCII — checamos limite folgado para 10 skills.
    expect(result.tamanho_meta_md_bytes).toBeLessThan(2000);
  });
});
