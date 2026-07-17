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
| CATMAT — API pública `dadosabertos.compras.gov.br` (`/modulo-material/4_consultarItemMaterial`) | `fetch-catmat.mjs` | 343.510 materiais (248.017 ativos + 95.493 inativos), ~688 páginas de 500 |
| CATMAT — CSV oficial do dadosabertos (UTF-8 com BOM, `;`) — alternativa manual | `parse-csv.mjs` | 343.352 materiais, `codigoItem` único |
| CATSER — API pública `dadosabertos.compras.gov.br` (`/modulo-servico/6_consultarItemServico`) | `fetch-catser.mjs` | 2.868 serviços únicos (2.797 ativos), 7 páginas de 500 |

**Por que a API virou a fonte primária dos materiais (2026-07):** o CSV de
~120MB não tem URL pública estável — as páginas gov.br/compras que o hospedam
exigem login, o que inviabiliza a atualização agendada. A API devolve os
MESMOS campos/valores do CSV (validado item a item, inclusive o formato de
`dataHoraAtualizacao`) e ainda corrige um problema do caminho CSV: o CSV
inclui itens inativos sem dizer (343.510 = 248.017 ativos + 95.493 inativos),
e o `parse-csv.mjs` grava todos com `ativo=1`; o `fetch-catmat.mjs` grava o
`statusItem` REAL. O `parse-csv.mjs` continua válido para carga manual a
partir de um CSV local (mesmos arquivos de saída).

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

### 1a. Fetch CATMAT (online, gratuito, sem auth) — API → SQL + NDJSON
```
node --max-old-space-size=4096 fetch-catmat.mjs --out ./out
```
Gera `out/catalogo-d1.sql` e `out/itens.ndjson` (ordenados por código —
saída determinística). Para smoke test: `--max-paginas 3`.

Alternativa manual a partir do CSV local (mesmas saídas, mas `ativo=1` fixo —
ver "Fontes" acima):
```
node parse-csv.mjs --input D:/dados/catmat.csv --out ./out
```
Para validar rápido: `--sample 2000`. O CSV **não** entra no repositório.

### 1b. Fetch CATSER (online, gratuito, sem auth) — API → SQL + NDJSON
```
node fetch-catser.mjs --out ./out
```
Gera `out/catser-d1.sql` e `out/itens-servico.ndjson`.

### 2. D1 — aplicar a 0007 + importar

A migration 0007 é aplicada POR ARQUIVO, não por `d1 migrations apply`: o
`wrangler.toml` da catmat-catser-api deliberadamente não define
`migrations_dir` (para não puxar as migrations das leis para este banco), e
rodar o apply da raiz não enxerga `infra/d1-migrations/`. As 0004/0005/0006
foram aplicadas do mesmo jeito.
```
wrangler d1 execute catmat-catser-db --remote --file infra/d1-migrations/0007_catalogo_v2.sql
```
Aplicar UMA vez: reexecutar falha nos `ALTER TABLE` com
`duplicate column name: ncm` — esse erro é o sinal (inofensivo) de que a 0007
já está aplicada. Para conferir sem depender do erro:
```
wrangler d1 execute catmat-catser-db --remote --command "SELECT ncm, atualizado_em FROM catalogo_itens LIMIT 1"
```
(reclama de coluna inexistente se a 0007 ainda não entrou). Em seguida, a
carga:
```
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

Para a atualização PERIÓDICA, a recarga completa é desperdício (re-embeda
~346k itens ≈ US$ 0,35 + horas quando tipicamente poucos milhares mudaram) —
usar o fluxo delta abaixo.

## Atualização agendada (delta) — `.github/workflows/catalogo-etl.yml`

Fluxo mensal automatizado (GitHub Actions, cron dia 5 06:20 UTC) que substitui
a recarga manual por um diff campo a campo entre a fonte oficial e o D1:

```
fetch-catmat + fetch-catser (APIs, grátis)
        │
        ▼
export do D1 (8 fatias por codigo % 8)      ← o D1 é a baseline; não há
        │                                      estado paralelo para driftar
        ▼
delta.mjs — classifica cada item:
  novo            → insert + embed
  alterado_vetor  → mudou descricao/grupo/classe/pdm/ncm/ativo → upsert + re-embed
  alterado_data   → só atualizado_em mudou → upsert sem embed
  excluido        → delete no D1 + remoção do vetor
        │
        ├─ dry-run (DEFAULT): relatório do que SERIA aplicado e FIM
        ▼
embed SÓ do delta → apply atômico no D1 → gate de contagens →
vectorize upsert → limpar-orfaos → gate vectorCount
```

**Por que GitHub Actions e não Cloudflare Workflows/Container:** o runbook é
CLI-nativo (node + wrangler), o repo já tem o padrão de CI com os mesmos
secrets (`deploy.yml`), cron/aprovação/logs/artifacts vêm de graça, e um lote
mensal de minutos não justifica portar `d1 execute`/`vectorize upsert` para
chamadas REST dentro de um Container. Se um dia o job estourar os limites do
runner (6h/job), o desenho delta continua válido — só muda o executor.

### Pré-condições (uma vez, manual)

1. Migration 0007 aplicada + **carga inicial completa** feita pelo runbook
   acima (passos 1–5b). O delta ATUALIZA um catálogo carregado; ele aborta
   (gate `estado_invalido`) se o D1 estiver vazio/incompleto.
2. Secrets no repo (Settings → Secrets and variables → Actions):
   - `CATALOGO_CF_API_TOKEN` — token Cloudflare de escopo mínimo: **D1 Edit +
     Vectorize Edit + Workers AI Read**. Não reusar o token de deploy.
   - `CLOUDFLARE_ACCOUNT_ID` — já existe (deploy.yml).
   - `ALERTA_WEBHOOK_URL` (opcional) — POST JSON em falha/apply.
3. Variável `CATALOGO_ETL_MODE` **ausente ou `dry-run`** nos primeiros ciclos.
   Flipar para `apply` SÓ depois de validar 1–2 relatórios de dry-run
   (summary do run + artifact `catalogo-delta-N`).

### Gates (o run ABORTA sem aplicar nada se qualquer um reprovar)

| Gate | Default | Como aprovar acima do teto |
|---|---|---|
| Fonte insana (materiais < `CATMAT_MIN_ITENS`, serviços < `CATSER_MIN_ITENS`) | 300k / 2,5k | não se aprova — investigar a fonte |
| D1 sem carga inicial (< `D1_MIN_ITENS`) | 250k | rodar o runbook manual |
| Exclusões > `CATALOGO_MAX_EXCLUSOES` | 2.000 | dispatch manual com `override_teto_exclusoes` |
| Itens p/ (re)embed > `CATALOGO_MAX_EMBED` | 60.000 (~US$ 0,06) | dispatch manual com `override_teto_embed` |
| Exclusão fantasma (item "sumido" ainda responde na API) | sempre | não se aprova — re-rodar (fetch pegou o catálogo mudando) |
| Pós-apply D1: `COUNT(itens) == COUNT(fts) == COUNT(trgm) == esperado` | sempre | reprova → alerta e NÃO segue ao Vectorize |
| Pós-upsert: `vectorCount` converge ao total do D1 (poll 15 min) | sempre | reprova → alerta; re-executar upsert dos shards |

O custo estimado do embed (tokens × tarifa do bge-m3) sai no relatório ANTES
de qualquer passo pago; o cron **nunca** aplica acima do teto — override só
existe no dispatch manual, que é a aprovação humana.

### Semântica do PRIMEIRO apply (leia antes de flipar para apply)

Como a fonte primária virou a API (com `statusItem` real) e a carga inicial
via CSV gravou `ativo=1` para tudo, o primeiro delta vai propor a correção de
status de **~95k materiais inativos** — acima do teto de embed, portanto
exigirá `override_teto_embed` num dispatch manual (~US$ 0,10 de re-embed;
`ativo` vive na metadata do vetor, e o upsert do Vectorize exige os values —
por isso re-embeda). Ciclos seguintes voltam ao delta pequeno normal.

### Recuperação

- **Apply falhou no meio**: o `delta-d1.sql` roda num único `d1 execute
  --file` (transação) e o workflow restaura os triggers defensivamente
  (`sql/restaura-triggers.sql`). Re-rodar o workflow converge: o diff é
  contra o estado REAL do D1, não contra um log de intenções.
- **Gate de contagem reprovou**: re-rodar o workflow; persistindo, rodar
  `sql/rebuild-pos-carga.sql` (reconstrói FTS/trgm do zero).
- **vectorCount não convergiu**: D1 já está consistente; re-executar o upsert
  dos shards (`wrangler vectorize upsert catmat-catser --file ...`) ou apenas
  aguardar o próximo ciclo (upsert é idempotente).
- **Delta local (debug)**: os mesmos comandos do workflow rodam na máquina —
  exportar as 8 fatias com `wrangler d1 execute ... --json > out/d1-atual/slice-k.json`
  e `npm run delta -- --fonte out/itens.ndjson --d1 out/d1-atual --out out/delta`.
