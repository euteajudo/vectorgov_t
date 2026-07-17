# Catálogo ETL (CATMAT/CATSER)

ETL offline que carrega o catálogo de itens do governo no projeto, em dois
modos de busca:

- **D1 / FTS5** (grep, BM25) — tabela `catalogo_itens` + `catalogo_fts`.
- **Vectorize** (semântico, bge-m3 1024-dim) — índice separado `catmat-catser`.

Por que offline e não no Worker: são ~346k itens; embeddar isso estoura o limite
de subrequests de uma invocação de Worker. O catálogo é estático (carga única),
então é um ETL em lote, não um pipeline ao vivo como o das leis.

## Fontes (v2 — 2026-07)

| Fonte | Script | Volume validado |
|---|---|---|
| CATMAT — CSV oficial do dadosabertos (UTF-8 com BOM, `;`) | `parse-csv.mjs` | 343.352 materiais, `codigoItem` único |
| CATSER — API pública `dadosabertos.compras.gov.br` (`/modulo-servico/6_consultarItemServico`) | `fetch-catser.mjs` | 2.868 serviços únicos (2.797 ativos), 7 páginas de 500 |

O caminho XLSX antigo (`parse.mjs`) fica como legado: o XLSX do CATSER vinha
com mojibake (`¿` no lugar de ÇÕ/ÇÃ) e o do CATMAT sem NCM/status/data. A API
resolveu o CATSER na fonte, então **não** existe `sane-catser.mjs` — o caminho
que vale é a API. A API devolve alguns `codigoServico` repetidos entre
classificações (227 em 3.095 registros); o fetch deduplica pela 1ª ocorrência.

Os nomes de grupo do CATMAT herdam defeitos de extração de largura fixa
("DISTRI-BUIÇÃO", "SUPRIMENTOSDE TIC", espaços duplos). `sane-grupos.mjs`
corrige por dicionário explícito (hífens legítimos existem: PRÉ-FABRICADOS,
MATÉRIAS-PRIMAS) — o grupo vai saneado ao D1, mas **não** entra no
`texto_embed`.

`texto_embed` = `descricao + (pdm) + [classe]`, com a classe omitida quando
INVALIDO/INVALIDA/vazia. O PDM entrar no embed (e na FTS, migration 0007) é o
que resgata itens cujo nome genérico só existe no PDM (ex.: os 244 itens
com PDM contendo "NOTEBOOK" que afundavam sob acessórios).

## Passos

### 0. Instalar deps
```
cd scripts/catalogo-etl && npm install
```

### 1a. Parse CATMAT (offline, gratuito) — CSV → SQL + NDJSON
```
node parse-csv.mjs --input D:/dados/catmat.csv --out ./out
```
Gera `out/catalogo-d1.sql` e `out/itens.ndjson`. Para validar rápido:
`--sample 2000`. O CSV **não** entra no repositório.

### 1b. Fetch CATSER (online, gratuito, sem auth) — API → SQL + NDJSON
```
node fetch-catser.mjs --out ./out
```
Gera `out/catser-d1.sql` e `out/itens-servico.ndjson`.

### 2. D1 — aplicar migrations + importar
```
wrangler d1 migrations apply catmat-catser-db --remote   # inclui a 0007 (ncm/atualizado_em + FTS com pdm)
wrangler d1 execute catmat-catser-db --remote --json --command "SELECT id FROM catalogo_itens" > ./out/ids-antes.json
wrangler d1 execute catmat-catser-db --remote --file scripts/catalogo-etl/sql/reset-pre-carga.sql
wrangler d1 execute catmat-catser-db --remote --file ./out/catalogo-d1.sql
wrangler d1 execute catmat-catser-db --remote --file ./out/catser-d1.sql
wrangler d1 execute catmat-catser-db --remote --file scripts/catalogo-etl/sql/rebuild-pos-carga.sql
```
Os SQLs gerados carregam SÓ `catalogo_itens` (a ordem entre catmat/catser não
importa). O `reset-pre-carga.sql` derruba os triggers antes da limpeza — com
eles ativos, cada DELETE em `catalogo_itens` dispara um SCAN completo da FTS
(coluna `catalogo_id` é UNINDEXED) e a limpeza de ~346k itens vira O(n²),
estourando o limite de 30s por query do D1. O `rebuild-pos-carga.sql`
reconstrói FTS + trigram uma única vez (em fatias por `codigo % 4`) e recria
os triggers. Validar ao final:
```
wrangler d1 execute catmat-catser-db --remote --command "SELECT (SELECT COUNT(*) FROM catalogo_itens) AS itens, (SELECT COUNT(*) FROM catalogo_fts) AS fts, (SELECT COUNT(*) FROM catalogo_trgm) AS trgm;"
```
As três contagens devem coincidir.

O `ids-antes.json` é o snapshot dos IDs da versão anterior — insumo do passo
5b (limpeza de vetores órfãos no Vectorize). Exportar SEMPRE antes do reset;
depois dele o conjunto antigo não existe mais em lugar nenhum.

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

O `embed.mjs` lê `out/itens.ndjson`; para embeddar o catálogo inteiro,
concatene os serviços antes:
```
cat out/itens-servico.ndjson >> out/itens.ndjson       # POSIX
type out\itens-servico.ndjson >> out\itens.ndjson      # Windows cmd
```
```
CF_ACCOUNT_ID=a89dbdb0224cd8d2292cda8a038bc297 CF_API_TOKEN=*** OUT_DIR=./out npm run embed
```
Resumível e à prova de crash (o último arquivo-lote é revalidado linha a
linha na retomada). Gera `out/vectors-000.ndjson`, `vectors-001.ndjson`, ...
com até 40k vetores cada — o `wrangler vectorize upsert` trava com arquivos
na casa de ~100k vetores, e lotes menores permitem retomar a carga do
arquivo que falhou em vez de recomeçar. A retomada é amarrada à fonte por
`out/embed-manifest.json` (sha256 do `itens.ndjson`) + checagem posicional de
ID: se a fonte mudou/reordenou desde a geração dos shards, o script ABORTA com
instrução em vez de "retomar" silenciosamente sobre a versão errada.

**Custo estimado da carga completa (~346k itens)**: `texto_embed` médio de
235 chars → ~23–27M tokens de entrada. Na tarifa vigente do `@cf/baai/bge-m3`
(US$ 0,012/M tokens de entrada) isso dá **~US$ 0,30–0,35**, em ~3.500 requests
de 100 textos. Conferir a página de pricing do Workers AI antes de rodar — e o
free tier diário não cobre a carga inteira num dia.

### 5. Vectorize — bulk upsert (um por arquivo-lote)
```
for f in ./out/vectors-*.ndjson; do
  wrangler vectorize upsert catmat-catser --file "$f"
done
```
Usar `upsert`, nunca `insert`: o insert preserva vetores de IDs já existentes
— numa recarga, embeddings e metadata novos (pdm/ativo/ncm) seriam
silenciosamente ignorados. Validar a carga ao final:
```
wrangler vectorize info catmat-catser
```
O `vectorCount` deve convergir para o total embedado (a contagem do Vectorize
atualiza com atraso de alguns minutos — repetir o `info` até estabilizar; se
estacionar abaixo do total, reexecutar o upsert do(s) arquivo(s) que falharam).

### 5b. Vectorize — remover vetores órfãos
O upsert cria/sobrescreve, mas NÃO apaga IDs que sumiram da fonte — itens
excluídos do catálogo ficariam como vetores órfãos no índice. Remover com o
diff contra o snapshot do passo 2:
```
CF_ACCOUNT_ID=... CF_API_TOKEN=... OUT_DIR=./out node limpar-orfaos.mjs
```
(O motor tem defesa em query-time — hits vindos só da lane semântica são
confirmados no D1 e órfãos são descartados/logados como
`catalogo_vetores_orfaos` — mas a limpeza aqui evita custo de índice e ruído
de recall.)

**Alternativa para reset absoluto** (índice suspeito de inconsistência, sem
snapshot de IDs): criar um índice novo versionado, carregar nele e trocar o
binding — `wrangler vectorize create catmat-catser-v2 ...`, upsert completo,
atualizar `index_name` nos wrangler.toml (catmat-catser-api e mcp-server),
deploy, e só então `wrangler vectorize delete catmat-catser`.

## Amostra vs full
Para validar rápido / conter custo, dá para embeddar só um recorte
(`head -n 20000 out/itens.ndjson > out/itens.ndjson.amostra` e apontar o embed
para ele). O D1 pode receber a carga completa (barato) independentemente.

## Recarga
Os SQLs gerados só fazem INSERT — recarregar sobre um banco já populado viola
a PK. Recarga completa é o MESMO fluxo da carga inicial (passo 2): reset →
SQLs de dados → rebuild. Nunca limpar com um `DELETE FROM catalogo_itens`
avulso com os triggers ativos — é o cenário O(n²) descrito no passo 2. No
Vectorize, a recarga é o próprio `upsert` (passo 5): sobrescreve embeddings e
metadata dos IDs existentes.
