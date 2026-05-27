/**
 * Tool MCP `skill_carregar` — baixa o conteúdo completo de uma skill.
 *
 * Estratégia (cache-first com TTL curto):
 *   1. KV `skill:active:<nome>` (TTL 60s).
 *   2. R2 `active/<nome>.md`.
 *   3. Erro `ToolExecutionError` se não existir em nenhum lugar.
 *
 * TTL curto (60s) é proposital: skills mudam por publicação direta sem
 * deploy do Worker. Esperar até 1 minuto após `skill_publicar` para que
 * todos os isolates vejam a nova versão é aceitável; horizonte maior
 * exigiria invalidação ativa de cache distribuído.
 */

import {
  SkillCarregarInput,
  SkillCarregarOutput,
  SkillFull,
  SkillMetadata,
  SKILL_KV_KEY_SKILL_PREFIX,
  SKILL_KV_TTL_SKILL,
  SKILL_R2_PREFIX_ACTIVE,
} from "@vectorgov-t/schemas";
import { cacheGet, cacheSet } from "../../../lib/cache.js";
import { parseFrontmatter } from "../../../lib/yaml-frontmatter.js";
import type { Env } from "../../../env.js";
import { registerTool, ToolExecutionError } from "../registry.js";

/**
 * JSON Schema espelhado — exposto em `tools/list`.
 */
const inputSchemaJson = {
  type: "object",
  additionalProperties: false,
  required: ["nome"],
  properties: {
    nome: {
      type: "string",
      pattern: "^[a-z0-9-]+$",
      minLength: 3,
      description: "Nome canônico da skill (kebab-case, sem extensão).",
    },
  },
} as const;

/**
 * Constrói a chave R2 a partir do nome canônico.
 */
function r2KeyFromNome(nome: string): string {
  return `${SKILL_R2_PREFIX_ACTIVE}${nome}.md`;
}

/**
 * Constrói a chave KV de cache.
 */
function kvKeyFromNome(nome: string): string {
  return `${SKILL_KV_KEY_SKILL_PREFIX}${nome}`;
}

/**
 * Faz o parse de markdown bruto em `SkillFull`. Valida metadata via Zod.
 *
 * Lança `ToolExecutionError` se o conteúdo for inválido — sinaliza ao
 * caller que a skill existe mas tem bug e precisa ser corrigida.
 */
function parsearSkill(markdown: string, r2Key: string): SkillFull {
  let parsed;
  try {
    parsed = parseFrontmatter(markdown);
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    throw new ToolExecutionError(
      `Falha ao parsear front-matter de ${r2Key}: ${message}`,
    );
  }
  const metaResult = SkillMetadata.safeParse(parsed.data);
  if (!metaResult.success) {
    throw new ToolExecutionError(
      `Metadata inválido em ${r2Key}`,
      metaResult.error.issues,
    );
  }
  return SkillFull.parse({
    metadata: metaResult.data,
    corpo_markdown: parsed.body.trimStart(),
    r2_key: r2Key,
  });
}

/**
 * Resolve a skill — cache primeiro, R2 depois, populando cache no caminho.
 *
 * Cache armazena o objeto `SkillFull` já validado (economiza re-parse).
 */
async function resolverSkill(
  env: Env,
  nome: string,
): Promise<{ skill: SkillFull; fonte: "cache" | "r2" }> {
  const cacheKey = kvKeyFromNome(nome);
  const fromCache = await cacheGet<unknown>(env, cacheKey);
  if (fromCache !== null) {
    const parsed = SkillFull.safeParse(fromCache);
    if (parsed.success) {
      return { skill: parsed.data, fonte: "cache" };
    }
    // Cache corrompido — segue para R2.
  }

  const r2Key = r2KeyFromNome(nome);
  const obj = await env.R2_SKILLS.get(r2Key);
  if (!obj) {
    throw new ToolExecutionError(`Skill '${nome}' não encontrada no R2`);
  }
  const markdown = await obj.text();
  const skill = parsearSkill(markdown, r2Key);

  // Popula cache best-effort. Falha não derruba a resposta.
  try {
    await cacheSet(env, cacheKey, skill, SKILL_KV_TTL_SKILL);
  } catch {
    // KV indisponível — segue.
  }

  return { skill, fonte: "r2" };
}

/**
 * Handler da tool — valida saída contra `SkillCarregarOutput`.
 */
async function handler(
  env: Env,
  input: SkillCarregarInput,
): Promise<SkillCarregarOutput> {
  const { skill, fonte } = await resolverSkill(env, input.nome);
  return SkillCarregarOutput.parse({ skill, fonte });
}

registerTool({
  name: "skill_carregar",
  description:
    "Baixa o conteúdo markdown completo de uma skill ativa (metadata + corpo). Cache KV de 60s.",
  inputSchema: inputSchemaJson,
  zodSchema: SkillCarregarInput,
  handler,
});

export const __test = { parsearSkill, resolverSkill, handler };
