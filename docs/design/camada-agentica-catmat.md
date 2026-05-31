# Camada agêntica do catálogo CATMAT/CATSER

> Produto: busca de catálogo em **vectorgov.io/catmatcatser**. Frontend na VPS
> (Next, atrás do nginx do vectorgov.io); **backend de busca no Cloudflare**
> (nossa stack catmat-catser já validada), trazendo a técnica `tsvector+pg_trgm`
> do vector_govi_2 para o D1 via **FTS5 trigram**.

## Decisão de arquitetura (fechada)

- **Frontend:** `vectorgov.io/catmatcatser` (VPS) — página Next que consome o
  backend Cloudflare por REST.
- **Backend:** Cloudflare — D1 `catalogo_itens` + busca em **3 vias**:
  1. **FTS5 `unicode61`** (full-text, ≈ `tsvector`) — já existe (`catalogo_fts`).
  2. **FTS5 `trigram`** (fuzzy/substring/typo, ≈ `pg_trgm`) — **a adicionar**.
  3. **Vectorize** `catmat-catser` (semântico, bge-m3) — já existe.
  Fundidos por RRF (+ rerank opcional), como o hybrid das leis.

### Por que FTS5 trigram = pg_trgm
| vector_govi_2 (Postgres) | catmat (Cloudflare D1) |
|---|---|
| `tsvector`/`to_tsquery` + GIN | FTS5 `unicode61` (já temos) |
| `pg_trgm` + GIN (fuzzy/substring) | **FTS5 `trigram` tokenizer** |
| `pgvector` (`<=>`) | Vectorize `catmat-catser` |

O tokenizer `trigram` do SQLite (≥ 3.34) dá substring + tolerância a digitação —
exatamente o ganho do `pg_trgm`, sem Postgres novo.

## Fase 1 — Backend (Cloudflare, repo vectorgov-t)

1. **Migration `0005_catalogo_trgm.sql`:** tabela virtual `catalogo_trgm` USING
   fts5(... , tokenize='trigram') + popular de `catalogo_itens`.
2. **`lib/catalogo-search.ts`:** adiciona o ranker trigram (`queryTrgmCatalogo`)
   e funde 3 vias no `buscarCatalogoHibrido` (RRF dense+fts+trgm). Novo helper
   `buscarCatalogoFuzzy` (só trigram, p/ digitação errada/parcial).
3. **Endpoint REST público** `GET /api/catalogo/buscar?q=&tipo=&modo=&limit=`
   — pro frontend consumir sem JSON-RPC. Retorna `CatalogoBuscaResultado`.
   (O `buscar_catalogo_semantico`/`grep_catalogo` MCP continuam pros agentes.)
4. **Tool MCP nova (opcional)** `buscar_catalogo_fuzzy` — trigram puro.
5. **Carga:** popular `catalogo_trgm` dos 165k itens já no D1 (INSERT…SELECT,
   sem re-embeddar nada).
6. **Testes** (mock D1 trigram) + smoke real ("luuva procediment" → acha luva).

## Fase 2 — Frontend (VPS, vectorgov.io/catmatcatser)

7. Página Next em `/opt/vectorgov-frontend` (rota `/catmatcatser`): input de
   busca + resultados (código, descrição, tipo, grupo/classe) + modo
   (semântico/fuzzy/exato). Consome `GET /api/catalogo/buscar` do Cloudflare.
8. **nginx:** `location /catmatcatser` no `vectorgov.conf` apontando pro front.
9. Deploy do frontend na VPS (cuidado: produção — read-only recon já feito).

## Fase 3 — Integração & validação

10. CORS no endpoint Cloudflare (origem `vectorgov.io`).
11. Smoke end-to-end na URL final.

## Princípios
- Reusa o máximo do catmat-catser já construído (D1 + Vectorize + hybrid-search).
- Trigram é aditivo (não quebra o que existe).
- Frontend fino: toda a inteligência fica no Cloudflare.
- Motor-F1: simples, funciona; sem multi-tenant/auth nesta fase.
