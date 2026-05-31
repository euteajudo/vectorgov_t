/**
 * Bindings do Worker dedicado do catálogo CATMAT/CATSER.
 *
 * Banco e índice PRÓPRIOS (camada agêntica), separados do vectorgov-t.
 */
export interface Env {
  /** Workers AI — bge-m3 (embed) + bge-reranker-v2-m3 (rerank). */
  AI: Ai;
  /** Índice semântico do catálogo (`catmat-catser`). */
  VECTORIZE_CATMAT: VectorizeIndex;
  /** Banco dedicado: catalogo_itens + catalogo_fts (unicode61) + catalogo_trgm. */
  DB: D1Database;
}
