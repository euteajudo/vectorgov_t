/**
 * Testes da tool `skill_identificar_relevantes`.
 *
 * Não chamamos LLM real — sem `GOOGLE_API_KEY`, o handler cai no
 * fallback heurístico determinístico.
 *
 * Cobre:
 *   - Sem meta carregado → erro.
 *   - Sem skills aplicáveis ao agente → lista vazia (não falha).
 *   - Fallback heurístico bate em descrições com palavras-chave.
 */

import { describe, expect, it } from "vitest";
import {
  SKILL_R2_KEY_META_JSON,
  type MetaIndex,
} from "@vectorgov-t/schemas";
import { __test as identificar } from "../src/mcp/tools/skills/skill-identificar-relevantes.js";
import { ToolExecutionError } from "../src/mcp/tools/registry.js";
import { createTestEnv, createFakeR2 } from "./_fakes.js";

const META_FIXTURE: MetaIndex = {
  versao_formato: "1.0.0",
  gerado_em: "2026-05-26T00:00:00.000Z",
  total_skills: 3,
  skills: [
    {
      nome: "extracao-estruturada-peticao",
      descricao:
        "Extrai dados estruturados de uma petição de reequilíbrio econômico financeiro.",
      categoria: "analise-peticao",
      versao: "1.0.0",
      tokens_aproximados: 800,
      agentes_aplicaveis: ["analista-juridico"],
      fases_aplicaveis: ["DOCUMENTO_RECEBIDO", "PETICAO_EXTRAIDA"],
    },
    {
      nome: "verificacao-prazo-pedido",
      descricao:
        "Verifica se o pedido foi protocolado dentro do prazo decadencial aplicável.",
      categoria: "analise-peticao",
      versao: "1.0.0",
      tokens_aproximados: 500,
      agentes_aplicaveis: ["analista-juridico", "orquestrador"],
      fases_aplicaveis: ["PETICAO_EXTRAIDA"],
    },
    {
      nome: "redacao-conclusao-recomendacoes",
      descricao: "Redige a seção final do parecer com a recomendação ao gestor.",
      categoria: "geracao-parecer",
      versao: "1.0.0",
      tokens_aproximados: 1200,
      agentes_aplicaveis: ["redator"],
      fases_aplicaveis: ["ANALISE_PRONTA"],
    },
  ],
  por_categoria: {
    "analise-peticao": ["extracao-estruturada-peticao", "verificacao-prazo-pedido"],
    "geracao-parecer": ["redacao-conclusao-recomendacoes"],
  },
  por_fase: {
    AGUARDANDO_DOCUMENTO: [],
    DOCUMENTO_RECEBIDO: ["extracao-estruturada-peticao"],
    PETICAO_EXTRAIDA: ["extracao-estruturada-peticao", "verificacao-prazo-pedido"],
    ANALISE_PRONTA: ["redacao-conclusao-recomendacoes"],
    PARECER_GERADO: [],
  },
};

describe("skill_identificar_relevantes — fallback heurístico", () => {
  it("retorna skills com palavras em comum quando GOOGLE_API_KEY ausente", async () => {
    const r2 = createFakeR2();
    r2.__seed({ [SKILL_R2_KEY_META_JSON]: JSON.stringify(META_FIXTURE) });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const out = await identificar.handler(env, {
      descricao_tarefa:
        "Preciso analisar uma petição de reequilíbrio econômico financeiro para extrair dados.",
      max_skills: 3,
    });

    expect(out.recomendadas.length).toBeGreaterThan(0);
    expect(out.recomendadas.length).toBeLessThanOrEqual(3);
    expect(out.recomendadas[0]!.nome).toBe("extracao-estruturada-peticao");
    expect(out.raciocinio).toMatch(/heurística|Heur/i);
  });

  it("retorna lista vazia (não falha) quando agente solicitante não tem skills", async () => {
    const r2 = createFakeR2();
    r2.__seed({ [SKILL_R2_KEY_META_JSON]: JSON.stringify(META_FIXTURE) });
    const env = createTestEnv({ R2_SKILLS: r2 });

    const out = await identificar.handler(env, {
      descricao_tarefa:
        "Calcular IBS e CBS para uma operação interestadual no novo regime.",
      agente_solicitante: "calculista",
      max_skills: 3,
    });

    expect(out.recomendadas).toHaveLength(0);
  });

  it("lança ToolExecutionError quando bucket não tem meta", async () => {
    const env = createTestEnv({ R2_SKILLS: createFakeR2() });

    await expect(
      identificar.handler(env, {
        descricao_tarefa:
          "Texto descritivo longo o suficiente para passar a validação Zod do schema.",
        max_skills: 2,
      }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});

describe("skill_identificar_relevantes — filtragem", () => {
  it("filtrarCandidatas reduz para skills com agente compatível", () => {
    const candidatas = META_FIXTURE.skills;
    const filtradas = identificar.filtrarCandidatas(candidatas, {
      descricao_tarefa: "ignored",
      agente_solicitante: "redator",
      max_skills: 3,
    });
    expect(filtradas.map((s) => s.nome)).toEqual([
      "redacao-conclusao-recomendacoes",
    ]);
  });
});
