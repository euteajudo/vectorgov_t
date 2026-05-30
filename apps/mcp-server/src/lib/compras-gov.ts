/**
 * Cliente HTTP do Compras.gov.br — Dados Abertos (módulo Preços Praticados).
 *
 * API pública sem autenticação: https://dadosabertos.compras.gov.br
 * Reusa as convenções do projeto: cache KV (prefixo `compras:`), timeout via
 * AbortController e retry transiente via `withR2Retry`.
 *
 * Shapes mapeados contra a resposta real do CATMAT 269894 (luva de
 * procedimento). `precoUnitario` vem em REAIS → convertido para centavos.
 */
import type { Env } from "../env.js";
import type { AmostraPreco } from "@vectorgov-t/schemas";
import { cacheGet, cacheSet } from "./cache.js";
import { withR2Retry } from "./retry.js";

const BASE_URL = "https://dadosabertos.compras.gov.br";
const FETCH_TIMEOUT_MS = 30_000;
/** Página default da API; o intervalo aceito é 10–500. */
const PAGE_SIZE = 100;
/** Teto de páginas por consulta (evita varrer milhares de registros num MVP). */
const MAX_PAGINAS = 5;
/** Preços mudam devagar — cache de 6h. */
const PRECO_CACHE_TTL = 6 * 60 * 60;

/** Amostra sem os campos de aderência (preenchidos depois pela tool). */
export type AmostraPrecoBase = Omit<
  AmostraPreco,
  "aderente" | "aderencia_score" | "aderencia_motivo"
>;

/** Envelope de paginação padrão das respostas do Compras.gov. */
interface EnvelopeCompras<T> {
  resultado: T[];
  totalRegistros: number;
  totalPaginas: number;
  paginasRestantes: number;
}

/** Campos que consumimos da amostra de "Preços Praticados" (material). */
interface PrecoPraticadoRaw {
  idCompra: string | number;
  descricaoItem?: string | null;
  descricaoDetalhadaItem?: string | null;
  objetoCompra?: string | null;
  codigoItemCatalogo: number;
  precoUnitario: number;
  forma?: string | null;
  siglaUnidadeFornecimento?: string | null;
  capacidadeUnidadeFornecimento?: number | null;
  siglaUnidadeMedida?: string | null;
  quantidade?: number | null;
  marca?: string | null;
  nomeFornecedor?: string | null;
  niFornecedor?: string | null;
  codigoUasg?: string | null;
  nomeOrgao?: string | null;
  estado?: string | null;
  municipio?: string | null;
  poder?: string | null;
  esfera?: string | null;
  dataCompra?: string | null;
}

/** Filtros aceitos pela consulta de preços praticados (material). */
export interface FiltrosPrecoMaterial {
  codigo_item: number;
  uf?: string;
  data_inicio?: string;
  data_fim?: string;
}

/** GET genérico no Compras.gov com timeout + erro classificável por status. */
async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}?${qs}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      // O status no texto faz isTransientError classificar (5xx/429 retém).
      throw new Error(`Compras.gov ${res.status}: ${body}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // Mensagem com token transiente para retry kick-in.
      throw new Error("Compras.gov timeout (ETIMEDOUT)");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Converte "2024-12-27" / ISO datetime em YYYY-MM-DD, ou null. */
function normalizarData(v: string | null | undefined): string | null {
  if (!v) return null;
  const ymd = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/** UF de 2 letras, ou null. */
function normalizarUf(v: string | null | undefined): string | null {
  if (!v) return null;
  const uf = v.trim().toUpperCase();
  return uf.length === 2 ? uf : null;
}

/** Mapeia a amostra crua da API para o nosso shape (sem aderência). */
function mapAmostra(raw: PrecoPraticadoRaw): AmostraPrecoBase {
  return {
    codigo_item: raw.codigoItemCatalogo,
    descricao: (raw.descricaoItem ?? "").trim() || "(sem descrição)",
    descricao_detalhada: raw.descricaoDetalhadaItem?.trim() || null,
    objeto_compra: raw.objetoCompra?.trim() || null,
    valor_unitario_centavos: Math.round((raw.precoUnitario ?? 0) * 100),
    unidade_fornecimento: raw.siglaUnidadeFornecimento?.trim() || null,
    capacidade_fornecimento:
      typeof raw.capacidadeUnidadeFornecimento === "number" &&
      raw.capacidadeUnidadeFornecimento > 0
        ? raw.capacidadeUnidadeFornecimento
        : null,
    unidade_medida: raw.siglaUnidadeMedida?.trim() || null,
    quantidade: typeof raw.quantidade === "number" ? raw.quantidade : null,
    marca: raw.marca?.trim() || null,
    fornecedor: raw.nomeFornecedor?.trim() || null,
    ni_fornecedor: raw.niFornecedor?.trim() || null,
    uasg: raw.codigoUasg?.trim() || null,
    orgao: raw.nomeOrgao?.trim() || null,
    uf: normalizarUf(raw.estado),
    municipio: raw.municipio?.trim() || null,
    poder: raw.poder?.trim() || null,
    esfera: raw.esfera?.trim() || null,
    data_compra: normalizarData(raw.dataCompra),
    forma: raw.forma?.trim() || null,
    id_compra: String(raw.idCompra),
    fonte_url: null,
  };
}

/**
 * Consulta preços praticados de um material (CATMAT), agregando páginas até
 * `MAX_PAGINAS`. Resultado cacheado por 6h. Devolve amostras SEM aderência —
 * a tool aplica o portão de aderência e a estatística.
 */
export async function consultarPrecosMaterial(
  env: Env,
  filtros: FiltrosPrecoMaterial,
): Promise<AmostraPrecoBase[]> {
  const cacheKey = `compras:precos:material:v1:${filtros.codigo_item}:${filtros.uf ?? "*"}:${filtros.data_inicio ?? "*"}:${filtros.data_fim ?? "*"}`;
  const cached = await cacheGet<AmostraPrecoBase[]>(env, cacheKey);
  if (cached) return cached;

  const baseParams: Record<string, string> = {
    codigoItemCatalogo: String(filtros.codigo_item),
    tamanhoPagina: String(PAGE_SIZE),
  };
  if (filtros.uf) baseParams.estado = filtros.uf;
  if (filtros.data_inicio) baseParams.dataCompraInicio = filtros.data_inicio;
  if (filtros.data_fim) baseParams.dataCompraFim = filtros.data_fim;

  const amostras: AmostraPrecoBase[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const env_ = await withR2Retry(
      () =>
        getJson<EnvelopeCompras<PrecoPraticadoRaw>>(
          "/modulo-pesquisa-preco/1_consultarMaterial",
          { ...baseParams, pagina: String(pagina) },
        ),
      `compras.precos.material.p${pagina}`,
    );
    for (const raw of env_.resultado ?? []) amostras.push(mapAmostra(raw));
    if (env_.paginasRestantes <= 0 || (env_.resultado ?? []).length === 0) break;
  }

  await cacheSet(env, cacheKey, amostras, PRECO_CACHE_TTL);
  return amostras;
}
