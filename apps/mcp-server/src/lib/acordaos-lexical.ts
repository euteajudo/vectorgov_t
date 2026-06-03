/**
 * Busca LEXICAL em acórdãos do TCU — SQLite FTS5 (`itens_fts`) no D1
 * `vectorgov-a-db`, populado pela ingestão do `vectorgov-a-mcp`.
 *
 * Complementa a busca semântica (`acordaos-search.ts`): o FTS5 indexa TODOS os
 * chunks (181 hoje), incluindo o `relatorio` que o roteamento mantém FORA do
 * Vectorize. Use para termo exato, número de processo, nome de relator, citação
 * literal — onde a semântica não ajuda.
 *
 * Ranking: `bm25(itens_fts)` (mais negativo = melhor). Tokenizer do índice é
 * `unicode61 remove_diacritics 2` → casamento sem acento. Citação reusa o
 * mesmo `buildLabel` da semântica (formato idêntico de `label`).
 */
import type { Env } from "../env.js";
import {
  buildLabel,
  type AcordaoFiltros,
  type AcordaoSnippet,
} from "./acordaos-shared.js";

/** Hit lexical: snippet canônico + o trecho com o termo destacado (FTS5). */
export interface AcordaoLexicalHit extends AcordaoSnippet {
  /** Trecho com o(s) termo(s) destacado(s) entre [colchetes] (FTS5 snippet). */
  destaque: string;
}

/** Row do JOIN itens_fts × itens_acordao × acordaos. */
interface LexRow {
  item_id: string;
  acordao_id: string | null;
  secao: string;
  rotulo: string | null;
  texto: string | null;
  r2_key: string | null;
  tipo_dispositivo: string | null;
  numero: string | null;
  ano: number | null;
  colegiado: string | null;
  relator: string | null;
  rank: number; // bm25 — mais negativo = melhor
  snip: string | null;
}

/**
 * Constrói uma expressão FTS5 MATCH segura a partir do texto do usuário.
 * Tokeniza, mantém só letras/dígitos (descarta `"`, `*`, `(`, `-`, `:`, `^`…
 * que quebrariam a sintaxe do MATCH), e transforma cada token em prefixo
 * (`token*`) unido por OR. O bm25 cuida de rankear quem casa mais termos no
 * topo, então OR dá recall sem perder precisão na ordenação. Retorna null se
 * não sobrar token utilizável.
 */
export function buildMatchQuery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    // Separa em qualquer fronteira não-alfanumérica (igual ao tokenizer
    // unicode61 do índice): "023.262/2017-6" → 023, 262, 2017, 6.
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2) // corta ruído de 1 char e strings vazias
    .slice(0, 12); // teto defensivo de termos
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}*`).join(" OR ");
}

/**
 * Busca lexical de acórdãos via FTS5. Devolve até `top_k` trechos rankeados por
 * bm25, cada um com citação canônica, o texto do chunk e o trecho destacado.
 */
export async function buscarAcordaosLexical(
  env: Env,
  input: { query: string; top_k: number; filtros?: AcordaoFiltros },
): Promise<AcordaoLexicalHit[]> {
  if (!env.DB_ACORDAOS) {
    throw new Error(
      "busca lexical de acórdãos indisponível: D1 'vectorgov-a-db' " +
        "(DB_ACORDAOS) não configurado.",
    );
  }
  const q = input.query.trim();
  if (q.length < 3) return [];
  const match = buildMatchQuery(q);
  if (!match) return [];

  const where: string[] = ["itens_fts MATCH ?"];
  const binds: unknown[] = [match];
  if (input.filtros?.colegiado) {
    where.push("a.colegiado = ?");
    binds.push(input.filtros.colegiado);
  }
  if (typeof input.filtros?.ano === "number") {
    where.push("a.ano = ?");
    binds.push(input.filtros.ano);
  }
  if (input.filtros?.secao) {
    where.push("f.secao = ?");
    binds.push(input.filtros.secao);
  }

  // bm25()/snippet() exigem o NOME da tabela FTS (`itens_fts`), nunca o alias
  // `f` (testado: alias dá "no such column"). Coluna 4 do FTS5 = `texto`.
  const sql =
    "SELECT f.item_id, f.acordao_id, f.secao, f.rotulo, i.texto, i.r2_key, " +
    "i.tipo_dispositivo, a.numero, a.ano, a.colegiado, a.relator, " +
    "bm25(itens_fts) AS rank, " +
    "snippet(itens_fts, 4, '[', ']', '…', 12) AS snip " +
    "FROM itens_fts f " +
    "JOIN itens_acordao i ON i.id = f.item_id " +
    "JOIN acordaos a ON a.id = f.acordao_id " +
    `WHERE ${where.join(" AND ")} ` +
    "ORDER BY rank LIMIT ?";
  binds.push(input.top_k);

  const res = await env.DB_ACORDAOS.prepare(sql)
    .bind(...binds)
    .all<LexRow>();

  return (res.results ?? []).map((r) => ({
    item_id: r.item_id,
    acordao_id: r.acordao_id ?? "",
    numero: r.numero ?? "",
    ano: typeof r.ano === "number" ? r.ano : 0,
    colegiado: r.colegiado ?? "",
    secao: r.secao ?? "",
    rotulo: r.rotulo ?? null,
    label: buildLabel({
      numero: r.numero ?? undefined,
      ano: r.ano ?? undefined,
      colegiado: r.colegiado ?? undefined,
      secao: r.secao,
      rotulo: r.rotulo,
    }),
    texto: r.texto ?? "",
    relator: r.relator ?? null,
    tipo_dispositivo: r.tipo_dispositivo ?? null,
    // -bm25 → maior = mais relevante (alinha com a convenção da semântica).
    score: -r.rank,
    r2_key: r.r2_key ?? null,
    destaque: r.snip ?? "",
  }));
}
