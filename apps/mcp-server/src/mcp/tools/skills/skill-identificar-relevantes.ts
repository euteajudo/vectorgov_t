/**
 * Tool MCP `skill_identificar_relevantes` — usa LLM Flash para escolher
 * 1 a 3 skills relevantes dado o texto de uma tarefa.
 *
 * Estratégia:
 *   1. Carrega o `_meta.json` (via mesma rotina do `skill_listar`).
 *   2. Constrói prompt curto com a lista de skills (nome + descrição).
 *   3. Chama Gemini 3.5 Flash com `generateObject` (structured output) e
 *      schema Zod, restringindo a resposta a até `max_skills` itens.
 *   4. Valida + filtra resultados (descarta nomes inválidos / duplicados).
 *
 * Por que Flash? Custo + latência: o índice é pequeno e a decisão é
 * essencialmente classificatória. Pro só faria sentido se precisássemos
 * raciocínio multi-step sobre o conteúdo da tarefa.
 *
 * Fallback se `GOOGLE_API_KEY` não estiver disponível: devolvemos uma
 * heurística baseada em palavras-chave (`trigger.palavras_chave`) para
 * que a tool funcione mesmo em dev / ambientes sem secret.
 */

import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import {
  MetaIndex,
  SkillCarregarOutput,
  SkillIdentificarRelevantesInput,
  SkillIdentificarRelevantesOutput,
  SkillListItem,
  SkillRecomendacao,
  SKILL_KV_KEY_META,
  SKILL_KV_TTL_META,
  SKILL_R2_KEY_META_JSON,
} from "@vectorgov-t/schemas";
import { cacheGet, cacheSet } from "../../../lib/cache.js";
import type { Env } from "../../../env.js";
import { registerTool, ToolExecutionError } from "../registry.js";
import { __test as carregarTestHelpers } from "./skill-carregar.js";

void carregarTestHelpers; // mantém efeito colateral de registro

/**
 * JSON Schema espelhado do Zod.
 */
const inputSchemaJson = {
  type: "object",
  additionalProperties: false,
  required: ["descricao_tarefa"],
  properties: {
    descricao_tarefa: {
      type: "string",
      minLength: 20,
      maxLength: 2000,
      description: "Texto da tarefa que o agente vai executar.",
    },
    agente_solicitante: {
      type: "string",
      enum: [
        "orquestrador",
        "pesquisador",
        "analista-juridico",
        "especialista-licitacoes",
        "especialista-reequilibrio",
        "calculista",
        "auditor",
        "redator",
      ],
      description:
        "Identificador do agente que está pedindo a recomendação (opcional, restringe candidatas).",
    },
    max_skills: {
      type: "integer",
      minimum: 1,
      maximum: 3,
      default: 3,
      description: "Quantidade máxima de skills a recomendar.",
    },
  },
} as const;

/**
 * Schema interno para validar a saída do LLM (formato structured output).
 *
 * Mantemos separado de `SkillRecomendacao` porque o modelo às vezes
 * devolve nomes que não estão no catálogo — filtramos antes de expor ao
 * caller.
 */
const LlmResponse = z.object({
  recomendadas: z
    .array(
      z.object({
        nome: z.string(),
        motivo: z.string(),
        score: z.number().min(0).max(1),
      }),
    )
    .max(3),
  raciocinio: z.string(),
});

/**
 * Carrega `_meta.json` — reusa estratégia cache-first do `skill_listar`,
 * mas inline para evitar acoplamento circular entre tools.
 */
async function carregarMeta(env: Env): Promise<MetaIndex | null> {
  const fromCache = await cacheGet<unknown>(env, SKILL_KV_KEY_META);
  if (fromCache !== null) {
    const parsed = MetaIndex.safeParse(fromCache);
    if (parsed.success) return parsed.data;
  }
  const obj = await env.R2_SKILLS.get(SKILL_R2_KEY_META_JSON);
  if (!obj) return null;
  try {
    const raw = await obj.json();
    const parsed = MetaIndex.safeParse(raw);
    if (!parsed.success) return null;
    try {
      await cacheSet(env, SKILL_KV_KEY_META, parsed.data, SKILL_KV_TTL_META);
    } catch {
      /* cache best-effort */
    }
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Filtra candidatas por agente solicitante, quando informado.
 */
function filtrarCandidatas(
  skills: SkillListItem[],
  input: SkillIdentificarRelevantesInput,
): SkillListItem[] {
  if (!input.agente_solicitante) return skills;
  return skills.filter((s) =>
    s.agentes_aplicaveis.includes(input.agente_solicitante!),
  );
}

/**
 * Constrói o prompt do LLM. Mantém compacto — gasto de tokens é em
 * descrições, não em instruções verbosas.
 */
function montarPrompt(
  candidatas: SkillListItem[],
  input: SkillIdentificarRelevantesInput,
): { system: string; prompt: string } {
  const catalogo = candidatas
    .map((s, i) => `${i + 1}. ${s.nome} — ${s.descricao}`)
    .join("\n");
  const system =
    "Você seleciona skills relevantes para uma tarefa jurídico-tributária. " +
    "Escolha apenas skills do catálogo abaixo. Retorne JSON com no máximo " +
    `${input.max_skills} skills, ordenadas por relevância decrescente. ` +
    "Não invente nomes. Score entre 0 e 1.";
  const prompt = [
    "Catálogo de skills disponíveis:",
    catalogo,
    "",
    "Tarefa a executar:",
    input.descricao_tarefa,
  ].join("\n");
  return { system, prompt };
}

/**
 * Heurística de fallback: marca skills cuja `descricao` contém alguma
 * palavra-chave da tarefa. Suficiente para dev / quando o LLM falhar.
 *
 * Como aqui não temos as `trigger.palavras_chave` no `_meta` (mantemos
 * leve), fazemos matching grosseiro pelo texto da descrição.
 */
function fallbackHeuristico(
  candidatas: SkillListItem[],
  input: SkillIdentificarRelevantesInput,
): SkillIdentificarRelevantesOutput {
  const tokens = input.descricao_tarefa
    .toLowerCase()
    .split(/[^a-záéíóúâêôãõç0-9]+/i)
    .filter((t) => t.length > 4);
  const scored = candidatas.map((s) => {
    const lower = `${s.nome} ${s.descricao}`.toLowerCase();
    const hits = tokens.filter((t) => lower.includes(t)).length;
    return { skill: s, hits };
  });
  const top = scored
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, input.max_skills);
  const recomendadas: SkillRecomendacao[] = top.map((x) => ({
    nome: x.skill.nome,
    motivo: `match heurístico: ${x.hits} termo(s) em comum`,
    score: Math.min(1, x.hits / 5),
  }));
  return SkillIdentificarRelevantesOutput.parse({
    recomendadas,
    raciocinio:
      "Heurística por palavras-chave (LLM indisponível ou GOOGLE_API_KEY ausente).",
  });
}

/**
 * Chama o LLM e parseia a resposta. Trata erros como cair no fallback.
 */
async function chamarLlm(
  env: Env,
  candidatas: SkillListItem[],
  input: SkillIdentificarRelevantesInput,
): Promise<SkillIdentificarRelevantesOutput> {
  if (!env.GOOGLE_API_KEY) {
    return fallbackHeuristico(candidatas, input);
  }

  const provider = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
  const model = provider("gemini-2.5-flash");
  const { system, prompt } = montarPrompt(candidatas, input);

  let resultado;
  try {
    resultado = await generateObject({
      model,
      schema: LlmResponse,
      system,
      prompt,
      temperature: 0,
    });
  } catch {
    // LLM falhou (quota, rede, parsing) — fallback determinístico.
    return fallbackHeuristico(candidatas, input);
  }

  // Filtra nomes inválidos (modelo inventou) e deduplica.
  const nomesValidos = new Set(candidatas.map((c) => c.nome));
  const vistos = new Set<string>();
  const recomendadas: SkillRecomendacao[] = [];
  for (const r of resultado.object.recomendadas) {
    if (!nomesValidos.has(r.nome)) continue;
    if (vistos.has(r.nome)) continue;
    vistos.add(r.nome);
    recomendadas.push({
      nome: r.nome,
      motivo: r.motivo.slice(0, 300),
      score: Math.max(0, Math.min(1, r.score)),
    });
    if (recomendadas.length >= input.max_skills) break;
  }

  return SkillIdentificarRelevantesOutput.parse({
    recomendadas,
    raciocinio: resultado.object.raciocinio,
  });
}

/**
 * Handler principal — orquestra meta load, filtro, LLM e fallback.
 */
async function handler(
  env: Env,
  input: SkillIdentificarRelevantesInput,
): Promise<SkillIdentificarRelevantesOutput> {
  const meta = await carregarMeta(env);
  if (!meta || meta.skills.length === 0) {
    throw new ToolExecutionError(
      "Nenhuma skill ativa disponível para análise de relevância",
    );
  }
  const candidatas = filtrarCandidatas(meta.skills, input);
  if (candidatas.length === 0) {
    return SkillIdentificarRelevantesOutput.parse({
      recomendadas: [],
      raciocinio: "Nenhuma skill aplicável ao agente solicitante.",
    });
  }
  return chamarLlm(env, candidatas, input);
}

registerTool({
  name: "skill_identificar_relevantes",
  description:
    "Sugere 1-3 skills relevantes para uma tarefa (Gemini 3.5 Flash). Sem GOOGLE_API_KEY, usa heurística por palavras-chave.",
  inputSchema: inputSchemaJson,
  zodSchema: SkillIdentificarRelevantesInput,
  handler,
});

// Reexpõe alguns símbolos para testes diretos sem chamada de rede.
export const __test = {
  filtrarCandidatas,
  fallbackHeuristico,
  carregarMeta,
  handler,
};

// Reexporta tipo para tornar útil o import dispatcher.
export type { SkillCarregarOutput };
