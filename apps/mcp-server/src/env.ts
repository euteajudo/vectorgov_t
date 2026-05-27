/**
 * Tipagem dos bindings disponíveis no Worker.
 *
 * Os bindings refletem o que está (ou estará) configurado em `wrangler.toml`.
 * Marcar um binding como opcional (`?`) deixa o type-system mais permissivo
 * em ambiente de testes — usar `non-null assertion` em runtime só quando
 * houver garantia operacional de que o binding existe.
 */

/**
 * Env declara todos os recursos Cloudflare expostos ao Worker pelo runtime.
 *
 * - `AI`: Workers AI (usado pelo motor de embeddings bge-m3 1024-dim).
 * - `VECTORIZE`: índice principal de embeddings das leis.
 * - `R2_LEIS`: bucket com os artefatos das leis (canonical, chunks, etc.).
 * - `R2_SKILLS`: bucket com as skills em markdown que orientam os agentes.
 * - `DB`: D1 com FTS5 (BM25) + metadados relacionais.
 * - `CACHE`: KV usado para rate-limit e cache de respostas curtas.
 * - Secrets (`GOOGLE_API_KEY`, `INGESTION_API_SECRET`) chegam por
 *   `wrangler secret put` — opcionais para os testes locais.
 */
export interface Env {
  // AI bindings
  AI: Ai;

  // Vectorize
  VECTORIZE: VectorizeIndex;

  // R2 buckets
  R2_LEIS: R2Bucket;
  R2_SKILLS: R2Bucket;

  // D1
  DB: D1Database;

  // KV
  CACHE: KVNamespace;

  // Service binding para o Worker do Container Python (ingestion-api).
  // Quando configurado em wrangler.toml, permite chamar /parse SEM passar
  // por DNS público (evita Cloudflare error 1042 — loop detection entre
  // Workers da mesma conta). Fallback: fetch direto via CONTAINER_BASE_URL
  // no container-client.ts se este binding não estiver presente.
  INGESTION?: Fetcher;

  // Secrets (não bindings)
  GOOGLE_API_KEY?: string;
  INGESTION_API_SECRET?: string;
}
