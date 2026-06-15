# vectorgov-edu

MCP **read-only** com as 6 tools de **pesquisa** do VectorGov‑T, empacotadas
para distribuir aos alunos. Reaproveita a fonte do `@vectorgov-t/mcp-server`
por import direto — **não há código duplicado**; corrigir uma tool no servidor
completo corrige aqui também.

## Tools expostas

| Grupo | Tool | O que faz |
|---|---|---|
| Catálogo | `buscar_catalogo_semantico` | CATMAT/CATSER por similaridade (embed + rerank) |
| Catálogo | `grep_catalogo` | Busca lexical/exata no catálogo |
| Preços | `consultar_precos_praticados` | Preços públicos (Compras.gov) + estatísticas |
| Acórdãos | `buscar_acordaos_tcu` | Jurisprudência TCU semântica (Vectorize) |
| Acórdãos | `buscar_acordaos_lexical` | Jurisprudência TCU lexical (FTS5) |
| Acórdãos | `listar_acordaos` | Lista/paginação de acórdãos ingeridos |

Nada de tools de escrita, ingestão, skills, pareceres ou chat.

## Por que é seguro/barato

- **Sem secrets.** Embeddings e rerank rodam em Workers AI (`bge-m3` /
  `bge-reranker-base`); não passa pelo Gemini/AI Gateway, então `CF_AIG_TOKEN`
  não é necessário.
- **Read-only.** Aponta para os mesmos índices/bancos de produção
  (`catmat-catser`, `acordaos-tcu`, `vectorgov-t-db`, `vectorgov-a-db`) apenas
  para leitura.
- **Superfície mínima.** Sem R2, Durable Objects, service binding de ingestão.

## Proteção

Não há autenticação (decisão de projeto). A única proteção é **rate-limit por
IP**: `30 req/min` e `1000 req/dia` (ver `src/index.ts`). Para conter custo de
Workers AI, ajuste `RATE_LIMIT` lá se necessário.

> Recomendado: criar um KV dedicado em vez de reusar o de produção —
> `wrangler kv namespace create CACHE_EDU` e trocar o `id` em `wrangler.toml`.

## Deploy

```bash
cd apps/mcp-edu
pnpm install            # (na raiz do monorepo)
pnpm typecheck
npx wrangler deploy --dry-run --outdir /tmp/build   # confere o bundle
pnpm deploy             # publica vectorgov-edu
```

Endpoint resultante: `https://vectorgov-edu.<sua-conta>.workers.dev/mcp`

Health check: `GET /health` · catálogo de tools: `GET /version`.

## Como o aluno conecta (ex.: Claude Code / claude.ai)

Servidor MCP via Streamable HTTP, endpoint `POST /mcp`:

```json
{
  "mcpServers": {
    "vectorgov-edu": {
      "url": "https://vectorgov-edu.<sua-conta>.workers.dev/mcp"
    }
  }
}
```

Sem header de auth — basta a URL.
