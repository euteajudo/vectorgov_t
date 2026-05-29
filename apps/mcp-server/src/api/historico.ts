/**
 * Endpoints REST de histórico de petições analisadas.
 *
 * Rotas:
 *  - `GET /api/historico` — listagem paginada com filtros (contratante,
 *    contratado, veredito, data, q).
 *
 * Persistência atual: enumera chaves KV `peticao:*` que tenham `fase=done`.
 * TODO: substituir por D1 quando a tabela `peticoes` estiver criada
 * (KV não escala bem para milhares de registros).
 */
import type { Env } from "../env.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { parseHistoricoQuery, type HistoricoQuery } from "./validation.js";
import { getSessionAgentClient } from "../agents/session-loader.js";

interface HistoricoItem {
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

interface HistoricoPage {
  items: HistoricoItem[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Carrega o histórico do store global (SessionAgent Durable Object) — onde
 * TODA análise (chat ou outra) é persistida via `analisarPeticao`. Substitui
 * a leitura antiga do KV (que só o form alimentava) + o mock.
 */
async function carregarHistorico(env: Env): Promise<HistoricoItem[]> {
  const sessionAgent = getSessionAgentClient(env);
  // Limite alto (DO clampa em 100); a paginação/filtro fina é in-memory aqui.
  const entradas = await sessionAgent.listarHistorico(100);

  return entradas.map((e) => ({
    id: e.analise_id,
    contrato_numero: e.contrato_numero || "—",
    contratante: e.contratante || "—",
    contratado: e.contratado || "—",
    data_protocolo:
      e.data_protocolo ||
      new Date(e.criado_em || Date.now()).toISOString().slice(0, 10),
    veredito: e.veredito,
    tem_parecer: e.tem_parecer,
    parecer_aprovado: false, // TODO: campo dedicado quando houver workflow
    score_confianca: e.score_confianca,
  }));
}

/**
 * Filtra e pagina a lista in-memory usando filtros já validados via Zod.
 *
 * Aceitável enquanto for KV; com D1 isto será movido para a query SQL
 * (o schema Zod já define os tipos exatos para o `WHERE`).
 */
function filtrarPaginar(
  items: HistoricoItem[],
  filters: HistoricoQuery,
): HistoricoPage {
  const contratante = filters.contratante?.toLowerCase();
  const contratado = filters.contratado?.toLowerCase();
  const veredito = filters.veredito;
  const dataInicio = filters.data_inicio;
  const dataFim = filters.data_fim;
  const q = filters.q?.toLowerCase();
  const page = filters.page;
  const pageSize = filters.page_size;

  const filtered = items.filter((it) => {
    if (contratante && !it.contratante.toLowerCase().includes(contratante)) {
      return false;
    }
    if (contratado && !it.contratado.toLowerCase().includes(contratado)) {
      return false;
    }
    if (veredito && it.veredito !== veredito) {
      return false;
    }
    if (dataInicio && it.data_protocolo < dataInicio) {
      return false;
    }
    if (dataFim && it.data_protocolo > dataFim) {
      return false;
    }
    if (q) {
      const blob = `${it.contrato_numero} ${it.contratante} ${it.contratado} ${it.veredito}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });

  // Ordena por data_protocolo desc (mais recente primeiro).
  filtered.sort((a, b) => (a.data_protocolo < b.data_protocolo ? 1 : -1));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  return {
    items: pageItems,
    total,
    page,
    page_size: pageSize,
  };
}

export async function handleListarHistorico(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    // Validação Zod dos query params (follow-up P0 #53)
    const queryCheck = parseHistoricoQuery(url);
    if (!queryCheck.ok) return queryCheck.response;

    const items = await carregarHistorico(env);
    const page = filtrarPaginar(items, queryCheck.data);
    return jsonResponse(page);
  } catch (err) {
    return errorResponse(
      `Erro ao listar histórico: ${err instanceof Error ? err.message : "desconhecido"}`,
      500,
    );
  }
}
