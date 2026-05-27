/**
 * Testes da tool `skill_publicar`.
 *
 * Cobre:
 *   - Publica em active/ → escreve no R2 + regenera meta.
 *   - Publica em candidate/ → escreve no R2, NÃO regenera meta.
 *   - sobrescrever=false impede overwrite.
 *   - nome do parâmetro != nome do front-matter → ToolInputError.
 *   - Markdown sem front-matter → ToolInputError.
 *   - Metadata inválido (faltam campos) → ToolInputError.
 */

import { describe, expect, it } from "vitest";
import {
  SKILL_R2_KEY_META_JSON,
  SKILL_R2_KEY_META_MD,
} from "@vectorgov-t/schemas";
import { __test as publicar } from "../src/mcp/tools/skills/skill-publicar.js";
import {
  ToolExecutionError,
  ToolInputError,
} from "../src/mcp/tools/registry.js";
import { createTestEnv, createFakeR2 } from "./_fakes.js";
import { fixtureSkillMd } from "./_skill-fixtures.js";

describe("skill_publicar — happy path", () => {
  it("publica em active/ e regenera o meta", async () => {
    const r2 = createFakeR2();
    const env = createTestEnv({ R2_SKILLS: r2 });

    const md = fixtureSkillMd({ nome: "skill-nova" });
    const out = await publicar.handler(env, {
      nome: "skill-nova",
      conteudo_markdown: md,
      destino: "active",
      sobrescrever: false,
    });

    expect(out.publicado).toBe(true);
    expect(out.r2_key).toBe("active/skill-nova.md");
    expect(out.meta_regenerado).toBe(true);
    expect(out.metadata.nome).toBe("skill-nova");

    const snap = r2.__snapshot();
    expect(snap["active/skill-nova.md"]).toContain("skill-nova");
    expect(snap[SKILL_R2_KEY_META_MD]).toContain("`skill-nova`");
    expect(snap[SKILL_R2_KEY_META_JSON]).toContain("skill-nova");
  });

  it("publica em candidate/ sem regenerar meta", async () => {
    const r2 = createFakeR2();
    const env = createTestEnv({ R2_SKILLS: r2 });

    const md = fixtureSkillMd({ nome: "em-teste" });
    const out = await publicar.handler(env, {
      nome: "em-teste",
      conteudo_markdown: md,
      destino: "candidate",
      sobrescrever: false,
    });

    expect(out.r2_key).toBe("candidate/em-teste.md");
    expect(out.meta_regenerado).toBe(false);

    const snap = r2.__snapshot();
    expect(snap["candidate/em-teste.md"]).toBeDefined();
    expect(snap[SKILL_R2_KEY_META_MD]).toBeUndefined();
  });
});

describe("skill_publicar — overwrite", () => {
  it("bloqueia overwrite quando sobrescrever=false e key já existe", async () => {
    const r2 = createFakeR2();
    r2.__seed({
      "active/conflito.md": fixtureSkillMd({ nome: "conflito" }),
    });
    const env = createTestEnv({ R2_SKILLS: r2 });

    await expect(
      publicar.handler(env, {
        nome: "conflito",
        conteudo_markdown: fixtureSkillMd({
          nome: "conflito",
          versao: "2.0.0",
        }),
        destino: "active",
        sobrescrever: false,
      }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it("permite overwrite quando sobrescrever=true", async () => {
    const r2 = createFakeR2();
    r2.__seed({
      "active/sobrescrever.md": fixtureSkillMd({ nome: "sobrescrever" }),
    });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const out = await publicar.handler(env, {
      nome: "sobrescrever",
      conteudo_markdown: fixtureSkillMd({
        nome: "sobrescrever",
        versao: "2.0.0",
      }),
      destino: "active",
      sobrescrever: true,
    });

    expect(out.publicado).toBe(true);
    expect(out.metadata.versao).toBe("2.0.0");
  });
});

describe("skill_publicar — validação", () => {
  it("lança ToolInputError quando nome do parâmetro != nome do front-matter", async () => {
    const env = createTestEnv({ R2_SKILLS: createFakeR2() });

    await expect(
      publicar.handler(env, {
        nome: "nome-a",
        conteudo_markdown: fixtureSkillMd({ nome: "nome-b" }),
        destino: "active",
        sobrescrever: false,
      }),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it("lança ToolInputError quando front-matter ausente", async () => {
    const env = createTestEnv({ R2_SKILLS: createFakeR2() });

    await expect(
      publicar.handler(env, {
        nome: "sem-fm",
        conteudo_markdown:
          "apenas corpo markdown sem front-matter, mas longo o suficiente para passar o min.",
        destino: "active",
        sobrescrever: false,
      }),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it("lança ToolInputError quando metadata incompleto", async () => {
    const env = createTestEnv({ R2_SKILLS: createFakeR2() });

    const md = [
      "---",
      "nome: incompleta",
      'descricao: "Apenas dois campos"',
      "---",
      "corpo",
    ].join("\n");

    await expect(
      publicar.handler(env, {
        nome: "incompleta",
        conteudo_markdown: md,
        destino: "active",
        sobrescrever: false,
      }),
    ).rejects.toBeInstanceOf(ToolInputError);
  });
});
