/**
 * Tool MCP `skill_listar` — devolve o índice agregado de skills ativas.
 *
 * Estratégia de leitura (cache-first):
 *   1. Tenta KV `skill:_meta` (TTL 5 min).
 *   2. Se miss/corrupção: busca `_meta.json` do R2 e popula o cache.
 *   3. Se R2 também não tiver: devolve índice vazio (`total = 0`).
 *
 * Filtros opcionais (`categoria`, `agente`) são aplicados pós-leitura —
 * a meta-skill é pequena (~10-50 skills), então filtrar em memória é
 * barato e simplifica o cache.
 */

import {
  MetaIndex,
  SkillListarInput,
  SkillListarOutput,
  SKILL_KV_KEY_META,
  SKILL_KV_TTL_META,
  SKILL_R2_KEY_META_JSON,
} from "@vectorgov-t/schemas";
import { cacheGet, cacheSet } from "../../../lib/cache.js";
import type { Env } from "../../../env.js";
import { registerTool } from "../registry.js";

/**
 * JSON Schema espelhado do Zod — exposto em `tools/list`.
 *
 * Mantemos manual para evitar dependência `zod-to-json-schema` no Worker
 * (o conjunto de tools é pequeno e o overhead não compensa).
 */
const inputSchemaJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    categoria: {
      type: "string",
      enum: [
        "analise-peticao",
        "geracao-parecer",
        "calculo-tributario",
        "pesquisa-legislacao",
        "utilidades",
      ],
      description: "Filtra skills por categoria canônica (opcional).",
    },
    agente: {
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
      description: "Filtra skills aplicáveis a um agente específico (opcional).",
    },
  },
} as const;

/**
 * Carrega o índice — fonte 'cache' se KV bater, 'r2' caso contrário.
 *
 * Tipo de retorno carrega a fonte para o caller reportar telemetria
 * (útil para medir taxa de hit do cache).
 */
async function carregarMetaIndex(
  env: Env,
): Promise<{ index: MetaIndex | null; fonte: "cache" | "r2" }> {
  const fromCache = await cacheGet<unknown>(env, SKILL_KV_KEY_META);
  if (fromCache !== null) {
    const parsed = MetaIndex.safeParse(fromCache);
    if (parsed.success) {
      return { index: parsed.data, fonte: "cache" };
    }
    // Cache corrompido (formato antigo após upgrade?) — invalida e segue p/ R2.
  }

  const obj = await env.R2_SKILLS.get(SKILL_R2_KEY_META_JSON);
  if (!obj) return { index: null, fonte: "r2" };

  let raw: unknown;
  try {
    raw = await obj.json();
  } catch {
    return { index: null, fonte: "r2" };
  }

  const parsed = MetaIndex.safeParse(raw);
  if (!parsed.success) return { index: null, fonte: "r2" };

  // Popula cache (best-effort).
  try {
    await cacheSet(env, SKILL_KV_KEY_META, parsed.data, SKILL_KV_TTL_META);
  } catch {
    // Cache offline não invalida resposta.
  }

  return { index: parsed.data, fonte: "r2" };
}

/**
 * Aplica filtros opcionais. Retorna nova lista (não muta input).
 */
function aplicarFiltros(
  index: MetaIndex,
  filtros: SkillListarInput,
): MetaIndex["skills"] {
  let lista = index.skills;
  if (filtros.categoria) {
    lista = lista.filter((s) => s.categoria === filtros.categoria);
  }
  if (filtros.agente) {
    lista = lista.filter((s) => s.agentes_aplicaveis.includes(filtros.agente!));
  }
  return lista;
}

/**
 * Handler da tool. Devolve estrutura validada contra `SkillListarOutput`.
 */
async function handler(
  env: Env,
  input: SkillListarInput,
): Promise<SkillListarOutput> {
  const { index, fonte } = await carregarMetaIndex(env);
  if (!index) {
    return SkillListarOutput.parse({ total: 0, skills: [], fonte });
  }
  const filtradas = aplicarFiltros(index, input);
  return SkillListarOutput.parse({
    total: filtradas.length,
    skills: filtradas,
    fonte,
  });
}

/**
 * Registra a tool no boot. Idempotente em condições normais — o registry
 * lança se a mesma tool tentar registrar duas vezes.
 */
registerTool({
  name: "skill_listar",
  description:
    "Lista as skills ativas no R2 com possibilidade de filtro por categoria ou agente. Lê o _meta.json (cache KV 5min, fallback para R2).",
  inputSchema: inputSchemaJson,
  zodSchema: SkillListarInput,
  handler,
});

// Exporta para testes diretos sem depender do registry.
export const __test = { carregarMetaIndex, aplicarFiltros, handler };
