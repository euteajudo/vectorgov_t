/**
 * Testes da tool `skill_listar`.
 *
 * Cobre:
 *   - Cache miss → R2 hit → popula cache + reporta fonte='r2'.
 *   - Cache hit → reporta fonte='cache'.
 *   - Filtro por categoria.
 *   - Filtro por agente.
 *   - Bucket vazio devolve `total=0`.
 */

import { describe, expect, it } from "vitest";
import {
  SKILL_KV_KEY_META,
  SKILL_R2_KEY_META_JSON,
  type MetaIndex,
} from "@vectorgov-t/schemas";
import { __test as listar } from "../src/mcp/tools/skills/skill-listar.js";
import { createTestEnv, createFakeR2 } from "./_fakes.js";

function seedMeta(meta: MetaIndex): string {
  return JSON.stringify(meta);
}

const META_FIXTURE: MetaIndex = {
  versao_formato: "1.0.0",
  gerado_em: "2026-05-26T00:00:00.000Z",
  total_skills: 3,
  skills: [
    {
      nome: "skill-petic",
      descricao: "Skill de análise de petição",
      categoria: "analise-peticao",
      versao: "1.0.0",
      tokens_aproximados: 500,
      agentes_aplicaveis: ["analista-juridico", "orquestrador"],
    },
    {
      nome: "skill-parec",
      descricao: "Skill de redação de parecer",
      categoria: "geracao-parecer",
      versao: "1.0.0",
      tokens_aproximados: 700,
      agentes_aplicaveis: ["redator"],
    },
    {
      nome: "skill-calc",
      descricao: "Skill de cálculo IBS/CBS",
      categoria: "calculo-tributario",
      versao: "1.0.0",
      tokens_aproximados: 600,
      agentes_aplicaveis: ["calculista"],
    },
  ],
  por_categoria: {
    "analise-peticao": ["skill-petic"],
    "geracao-parecer": ["skill-parec"],
    "calculo-tributario": ["skill-calc"],
  },
};

describe("skill_listar — handler", () => {
  it("lê do R2 quando cache não tem e popula cache", async () => {
    const r2 = createFakeR2();
    r2.__seed({ [SKILL_R2_KEY_META_JSON]: seedMeta(META_FIXTURE) });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const out = await listar.handler(env, {});
    expect(out.fonte).toBe("r2");
    expect(out.total).toBe(3);

    // Cache populado: próxima chamada vem do cache.
    const cached = await env.CACHE.get(SKILL_KV_KEY_META);
    expect(cached).not.toBeNull();

    const out2 = await listar.handler(env, {});
    expect(out2.fonte).toBe("cache");
    expect(out2.total).toBe(3);
  });

  it("devolve total=0 e lista vazia quando bucket não tem _meta.json", async () => {
    const r2 = createFakeR2(); // vazio
    const env = createTestEnv({ R2_SKILLS: r2 });
    const out = await listar.handler(env, {});
    expect(out.total).toBe(0);
    expect(out.skills).toHaveLength(0);
  });

  it("filtra por categoria", async () => {
    const r2 = createFakeR2();
    r2.__seed({ [SKILL_R2_KEY_META_JSON]: seedMeta(META_FIXTURE) });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const out = await listar.handler(env, { categoria: "geracao-parecer" });
    expect(out.total).toBe(1);
    expect(out.skills[0]!.nome).toBe("skill-parec");
  });

  it("filtra por agente", async () => {
    const r2 = createFakeR2();
    r2.__seed({ [SKILL_R2_KEY_META_JSON]: seedMeta(META_FIXTURE) });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const out = await listar.handler(env, { agente: "calculista" });
    expect(out.total).toBe(1);
    expect(out.skills[0]!.nome).toBe("skill-calc");
  });
});
