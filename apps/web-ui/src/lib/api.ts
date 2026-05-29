/**
 * Cliente HTTP tipado para a API REST do Worker MCP.
 *
 * Centralizar aqui todas as chamadas externas evita duplicação e facilita
 * adicionar cross-cutting concerns (telemetria, retry, cancelamento via
 * AbortController).
 *
 * Convenções:
 *  - Base URL vem de `NEXT_PUBLIC_MCP_BASE_URL` (configurado em next.config.mjs).
 *  - Erros HTTP viram `ApiError` com `.status` e `.code` para o React Query
 *    decidir retry/notificação.
 *  - Tudo é tipado via `@vectorgov-t/schemas` — não duplicamos types aqui.
 */
import type {
  AnaliseReequilibrio,
  Parecer,
  SkillFull,
  SkillListItem,
} from "@vectorgov-t/schemas";

const BASE =
  process.env.NEXT_PUBLIC_MCP_BASE_URL ??
  "https://vectorgov-t-mcp.souzat19.workers.dev";

/**
 * Erro de API estruturado — preserva status HTTP e código JSON-RPC quando
 * aplicável. O mensagem é compat com `error.message` do JS padrão.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Wrapper que centraliza fetch + parse + tratamento de erro.
 */
async function fetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail: { error?: string; message?: string } | null = null;
    try {
      detail = (await res.json()) as { error?: string; message?: string };
    } catch {
      // resposta não-JSON: ignora.
    }
    const msg =
      detail?.error ??
      detail?.message ??
      `${res.status} ${res.statusText}`;
    throw new ApiError(`${res.status}: ${msg}`, res.status);
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Tipos auxiliares para os endpoints REST (não cobertos pelo schemas package).
// ---------------------------------------------------------------------------

/**
 * Metadados básicos enviados junto com o PDF da petição.
 *
 * Em produção, o backend extrai mais campos pelo parser PDF; aqui o usuário
 * informa apenas o mínimo identificador.
 */
export interface PeticaoMetadata {
  // Identificação básica
  contrato_numero: string;
  requerente: string;
  contratante: string;
  contratante_cnpj?: string;
  contratado: string;
  contratado_cnpj?: string;
  data_protocolo: string; // YYYY-MM-DD

  // Dados do contrato (necessários pro PEVS engine)
  objeto: string;
  modalidade:
    | "pregao_eletronico"
    | "pregao_presencial"
    | "concorrencia"
    | "dispensa"
    | "inexigibilidade"
    | "concurso"
    | "leilao"
    | "dialogo_competitivo"
    | "outro";
  valor_contrato_centavos: number;
  data_assinatura: string; // YYYY-MM-DD

  // Núcleo do pedido
  fato_alegado: string;
  base_legal_invocada: string[];

  // Compatibilidade — não usados pelo PEVS mas mantidos pra histórico
  valor_pleiteado_centavos?: number;
  observacoes?: string;
}

/**
 * Resposta do `POST /api/peticoes/upload`.
 *
 * O `fase` reflete o ponto do pipeline PEVS em que a análise está
 * ("queued" antes de começar, "PLAN", "EXECUTE", ...).
 */
export interface PeticaoUploadResponse {
  id: string;
  fase:
    | "queued"
    | "PLAN"
    | "EXECUTE"
    | "ANALYZE"
    | "VERIFY"
    | "SYNTHESIZE"
    | "done"
    | "failed";
  iniciado_em: string;
}

export interface PeticaoStatusResponse {
  id: string;
  fase: PeticaoUploadResponse["fase"];
  progresso_pct: number;
  iniciado_em: string;
  atualizado_em: string;
  analise?: AnaliseReequilibrio;
  erro?: string;
}

export interface HistoricoFilters {
  contratante?: string;
  contratado?: string;
  veredito?: string;
  data_inicio?: string;
  data_fim?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface HistoricoItem {
  id: string;
  contrato_numero: string;
  contratante: string;
  contratado: string;
  data_protocolo: string;
  veredito: string;
  tem_parecer: boolean;
  parecer_aprovado: boolean;
  score_confianca: number;
}

export interface HistoricoPage {
  items: HistoricoItem[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// Endpoints REST consumidos pela UI.
// ---------------------------------------------------------------------------

/**
 * Lê o status / análise completa de uma petição pelo id.
 */
export async function getPeticao(id: string): Promise<PeticaoStatusResponse> {
  return fetchJson<PeticaoStatusResponse>(`/api/peticoes/${id}`);
}

/**
 * Dispara a geração de parecer formal para uma análise existente.
 *
 * Retorna o `Parecer` completo (assíncrono pode ser implementado depois
 * com status polling igual à análise — por enquanto bloqueia).
 */
export async function gerarParecer(
  id: string,
  apiKey: string,
): Promise<Parecer> {
  return fetchJson<Parecer>(`/api/peticoes/${id}/parecer`, {
    method: "POST",
    headers: { "X-Google-API-Key": apiKey },
  });
}

/**
 * Lê o parecer já gerado para uma análise.
 */
export async function getParecer(id: string): Promise<Parecer> {
  return fetchJson<Parecer>(`/api/peticoes/${id}/parecer`);
}

/**
 * Lista petições do histórico com filtros opcionais.
 */
export async function listarHistorico(
  filters: HistoricoFilters = {},
): Promise<HistoricoPage> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== "") {
      qs.set(k, String(v));
    }
  }
  const query = qs.toString();
  return fetchJson<HistoricoPage>(
    `/api/historico${query ? `?${query}` : ""}`,
  );
}

/**
 * Lista todas as skills (active + candidate).
 */
export async function listarSkills(): Promise<SkillListItem[]> {
  const data = await fetchJson<{ items: SkillListItem[] }>(`/api/skills`);
  return data.items;
}

/**
 * Catálogo de normas indexadas (via tool MCP `fs_listar_normas`).
 * Lê o `_index.json` do R2 — usado no dashboard para "normas indexadas".
 */
export async function listarNormas(): Promise<{
  total: number;
  normas: Array<{ norma_id: string; tipo: string; ementa: string | null }>;
}> {
  const res = await fetch(`${BASE}/mcp/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "fs_listar_normas", arguments: {} },
    }),
  });
  if (!res.ok) {
    throw new ApiError(`${res.status}: ${res.statusText}`, res.status);
  }
  const data = (await res.json()) as {
    result?: { content?: Array<{ text?: string }> };
  };
  const text = data.result?.content?.[0]?.text;
  if (!text) return { total: 0, normas: [] };
  const parsed = JSON.parse(text) as {
    total?: number;
    normas?: Array<{ norma_id: string; tipo: string; ementa: string | null }>;
  };
  return { total: parsed.total ?? 0, normas: parsed.normas ?? [] };
}

/**
 * Estatísticas agregadas do dashboard (página inicial).
 *
 * Combina endpoints REST existentes + a tool MCP de normas. Resiliente:
 * cada fonte falha de forma independente (Promise.allSettled) → o card
 * mostra "—" quando a fonte está indisponível, sem derrubar o resto.
 *
 * Obs.: `pareceres` é contado sobre a primeira página grande do histórico
 * (page_size=200) — exato enquanto o total couber nela.
 */
export interface DashboardStats {
  peticoes: number | null;
  pareceres: number | null;
  skills: number | null;
  normas: number | null;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [hist, skills, normas] = await Promise.allSettled([
    listarHistorico({ page_size: 200 }),
    listarSkills(),
    listarNormas(),
  ]);
  const histVal = hist.status === "fulfilled" ? hist.value : null;
  return {
    peticoes: histVal ? histVal.total : null,
    pareceres: histVal
      ? histVal.items.filter((i) => i.tem_parecer).length
      : null,
    skills: skills.status === "fulfilled" ? skills.value.length : null,
    normas: normas.status === "fulfilled" ? normas.value.total : null,
  };
}

/**
 * Carrega o markdown completo de uma skill pelo nome canônico.
 */
export async function carregarSkill(nome: string): Promise<SkillFull> {
  return fetchJson<SkillFull>(`/api/skills/${encodeURIComponent(nome)}`);
}

/**
 * Publica nova versão de skill (active ou candidate).
 *
 * Quando `promover=true` e `destino="candidate"`, o backend move a versão
 * candidata para active e arquiva a versão anterior.
 */
export async function publicarSkill(
  nome: string,
  conteudo: string,
  promover = false,
): Promise<{ publicado: boolean; r2_key: string }> {
  return fetchJson<{ publicado: boolean; r2_key: string }>(
    `/api/skills/${encodeURIComponent(nome)}/publicar`,
    {
      method: "POST",
      body: JSON.stringify({ conteudo_markdown: conteudo, promover }),
    },
  );
}
