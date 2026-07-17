# catalogo-kv-proto (PROTÓTIPO — não é produção)

Worker **descartável** que mede a latência de servir as **facetas de topo** do
catálogo (`dim=grupo` / `dim=classe`) por **Workers KV** vs pela **mesma query
D1**, de dentro da borda — o único lugar onde a latência real de `KV.get` e de
uma query D1 aparece.

> Existe só para embasar a decisão descrita em
> [`docs/design/catalogo-kv-facetas.md`](../../docs/design/catalogo-kv-facetas.md).
> **NÃO** faz parte do `deploy.yml` (fora dos paths-filter) e **NÃO** toca o
> `catmat-catser-api`. Lê o mesmo D1 apenas com `SELECT`; escreve só num KV de
> teste isolado.

## Rotas

| Rota | O que faz |
|---|---|
| `GET /seed` | Recomputa as facetas no D1 e grava no KV (o *write-through* que o ETL faria no fim do apply). Idempotente. |
| `GET /cmp?dim=grupo\|classe` | Lê a MESMA faceta do KV e do D1, mede as duas latências (5 amostras) e devolve o comparativo + tamanho. |

## Como rodar

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
npx wrangler kv namespace create FACETAS_PROTO   # cria o KV de teste; cole o id no wrangler.toml
npx wrangler deploy
curl "https://catalogo-kv-proto.<sub>.workers.dev/seed"
curl "https://catalogo-kv-proto.<sub>.workers.dev/cmp?dim=grupo"
```

## Teardown (após a análise)

```bash
npx wrangler delete --name catalogo-kv-proto
npx wrangler kv namespace delete --namespace-id <id do FACETAS_PROTO>
```
