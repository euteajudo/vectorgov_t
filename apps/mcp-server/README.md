# @vectorgov-t/mcp-server

Worker Cloudflare que expoe o **MCP (Model Context Protocol)** com tools e agentes para analise jurídico-tributária do Vectorgov_t.

Estado atual: **Fase 1 — scaffolding**. Tools e agentes serao adicionados na Fase 2.

---

## Endpoints

| Metodo | Path | Descricao |
|---|---|---|
| GET | `/health` | Status + uptime do isolate + versao |
| GET | `/version` | Metadados do build (name, version, mcp_protocol, build_date) |
| GET | `/robots.txt` | Bloqueia rastreadores (endpoint nao publico) |
| POST | `/mcp/v1` | JSON-RPC 2.0 — `tools/list`, `tools/call` |
| OPTIONS | `*` | CORS preflight (sem rate-limit) |

Toda resposta recebe:
- **CORS** aberto (`*`) — endpoint stateless, sem cookies.
- **Security headers**: CSP `default-src 'none'`, X-Frame-Options DENY, X-Content-Type-Options nosniff, HSTS, Referrer-Policy no-referrer.
- **Rate-limit**: 60 req/min/IP via KV `CACHE` (chave `ratelimit:<ip>:<window>`).

---

## Estrutura

```
apps/mcp-server/
├── src/
│   ├── index.ts          # roteador HTTP + middleware
│   ├── env.ts            # tipagem dos bindings
│   ├── mcp/
│   │   ├── server.ts     # handler JSON-RPC
│   │   └── tools/        # tools MCP (F2)
│   ├── agents/           # agentes (F2)
│   ├── schemas/          # schemas Zod (F2)
│   └── lib/
│       ├── cache.ts      # wrapper KV
│       ├── rate-limit.ts # contador por IP
│       ├── security.ts   # CORS + security headers
│       └── responses.ts  # helpers JSON / JSON-RPC
├── test/
│   ├── _fakes.ts         # fakes dos bindings (KV em memoria, etc)
│   ├── handler.test.ts   # health / version / robots / 404 / CORS
│   └── mcp.test.ts       # tools/list, tools/call, erros JSON-RPC
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

---

## Desenvolvimento

> **Windows + TLS** — todo comando `pnpm` / `wrangler` precisa do prefixo `NODE_OPTIONS=--use-system-ca` para evitar `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (interceptacao TLS por antivirus).

### Instalar dependencias (a partir da raiz do monorepo)

```bash
NODE_OPTIONS=--use-system-ca pnpm install
```

### Typecheck

```bash
cd apps/mcp-server
NODE_OPTIONS=--use-system-ca pnpm typecheck
```

### Testes

```bash
cd apps/mcp-server
NODE_OPTIONS=--use-system-ca pnpm test          # uma vez
NODE_OPTIONS=--use-system-ca pnpm test:watch    # modo watch
```

### Dev local (precisa de `wrangler.toml`)

```bash
cd apps/mcp-server
NODE_OPTIONS=--use-system-ca pnpm dev
```

> O `wrangler.toml` ainda nao foi criado nesta fase — sera adicionado quando houver bindings reais provisionados (Track A do plano).

---

## Codigos de erro JSON-RPC suportados

| Codigo | Significado | Quando |
|---|---|---|
| `-32700` | Parse error | Body nao e JSON valido |
| `-32600` | Invalid Request | Falta `jsonrpc: "2.0"` ou `method` |
| `-32601` | Method not found | Metodo desconhecido OU tool nao registrada |
| `-32602` | Invalid params | `params` malformado (ex.: `name` ausente em `tools/call`) |
| `-32603` | Internal error | Excecao nao tratada do servidor |

---

## Proximas etapas (F2)

- Registry real de tools em `src/mcp/tools/`
- Schemas Zod compartilhados em `src/schemas/`
- Agentes Durable Object em `src/agents/`
- `wrangler.toml` com bindings reais (Vectorize, R2, D1, KV, AI)
