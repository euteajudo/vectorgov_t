/**
 * Listagem dos acórdãos do TCU já carregados — D1 `vectorgov-a-db` (tabela
 * `acordaos`), via binding read-only `DB_ACORDAOS`. Espelha o `fs_listar_normas`
 * das leis, mas a fonte é o D1 do worker de acórdãos (não o R2 `_index.json`).
 *
 * Devolve um resumo por acórdão (cabeçalho + contagem de chunks) para a
 * interface administrativa "Acórdãos carregados".
 */
import type { Env } from "../env.js";

export interface AcordaoResumo {
  acordao_id: string;
  numero: string;
  ano: number;
  colegiado: string;
  relator: string | null;
  processo_tc: string | null;
  data_sessao: string | null;
  /** Total de chunks do acórdão (todas as seções). */
  total_itens: number;
  /** Chunks no índice semântico (Vectorize) — seções de tese. */
  total_indexados: number;
  criado_em: string | null;
}

/** Row cru do JOIN acordaos × itens_acordao. */
interface AcordaoRow {
  acordao_id: string;
  numero: string | null;
  ano: number | null;
  colegiado: string | null;
  relator: string | null;
  processo_tc: string | null;
  data_sessao: string | null;
  criado_em: string | null;
  total_itens: number | null;
  total_indexados: number | null;
}

export async function listarAcordaos(env: Env): Promise<AcordaoResumo[]> {
  if (!env.DB_ACORDAOS) {
    throw new Error(
      "listagem de acórdãos indisponível: D1 'vectorgov-a-db' " +
        "(DB_ACORDAOS) não configurado.",
    );
  }

  // Cabeçalho + contagem de chunks (total e os vetorizados). LEFT JOIN para que
  // um acórdão sem chunks ainda apareça.
  //
  // Blindagem: exclui entradas DEGENERADAS — quando o parser do vectorgov-a-mcp
  // falha em extrair número/ano, ele grava um cabeçalho órfão com `numero=''` e
  // `ano=0` (id `acordao--0-<colegiado>`) e a ingestão falha sem chunks. Esses
  // registros não devem aparecer na lista (não são acórdãos válidos/buscáveis).
  // Mais recentes primeiro.
  const sql =
    "SELECT a.id AS acordao_id, a.numero, a.ano, a.colegiado, a.relator, " +
    "a.processo_tc, a.data_sessao, a.criado_em, " +
    "COUNT(i.id) AS total_itens, " +
    "COALESCE(SUM(i.indexado_vetor), 0) AS total_indexados " +
    "FROM acordaos a " +
    "LEFT JOIN itens_acordao i ON i.acordao_id = a.id " +
    "WHERE a.numero IS NOT NULL AND a.numero <> '' AND a.ano > 0 " +
    "GROUP BY a.id " +
    "ORDER BY a.criado_em DESC, a.ano DESC, a.numero DESC";

  const res = await env.DB_ACORDAOS.prepare(sql).all<AcordaoRow>();
  return (res.results ?? [])
    // Defesa em profundidade (além do WHERE): nunca devolve entrada degenerada.
    .filter((r) => (r.numero ?? "") !== "" && (typeof r.ano === "number" ? r.ano : 0) > 0)
    .map((r) => ({
    acordao_id: r.acordao_id,
    numero: r.numero ?? "",
    ano: typeof r.ano === "number" ? r.ano : 0,
    colegiado: r.colegiado ?? "",
    relator: r.relator ?? null,
    processo_tc: r.processo_tc ?? null,
    data_sessao: r.data_sessao ?? null,
    total_itens: typeof r.total_itens === "number" ? r.total_itens : 0,
    total_indexados: typeof r.total_indexados === "number" ? r.total_indexados : 0,
    criado_em: r.criado_em ?? null,
  }));
}
