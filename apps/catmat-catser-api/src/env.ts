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
   * Secret (`wrangler secret put COHERE_API_KEY`) — Cohere Rerank
   * (default rerank-v4.0-fast; modelo sobrescrevível pela var abaixo).
   * Ausente → busca híbrida degrada para ordenação 100% RRF (logado).
   */
  COHERE_API_KEY?: string;
  /** Var opcional: troca o modelo de rerank sem redeploy (default rerank-v4.0-fast). */
  COHERE_RERANK_MODEL?: string;
  /**
   * Secret das rotas admin do inspetor (`/api/catalogo/admin/*`) — header
   * `X-Catalogo-Admin-Key`, comparação timing-safe por digest. Ausente →
   * rotas admin respondem 503 (não configurado). Ver SPEC-LOOP-MONITOR-CATALOGO.
   */
  CATALOGO_ADMIN_KEY?: string;
}
