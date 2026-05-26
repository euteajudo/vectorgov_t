# Infra Status — Vectorgov_t (Fase 1, Track A)

Inventário dos recursos Cloudflare provisionados para o projeto
**Vectorgov_t** — sistema multi-agente para análise de legislação tributária
brasileira sobre Cloudflare Workers + Vectorize + R2 + D1.

## Conta Cloudflare

| Campo       | Valor                                  |
| ----------- | -------------------------------------- |
| Account ID  | `a89dbdb0224cd8d2292cda8a038bc297`     |
| Email       | souzat19@yahoo.com.br                  |
| Wrangler    | 4.59.3                                 |

> **Nota TLS (Windows):** todo comando `wrangler` precisa do prefixo
> `NODE_OPTIONS=--use-system-ca` por causa de TLS interception por antivírus
> local. Sem isso o wrangler falha com `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

## Vectorize

| Campo            | Valor                                                    |
| ---------------- | -------------------------------------------------------- |
| Index name       | `legislacao-tributaria`                                  |
| Dimensions       | 1024                                                     |
| Metric           | cosine                                                   |
| Descrição        | Legislacao tributaria brasileira pos-reforma             |
| Criado em        | 2026-05-26T22:46:26Z                                     |
| Dashboard URL    | <https://dash.cloudflare.com/a89dbdb0224cd8d2292cda8a038bc297/workers/vectorize/legislacao-tributaria> |

### Metadata indexes (4)

| Property name      | Tipo   |
| ------------------ | ------ |
| `lei`              | String |
| `artigo`           | Number |
| `tema`             | String |
| `tipo_dispositivo` | String |

### Validação

```bash
NODE_OPTIONS=--use-system-ca wrangler vectorize list
NODE_OPTIONS=--use-system-ca wrangler vectorize list-metadata-index legislacao-tributaria
```

## R2 buckets

| Bucket name           | Criado em             | Dashboard URL                                                                            |
| --------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `vectorgov-t-leis`    | 2026-05-26T22:46:53Z  | <https://dash.cloudflare.com/a89dbdb0224cd8d2292cda8a038bc297/r2/default/buckets/vectorgov-t-leis>   |
| `vectorgov-t-skills`  | 2026-05-26T22:46:56Z  | <https://dash.cloudflare.com/a89dbdb0224cd8d2292cda8a038bc297/r2/default/buckets/vectorgov-t-skills> |

Ambos com storage class **Standard**.

### Validação

```bash
NODE_OPTIONS=--use-system-ca wrangler r2 bucket list
```

## D1 database

| Campo          | Valor                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| Database name  | `vectorgov-t-db`                                                                       |
| Database ID    | `44068178-9600-42f3-875d-26ce47a11fd4`                                                 |
| Região         | ENAM                                                                                   |
| Criado em      | 2026-05-26T22:47:13Z                                                                   |
| Dashboard URL  | <https://dash.cloudflare.com/a89dbdb0224cd8d2292cda8a038bc297/workers/d1/databases/44068178-9600-42f3-875d-26ce47a11fd4> |

### Schema aplicado (`infra/d1-migrations/0001_initial.sql`)

5 tabelas + FTS5 virtual:

- `normas`              — metadados da norma (lei, decreto, MP etc.)
- `dispositivos`        — artigos/parágrafos/incisos/alíneas
- `versoes_dispositivos` — versionamento temporal (data_inicio / data_fim)
- `relacoes`            — alterações, revogações, regulamentações etc.
- `dispositivos_fts`    — virtual FTS5 (unicode61, `remove_diacritics 2`) para BM25

Índices criados:

- `idx_versoes_vigente` em `versoes_dispositivos(dispositivo_id, data_inicio, data_fim)`
- `idx_relacoes_origem` em `relacoes(origem_id, tipo)`
- `idx_relacoes_destino` em `relacoes(destino_id, tipo)`

### Validação

```bash
NODE_OPTIONS=--use-system-ca wrangler d1 list
NODE_OPTIONS=--use-system-ca wrangler d1 execute vectorgov-t-db --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Deve retornar (12 tabelas): `_cf_KV`, `dispositivos`, `dispositivos_fts`,
`dispositivos_fts_config`, `dispositivos_fts_content`, `dispositivos_fts_data`,
`dispositivos_fts_docsize`, `dispositivos_fts_idx`, `normas`, `relacoes`,
`sqlite_sequence`, `versoes_dispositivos`.

## KV namespace

| Campo          | Valor                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| Namespace name | `CACHE`                                                                |
| Namespace ID   | `0b4eaf157c064a51bcbf1d5e87af6f66`                                     |
| Criado em      | 2026-05-26T22:47:33Z (aproximado)                                      |
| Dashboard URL  | <https://dash.cloudflare.com/a89dbdb0224cd8d2292cda8a038bc297/workers/kv/namespaces/0b4eaf157c064a51bcbf1d5e87af6f66> |

### Validação

```bash
NODE_OPTIONS=--use-system-ca wrangler kv namespace list
```

## Bindings configurados

Os bindings estão declarados em `apps/mcp-server/wrangler.toml`:

| Binding        | Tipo        | Recurso                                              |
| -------------- | ----------- | ---------------------------------------------------- |
| `AI`           | Workers AI  | (binding nativo)                                     |
| `VECTORIZE`    | Vectorize   | `legislacao-tributaria`                              |
| `R2_LEIS`      | R2          | `vectorgov-t-leis`                                   |
| `R2_SKILLS`    | R2          | `vectorgov-t-skills`                                 |
| `DB`           | D1          | `vectorgov-t-db` (`44068178-9600-42f3-875d-26ce47a11fd4`) |
| `CACHE`        | KV          | `CACHE` (`0b4eaf157c064a51bcbf1d5e87af6f66`)         |

Observability habilitado (`[observability] enabled = true`).

> Durable Objects e Containers serão adicionados em fases posteriores.

## Recursos pré-existentes (NÃO TOCAR)

Estes recursos pertencem ao VectorGov atual e estão **fora do escopo** deste
projeto. Listados aqui apenas para evitar confusão:

- R2 buckets: `catmat`, `escola`, `leis-regulamentos`, `vectorgov-backups`
- KV namespace: `AUTH_CACHE` (`77be21b8edf04cdb8396637b7a953e8a`)
