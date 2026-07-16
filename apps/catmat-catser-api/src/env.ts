/**
 * Bindings do Worker dedicado do catálogo CATMAT/CATSER.
 *
 * Banco e índice PRÓPRIOS (camada agêntica), separados do vectorgov-t.
 */
export interface Env {
  /** Workers AI — bge-m3 (só embedding; o rerank é Cohere, fora do Workers AI). */
  AI: Ai;
  /** Índice semântico do catálogo (`catmat-catser`). */
  VECTORIZE_CATMAT: VectorizeIndex;
  /** Banco dedicado: catalogo_itens + catalogo_fts (unicode61) + catalogo_trgm. */
  DB: D1Database;
  /**
   * Secret (`wrangler secret put COHERE_API_KEY`) — rerank-v3.5 da Cohere.
   * Ausente → busca híbrida degrada para ordenação 100% RRF (logado).
   */
  COHERE_API_KEY?: string;
}
