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

interface PeticaoRecord {
  id: string;
  fase: string;
  iniciado_em: string;
  atualizado_em: string;
  metadata: Record<string, unknown>;
  analise?: {
    veredito: string;
    score_confianca: number;
  };
  parecer?: unknown;
}

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
 * Lista mock — devolve registros sintéticos quando o KV está vazio, para
 * permitir desenvolvimento e demo do frontend sem precisar primeiro
 * fazer uploads reais.
 *
 * TODO: remover quando D1 estiver ligado.
 */
function mockHistorico(): HistoricoItem[] {
  return [
    {
      id: "11111111-1111-4111-8111-111111111111",
      contrato_numero: "012/2024",
      contratante: "Prefeitura Municipal de Exemplo/SP",
      contratado: "Construtora Beta Ltda",
      data_protocolo: "2026-04-15",
      veredito: "parcialmente_procedente",
      tem_parecer: true,
      parecer_aprovado: true,
      score_confianca: 0.82,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      contrato_numero: "045/2023",
      contratante: "Secretaria Estadual de Educação/MG",
      contratado: "Alfa Serviços Especializados S/A",
      data_protocolo: "2026-04-10",
      veredito: "procedente",
      tem_parecer: true,
      parecer_aprovado: false,
      score_confianca: 0.91,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      contrato_numero: "007/2024",
      contratante: "Câmara dos Deputados",
      contratado: "Gamma TI Consultoria EIRELI",
      data_protocolo: "2026-03-28",
      veredito: "improcedente",
      tem_parecer: false,
      parecer_aprovado: false,
      score_confianca: 0.45,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      contrato_numero: "129/2022",
      contratante: "Tribunal Regional Federal 1ª Região",
      contratado: "Delta Engenharia Ltda",
      data_protocolo: "2026-03-20",
      veredito: "parcialmente_procedente",
      tem_parecer: true,
      parecer_aprovado: true,
      score_confianca: 0.78,
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      contrato_numero: "002/2025",
      contratante: "Universidade Federal do ABC",
      contratado: "Épsilon Soluções Tecnológicas Ltda",
      data_protocolo: "2026-03-12",
      veredito: "inconclusiva",
      tem_parecer: false,
      parecer_aprovado: false,
      score_confianca: 0.32,
    },
  ];
}

/**
 * Carrega histórico do KV se existir, senão usa mock.
 */
async function carregarHistorico(env: Env): Promise<HistoricoItem[]> {
  // KV `list` traz no máx 1000 chaves por chamada — suficiente para MVP.
  const lista = await env.CACHE.list({ prefix: "peticao:", limit: 1000 });
  const items: HistoricoItem[] = [];

  for (const entry of lista.keys) {
    const raw = await env.CACHE.get(entry.name);
    if (!raw) continue;
    let rec: PeticaoRecord;
    try {
      rec = JSON.parse(raw) as PeticaoRecord;
    } catch {
      continue;
    }
    if (rec.fase !== "done" || !rec.analise) continue;

    const meta = rec.metadata ?? {};
    items.push({
      id: rec.id,
      contrato_numero:
        (typeof meta["contrato"] === "string" && (meta["contrato"] as string)) ||
        (typeof meta["pdf_nome"] === "string" && (meta["pdf_nome"] as string)) ||
        "—",
      contratante:
        (typeof meta["contratante_razao_social"] === "string" &&
          (meta["contratante_razao_social"] as string)) ||
        "—",
      contratado:
        (typeof meta["contratado_razao_social"] === "string" &&
          (meta["contratado_razao_social"] as string)) ||
        "—",
      data_protocolo:
        (typeof meta["data_protocolo"] === "string" &&
          (meta["data_protocolo"] as string)) ||
        rec.iniciado_em.slice(0, 10),
      veredito: rec.analise.veredito,
      tem_parecer: !!rec.parecer,
      parecer_aprovado: false, // TODO: campo dedicado quando houver workflow
      score_confianca: rec.analise.score_confianca,
    });
  }

  if (items.length === 0) {
    return mockHistorico();
  }
  // Concatena os reais com o mock para sempre ter alguma coisa na demo.
  return [...items, ...mockHistorico()];
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
