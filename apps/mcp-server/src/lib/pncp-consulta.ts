/**
 * Cliente da API de Consulta do PNCP — Atas de Registro de Preço.
 *
 * API pública: https://pncp.gov.br/api/consulta
 * Usado pela tool `buscar_documentos_suporte` (Módulo C) para listar ARPs
 * candidatas como documento de suporte da pesquisa de preço (exigência legal).
 *
 * Shapes validados contra /v1/atas (2026-05). Mesmas convenções do projeto:
 * cache KV (`pncp:`), timeout via AbortController, retry transiente.
 */
import type { Env } from "../env.js";
import type { DocumentoSuporte } from "@vectorgov-t/schemas";
import { cacheGet, cacheSet } from "./cache.js";
import { withR2Retry } from "./retry.js";

const BASE_URL = "https://pncp.gov.br/api/consulta";
const FETCH_TIMEOUT_MS = 30_000;
/** PNCP exige tamanho de página entre 10 e 50. */
const PAGE_SIZE = 50;
const MAX_PAGINAS = 4;
/** Atas mudam devagar — cache de 6h. */
const ATAS_CACHE_TTL = 6 * 60 * 60;

interface EnvelopePncp<T> {
  data: T[];
  totalRegistros: number;
  totalPaginas: number;
  paginasRestantes: number;
}

interface AtaRaw {
  numeroControlePNCPAta?: string | null;
  numeroAtaRegistroPreco?: string | null;
  anoAta?: number | null;
  numeroControlePNCPCompra?: string | null;
  dataAssinatura?: string | null;
  dataPublicacaoPncp?: string | null;
  objetoContratacao?: string | null;
  nomeOrgao?: string | null;
  cnpjOrgao?: string | null;
}

export interface FiltrosAtas {
  data_inicio: string; // YYYY-MM-DD
  data_fim: string; // YYYY-MM-DD
  cnpj_orgao?: string;
}

/** "2024-06-01" -> "20240601" (formato aceito pela PNCP). */
function compactarData(ymd: string): string {
  return ymd.replace(/-/g, "");
}

/** Monta o link público da contratação a partir do numeroControlePNCPCompra. */
function urlContratacao(numeroControle: string | null | undefined): string {
  const m = (numeroControle ?? "").match(/^(\d+)-\d+-(\d+)\/(\d+)$/);
  if (!m) return "https://pncp.gov.br";
  const [, cnpj, sequencial, ano] = m;
  return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${parseInt(sequencial!, 10)}`;
}

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}?${qs}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new Error(`PNCP ${res.status}: ${body}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("PNCP timeout (ETIMEDOUT)");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function mapAta(raw: AtaRaw): DocumentoSuporte {
  const objeto = (raw.objetoContratacao ?? "").replace(/\s+/g, " ").trim();
  const titulo =
    `ARP ${raw.numeroAtaRegistroPreco ?? "?"}/${raw.anoAta ?? "?"}` +
    (objeto ? ` — ${objeto.slice(0, 120)}` : "");
  const data = (raw.dataAssinatura || raw.dataPublicacaoPncp || "").slice(0, 10);
  return {
    tipo: "ata_registro_preco",
    titulo,
    id_pncp: raw.numeroControlePNCPAta ?? null,
    url: urlContratacao(raw.numeroControlePNCPCompra),
    orgao: raw.nomeOrgao ?? null,
    data: /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null,
  };
}

/**
 * Lista ARPs vigentes/publicadas numa janela (candidatas a documento de
 * suporte). Filtro opcional por CNPJ do órgão. Resultado cacheado por 6h.
 */
export async function consultarAtas(
  env: Env,
  filtros: FiltrosAtas,
): Promise<DocumentoSuporte[]> {
  const cacheKey = `pncp:atas:v1:${filtros.data_inicio}:${filtros.data_fim}:${filtros.cnpj_orgao ?? "*"}`;
  const cached = await cacheGet<DocumentoSuporte[]>(env, cacheKey);
  if (cached) return cached;

  const baseParams: Record<string, string> = {
    dataInicial: compactarData(filtros.data_inicio),
    dataFinal: compactarData(filtros.data_fim),
    tamanhoPagina: String(PAGE_SIZE),
  };
  if (filtros.cnpj_orgao) baseParams.cnpj = filtros.cnpj_orgao;

  const docs: DocumentoSuporte[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const env_ = await withR2Retry(
      () =>
        getJson<EnvelopePncp<AtaRaw>>("/v1/atas", {
          ...baseParams,
          pagina: String(pagina),
        }),
      `pncp.atas.p${pagina}`,
    );
    for (const raw of env_.data ?? []) docs.push(mapAta(raw));
    if (env_.paginasRestantes <= 0 || (env_.data ?? []).length === 0) break;
  }

  await cacheSet(env, cacheKey, docs, ATAS_CACHE_TTL);
  return docs;
}
