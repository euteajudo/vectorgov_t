/**
 * Montagem e execução do motor PEVS — fonte ÚNICA usada por todos os
 * pontos de entrada (endpoint `/api/peticoes/upload` e tool de análise do
 * chat do notebook). Evita duplicar a construção llm + tools + sessionAgent
 * + engine em vários lugares.
 */
import type { Env } from "../env.js";
import { GoogleLLMClient } from "./llm/google.js";
import { PEVSEngine, type PEVSConfig } from "./pevs-engine.js";
import { buildToolsForPEVS } from "./tools-adapter.js";
import { getSessionAgentClient } from "./session-loader.js";
import type { SessionAgent } from "./session-agent.js";
import { getModelConfig } from "../lib/model-config.js";
import type { Peticao, AnaliseReequilibrio } from "@vectorgov-t/schemas";

export type OnFase = PEVSConfig["onFase"];

/**
 * Constrói um PEVSEngine pronto para uso, com as dependências reais de
 * produção (LLM Google com a apiKey do request, catálogo de tools via
 * buildToolsForPEVS — que inclui buscar_legislacao e
 * calcular_reequilibrio_tributario — config de modelos do KV e o
 * SessionAgent para persistência).
 */
export async function criarEnginePEVS(
  env: Env,
  apiKey: string,
  opts: { onFase?: OnFase } = {},
): Promise<PEVSEngine> {
  const llm = new GoogleLLMClient(apiKey);
  const cfg = await getModelConfig(env);
  const tools = buildToolsForPEVS(env);
  const sessionAgent = getSessionAgentClient(env);
  return new PEVSEngine({
    llm,
    // SessionAgentClient implementa só os métodos que o engine usa; o cast
    // é seguro (o engine só toca analisarPeticao no F1, gerarParecer no F2).
    sessionAgent: sessionAgent as unknown as SessionAgent,
    tools,
    modelos: cfg.modelos,
    onFase: opts.onFase,
  });
}

/**
 * Roda a análise completa (Feature 1) de uma petição já estruturada.
 * Retorna a AnaliseReequilibrio (e o restante do ResultadoFeature1).
 * A persistência da análise no SessionAgent acontece dentro do engine.
 */
export async function rodarAnalisePeticao(
  env: Env,
  peticao: Peticao,
  apiKey: string,
  opts: { onFase?: OnFase } = {},
): Promise<{ analise: AnaliseReequilibrio; retries_executados: number }> {
  const engine = await criarEnginePEVS(env, apiKey, opts);
  const { analise, retries_executados } = await engine.executarFeature1(peticao);
  return { analise, retries_executados };
}
