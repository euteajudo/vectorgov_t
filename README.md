# Vectorgov_t

**MCP server + agent system para análise de legislação tributária brasileira pós-reforma.**

Tool especializada do portfólio **VectorGov** para análise de pedidos de reequilíbrio econômico-financeiro e geração de pareceres técnicos.

---

## O que é

Sistema multi-agente que:
1. **Analisa petições** de reequilíbrio econômico-financeiro enviadas por contratados, verificando admissibilidade conforme Lei 14.133/2021 e LC 214/2025
2. **Gera pareceres técnicos** formais para o analista do órgão público, com fundamentação rastreável e auditável

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Cloudflare Workers + Durable Objects |
| Banco vetorial | Cloudflare Vectorize (bge-m3, 1024 dim) |
| Storage de leis e skills | Cloudflare R2 |
| Banco relacional + FTS5 (BM25) | Cloudflare D1 |
| Modelos | Gemini 3.5 Flash (geral) + Gemini 3 Pro (Auditor) |
| Camada de modelos | Vercel AI SDK |
| Framework de agentes | Cloudflare Agents SDK |
| Parser de PDFs | Container Cloudflare (Python + LegisParser) |
| Frontend | Cloudflare Pages (Next.js) |
| Protocolo | MCP (Model Context Protocol) |

## Estrutura do monorepo

```
vectorgov-t/
├── apps/
│   ├── mcp-server/         # Worker TypeScript (MCP + Agents)
│   ├── ingestion-api/      # Container Python (parser de PDFs)
│   └── web-ui/             # Cloudflare Pages (frontend)
├── packages/
│   ├── schemas/            # Zod schemas compartilhados
│   ├── skills/             # Skills em markdown (source of truth)
│   └── shared/             # Utilities TypeScript
├── infra/
│   └── d1-migrations/      # SQL schemas
├── docs/                   # Documentação técnica
├── scripts/                # Scripts utilitários
└── test/
    └── golden-set/         # Petições de teste com gabaritos
```

## Primeiros passos

### Pré-requisitos
- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Wrangler CLI autenticado
- Python 3.12 (para o container do parser)
- Docker (para build do container)

### Instalação
```bash
pnpm install
cp .env.example .env
# preencha .env com seus secrets
```

### Desenvolvimento
```bash
pnpm dev          # roda todos os apps em modo dev
pnpm typecheck    # verifica tipos
pnpm test         # roda testes
```

## Observação sobre Windows + TLS

Caso encontre erro `UNABLE_TO_VERIFY_LEAF_SIGNATURE` ao rodar wrangler ou pnpm:
- O `.npmrc` já está configurado com `use-system-ca=true`
- O `.env.example` inclui `NODE_OPTIONS=--use-system-ca`
- Causa: antivírus interceptando TLS (Kaspersky, ESET, etc.)

## Documentação

- [`docs/arquitetura.md`](./docs/arquitetura.md) — visão da arquitetura
- [`docs/operacao.md`](./docs/operacao.md) — como operar o sistema
- [`docs/api-mcp.md`](./docs/api-mcp.md) — referência das 13 tools MCP
- [`docs/skills-guide.md`](./docs/skills-guide.md) — como criar e iterar skills
- [`docs/troubleshooting.md`](./docs/troubleshooting.md) — problemas comuns

## Status do desenvolvimento

Em construção. Acompanhe o backlog completo em [`docs/backlog.md`](./docs/backlog.md).
