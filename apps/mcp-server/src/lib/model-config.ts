/**
 * Persistência da configuração de modelos por função.
 *
 * Cada função do sistema (chat orquestrador + 8 agentes PEVS) pode ter
 * um modelo Gemini específico. Armazenamos como JSON em KV (`CACHE`)
 * sob a chave `config:models`. Caller (handler ou DO) chama
 * `getModelConfig(env)` no início de cada operação que dispara LLM.
 *
 * Defaults: Flash em todos exceto Auditor (Pro, thinking).
 */
import { z } from "zod";
import type { Env } from "../env.js";

/**
 * Funções configuráveis. Mantém o naming alinhado com o sistema:
 *  - `chat_*` para o chat NotebookLM.
 *  - `pevs_*` para o motor PEVS (8 roles).
 */
export const FUNCAO_MODELO = [
  "chat_orquestrador",
  "pevs_orquestrador",
  "pevs_pesquisador",
  "pevs_analista",
  "pevs_esp_licitacoes",
  "pevs_esp_reequilibrio",
  "pevs_calculista",
  "pevs_auditor",
  "pevs_redator",
] as const;

export type FuncaoModelo = (typeof FUNCAO_MODELO)[number];

/**
 * Modelos LLM aceitos — mesma union do `agents/llm/types.ts`.
 * Redeclarado aqui pra evitar import circular com llm/types.
 */
export const MODELO_LLM = ["gemini-3.5-flash", "gemini-3-pro"] as const;
export type ModeloLLM = (typeof MODELO_LLM)[number];

/**
 * Schema do JSON salvo em KV.
 *
 * Declarado explicitamente para evitar dança de tipagem com Zod 4
 * (z.enum sobre tupla readonly não casa bem com Object.fromEntries
 * em TS strict).
 */
const ModeloEnum = z.enum(["gemini-3.5-flash", "gemini-3-pro"]);
export const ModelConfigSchema = z.object({
  modelos: z.object({
    chat_orquestrador: ModeloEnum,
    pevs_orquestrador: ModeloEnum,
    pevs_pesquisador: ModeloEnum,
    pevs_analista: ModeloEnum,
    pevs_esp_licitacoes: ModeloEnum,
    pevs_esp_reequilibrio: ModeloEnum,
    pevs_calculista: ModeloEnum,
    pevs_auditor: ModeloEnum,
    pevs_redator: ModeloEnum,
  }),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

const KV_KEY = "config:models";

/**
 * Defaults — usados quando o KV está vazio ou tem keys faltando.
 */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  modelos: {
    chat_orquestrador: "gemini-3.5-flash",
    pevs_orquestrador: "gemini-3.5-flash",
    pevs_pesquisador: "gemini-3.5-flash",
    pevs_analista: "gemini-3.5-flash",
    pevs_esp_licitacoes: "gemini-3.5-flash",
    pevs_esp_reequilibrio: "gemini-3.5-flash",
    pevs_calculista: "gemini-3.5-flash",
    pevs_auditor: "gemini-3-pro",
    pevs_redator: "gemini-3.5-flash",
  },
};

/**
 * Lê config do KV e mergea com defaults — garante que toda função
 * tem um modelo válido mesmo se o KV tem JSON incompleto/corrompido.
 */
export async function getModelConfig(env: Env): Promise<ModelConfig> {
  const raw = await env.CACHE.get(KV_KEY);
  if (!raw) return DEFAULT_MODEL_CONFIG;
  try {
    const parsed = JSON.parse(raw) as { modelos?: Record<string, unknown> };
    const modelos = { ...DEFAULT_MODEL_CONFIG.modelos };
    for (const f of FUNCAO_MODELO) {
      const v = parsed.modelos?.[f];
      if (typeof v === "string" && (MODELO_LLM as readonly string[]).includes(v)) {
        modelos[f] = v as ModeloLLM;
      }
    }
    return { modelos };
  } catch {
    return DEFAULT_MODEL_CONFIG;
  }
}

/**
 * Atualiza config no KV. Faz merge com a existente — caller pode mandar
 * apenas as funções que quer mudar. Valida via Zod antes de gravar.
 */
export async function setModelConfig(
  env: Env,
  partial: { modelos: Partial<Record<FuncaoModelo, ModeloLLM>> },
): Promise<ModelConfig> {
  const atual = await getModelConfig(env);
  const proposto: ModelConfig = {
    modelos: { ...atual.modelos, ...partial.modelos },
  };
  const validado = ModelConfigSchema.parse(proposto);
  await env.CACHE.put(KV_KEY, JSON.stringify(validado));
  return validado;
}
