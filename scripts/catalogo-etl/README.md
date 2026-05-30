# Catálogo ETL (CATMAT/CATSER)

ETL offline que carrega o catálogo de itens do governo no projeto, em dois
modos de busca:

- **D1 / FTS5** (grep, BM25) — tabela `catalogo_itens` + `catalogo_fts`.
- **Vectorize** (semântico, bge-m3 1024-dim) — índice separado `catmat-catser`.

Por que offline e não no Worker: são ~165k itens; embeddar isso estoura o limite
de subrequests de uma invocação de Worker. O catálogo é estático (carga única),
então é um ETL em lote, não um pipeline ao vivo como o das leis.

> Validado em 2026-05 contra os downloads oficiais: **162.919 materiais (CATMAT)
> + 2.905 serviços (CATSER) = 165.824 itens**. A planilha traz só itens ativos;
> o histórico de preços pode referenciar códigos já descontinuados (ex.: a luva
> 269894 saiu do catálogo ativo) — daí a busca semântica importar.

## Passos

### 0. Instalar deps
```
cd scripts/catalogo-etl && npm install
```

### 1. Parse (offline, gratuito) — XLSX → SQL + NDJSON
```
CATMAT_XLSX="D:/2026/catmat" CATSER_XLSX="D:/2026/catser" OUT_DIR="./out" npm run parse
```
Gera `out/catalogo-d1.sql` (INSERTs + popula a FTS) e `out/itens.ndjson`.

### 2. D1 — aplicar migration + importar
```
wrangler d1 migrations apply vectorgov-t-db --remote   # cria catalogo_itens + catalogo_fts (0004)
wrangler d1 execute vectorgov-t-db --remote --file ./out/catalogo-d1.sql
```

### 3. Vectorize — criar índice + metadata index
```
wrangler vectorize create catmat-catser --dimensions=1024 --metric=cosine
wrangler vectorize create-metadata-index catmat-catser --property-name=tipo --type=string
```
Adicionar o binding em `apps/mcp-server/wrangler.toml` e `src/env.ts`:
```
[[vectorize]]
binding = "VECTORIZE_CATMAT"
index_name = "catmat-catser"
```

### 4. Embed (GATED — paga Workers AI) — NDJSON → vetores
```
CF_ACCOUNT_ID=a89dbdb0224cd8d2292cda8a038bc297 CF_API_TOKEN=*** OUT_DIR=./out npm run embed
```
Resumível (continua de onde parou). Gera `out/vectors.ndjson`.

### 5. Vectorize — bulk insert
```
wrangler vectorize insert catmat-catser --file ./out/vectors.ndjson
```

## Amostra vs full
Para validar rápido / conter custo, dá para embeddar só um recorte
(`head -n 20000 out/itens.ndjson > out/itens.ndjson.amostra` e apontar o embed
para ele). O D1 pode receber a carga completa (barato) independentemente.
