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
 * - Secrets (`CF_AIG_TOKEN`, `INGESTION_API_SECRET`) chegam por
 *   `wrangler secret put` — opcionais para os testes locais.
 */
export interface Env {
  // AI bindings
  AI: Ai;

  // Vectorize
  VECTORIZE: VectorizeIndex;

  // Índice de catálogo CATMAT/CATSER (separado das leis). Opcional: as tools de
  // catálogo erram com clareza se ausente. Populado pelo ETL (scripts/catalogo-etl).
  VECTORIZE_CATMAT?: VectorizeIndex;

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

  // Durable Object namespace para NotebookAgent (1 DO por notebook do
  // chat NotebookLM). Cada notebook tem seu próprio storage SQL com
  // documento, chunks e histórico de mensagens.
  NOTEBOOK_AGENT: DurableObjectNamespace;

  // Durable Object namespace para SessionAgent (1 DO global por usuário
  // — hoje "default"). Mantém histórico de petições analisadas + pareceres
  // gerados em SQL storage. Usado pelo PEVSEngine para persistência.
  SESSION_AGENT: DurableObjectNamespace;

  // Secrets (não bindings)
  // Token do Cloudflare AI Gateway (`vectorgov-t`). Autentica no gateway via
  // header `cf-aig-authorization`; a chave do Gemini fica em BYOK/Stored Keys
  // no gateway, não no Worker. `wrangler secret put CF_AIG_TOKEN`.
  CF_AIG_TOKEN?: string;
  // Override opcional da base do endpoint compat do gateway (default no código:
  // `.../vectorgov-t/compat`). Útil para apontar a outro gateway/conta.
  CF_AIG_BASE_URL?: string;
  INGESTION_API_SECRET?: string;
  ENABLE_GOLDEN_SET_MOCKS?: string;

  // Tavily (pesquisa web tier 2) — `wrangler secret put TAVILY_API_KEY`.
  TAVILY_API_KEY?: string;
}
