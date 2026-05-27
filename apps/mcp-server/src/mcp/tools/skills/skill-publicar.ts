/**
 * Tool MCP `skill_publicar` — grava skill no R2 e regenera o `_meta`.
 *
 * Fluxo:
 *   1. Parse do front-matter do markdown recebido.
 *   2. Valida metadata via `SkillMetadata` (Zod).
 *   3. Confere coerência: nome do parâmetro == nome do front-matter.
 *   4. Verifica overwrite — se a key já existe e `sobrescrever=false`, falha.
 *   5. Grava em `active/<nome>.md` ou `candidate/<nome>.md`.
 *   6. Invalida cache da skill individual (`skill:active:<nome>`).
 *   7. Se destino == `active`: chama `regenerarMeta(env)`.
 *
 * Restrição: NÃO publica em `archived/` — esse status é manual via script
 * de manutenção (move de `active/` para `archive/` na origem `packages/skills`).
 */

import {
  SkillMetadata,
  SkillPublicarInput,
  SkillPublicarOutput,
  SKILL_KV_KEY_SKILL_PREFIX,
  SKILL_R2_PREFIX_ACTIVE,
  SKILL_R2_PREFIX_CANDIDATE,
} from "@vectorgov-t/schemas";
import { cacheDelete } from "../../../lib/cache.js";
import { parseFrontmatter } from "../../../lib/yaml-frontmatter.js";
import { regenerarMeta } from "../../../lib/skills-meta-generator.js";
import type { Env } from "../../../env.js";
import { registerTool, ToolExecutionError, ToolInputError } from "../registry.js";

/**
 * JSON Schema espelhado.
 */
const inputSchemaJson = {
  type: "object",
  additionalProperties: false,
  required: ["nome", "conteudo_markdown"],
  properties: {
    nome: {
      type: "string",
      pattern: "^[a-z0-9-]+$",
      minLength: 3,
      description: "Nome canônico (kebab-case, sem extensão).",
    },
    conteudo_markdown: {
      type: "string",
      minLength: 50,
      description: "Markdown completo com front-matter YAML.",
    },
    destino: {
      type: "string",
      enum: ["active", "candidate"],
      default: "active",
      description: "Destino da publicação. 'candidate' não entra no _meta.",
    },
    sobrescrever: {
      type: "boolean",
      default: false,
      description: "Permite substituir uma skill já existente com o mesmo nome.",
    },
  },
} as const;

/**
 * Calcula a chave R2 baseado no destino.
 */
function r2KeyFor(destino: "active" | "candidate", nome: string): string {
  const prefix =
    destino === "active" ? SKILL_R2_PREFIX_ACTIVE : SKILL_R2_PREFIX_CANDIDATE;
  return `${prefix}${nome}.md`;
}

/**
 * Extrai e valida metadata do markdown recebido.
 *
 * Lança `ToolInputError` (vira `-32602`) — é falha do cliente, não do servidor.
 */
function extrairMetadataValidada(
  conteudo: string,
  nomeEsperado: string,
): SkillMetadata {
  let parsed;
  try {
    parsed = parseFrontmatter(conteudo);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro desconhecido";
    throw new ToolInputError(`Front-matter inválido: ${msg}`);
  }

  const metaResult = SkillMetadata.safeParse(parsed.data);
  if (!metaResult.success) {
    throw new ToolInputError(
      "Metadata da skill não passou na validação Zod",
      metaResult.error.issues,
    );
  }
  if (metaResult.data.nome !== nomeEsperado) {
    throw new ToolInputError(
      `Inconsistência: parâmetro 'nome' é '${nomeEsperado}' mas front-matter diz '${metaResult.data.nome}'`,
    );
  }
  return metaResult.data;
}

/**
 * Handler da tool.
 */
async function handler(
  env: Env,
  input: SkillPublicarInput,
): Promise<SkillPublicarOutput> {
  const metadata = extrairMetadataValidada(input.conteudo_markdown, input.nome);
  const r2Key = r2KeyFor(input.destino, input.nome);

  // Check overwrite.
  if (!input.sobrescrever) {
    const existing = await env.R2_SKILLS.head(r2Key);
    if (existing) {
      throw new ToolExecutionError(
        `Skill já existe em ${r2Key} (use sobrescrever=true para substituir)`,
      );
    }
  }

  // Grava o markdown completo (front-matter + corpo).
  await env.R2_SKILLS.put(r2Key, input.conteudo_markdown, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    customMetadata: {
      versao: metadata.versao,
      categoria: metadata.categoria,
      data_atualizacao: metadata.data_atualizacao,
    },
  });

  // Invalida cache individual (segura mesmo se a skill for candidate).
  try {
    await cacheDelete(env, `${SKILL_KV_KEY_SKILL_PREFIX}${input.nome}`);
  } catch {
    /* best-effort */
  }

  // Só regenera meta quando vai pro índice (active).
  let metaRegenerado = false;
  if (input.destino === "active") {
    await regenerarMeta(env);
    metaRegenerado = true;
  }

  return SkillPublicarOutput.parse({
    publicado: true,
    r2_key: r2Key,
    metadata,
    meta_regenerado: metaRegenerado,
  });
}

registerTool({
  name: "skill_publicar",
  description:
    "Publica uma skill em active/ ou candidate/ no R2_SKILLS e regenera o _meta quando ativa.",
  inputSchema: inputSchemaJson,
  zodSchema: SkillPublicarInput,
  handler,
});

export const __test = { extrairMetadataValidada, r2KeyFor, handler };
