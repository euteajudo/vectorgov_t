/**
 * Cliente HTTP da configuração (modelos + teste de chave).
 */

const BASE =
  process.env.NEXT_PUBLIC_MCP_BASE_URL ??
  "https://vectorgov-t-mcp.souzat19.workers.dev";

export const FUNCOES_MODELO = [
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

export type FuncaoModelo = (typeof FUNCOES_MODELO)[number];

export const MODELOS_LLM = ["gemini-3.5-flash", "gemini-3-pro"] as const;
export type ModeloLLM = (typeof MODELOS_LLM)[number];

/**
 * Rótulos amigáveis em pt-BR pra cada função (UI).
 */
export const ROTULOS_FUNCAO: Record<FuncaoModelo, string> = {
  chat_orquestrador: "Chat — Orquestrador",
  pevs_orquestrador: "PEVS — Orquestrador (planner)",
  pevs_pesquisador: "PEVS — Pesquisador",
  pevs_analista: "PEVS — Analista jurídico tributário",
  pevs_esp_licitacoes: "PEVS — Especialista em Licitações",
  pevs_esp_reequilibrio: "PEVS — Especialista em Reequilíbrio",
  pevs_calculista: "PEVS — Calculista",
  pevs_auditor: "PEVS — Auditor (verifica citações)",
  pevs_redator: "PEVS — Redator (parecer final)",
};

export interface ModelConfig {
  modelos: Record<FuncaoModelo, ModeloLLM>;
}

export async function getModelConfig(): Promise<ModelConfig> {
  const res = await fetch(`${BASE}/api/config/models`);
  if (!res.ok) {
    throw new Error(`GET /api/config/models falhou: ${res.status}`);
  }
  return (await res.json()) as ModelConfig;
}

export async function setModelConfig(
  partial: Partial<Record<FuncaoModelo, ModeloLLM>>,
): Promise<ModelConfig> {
  const res = await fetch(`${BASE}/api/config/models`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelos: partial }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`PUT /api/config/models ${res.status}: ${detail}`);
  }
  return (await res.json()) as ModelConfig;
}

export interface TesteChaveResult {
  ok: boolean;
  message?: string;
}

export async function testarChave(apiKey: string): Promise<TesteChaveResult> {
  const res = await fetch(`${BASE}/api/config/test-key`, {
    method: "POST",
    headers: { "X-Google-API-Key": apiKey },
  });
  try {
    return (await res.json()) as TesteChaveResult;
  } catch {
    return { ok: false, message: `HTTP ${res.status}` };
  }
}
