# Vectorgov_t

Sistema multi-agente, serverless, para analisar pedidos de reequilíbrio econômico-financeiro em contratos administrativos e gerar pareceres técnico-jurídicos auditáveis, com base na Lei 14.133/2021 e na legislação tributária brasileira pós-Reforma (EC 132/2023, LC 214/2025 e decretos correlatos).

Ferramenta especializada do portfólio **VectorGov**.

---

## O que é

Duas features de produto sobre uma única base agêntica:

1. **Análise de petição.** Recebe a petição de reequilíbrio em PDF, extrai os fatos, verifica admissibilidade (legitimidade, prazo, prova mínima, enquadramento legal), checa o nexo de causalidade e produz uma análise técnica com citações verificadas.
2. **Geração de parecer.** A partir da análise verificada e da decisão do analista humano, redige o parecer formal (relatório, fundamentação, conclusão, recomendações) em estrutura compatível com órgãos de controle.

Todo argumento jurídico passa por um agente Auditor (Gemini 3 Pro) que confere cada citação contra o texto literal da norma no filesystem. Sem fonte verificada, a citação é rejeitada.

## Status do desenvolvimento

Protótipo funcional. **Fase 5 concluída** (hardening, documentação, demo, deploy completo).

| Camada | Estado |
|---|---|
| Worker MCP | Em produção: `https://vectorgov-t-mcp.souzat19.workers.dev` |
| UI Web (Next.js via OpenNext) | Em produção: `https://vectorgov-t-web-ui.souzat19.workers.dev` |
| Container Python (parser de PDFs) | Deployado |
| Cloudflare Vectorize, R2, D1, KV | Provisionados |
| 13 tools MCP | Em produção |
| 7 roles de agente + motor PEVS | Implementados |
| 10 skills iniciais | Publicadas em `packages/skills/active/` |
| Golden set | 5 casos em `test/golden-set/` |
| Análise via UI | Mock (motor PEVS ainda não plugado no endpoint REST) |

### Estado das normas indexadas

| Norma | Status | Observação |
|---|---|---|
| EC 132/2023 | Indexada | OK |
| LC 214/2025 | Falha de ingestão | Issue conhecida (rate limit R2 em ingestão grande). Task #54. |
| Decreto 12.955/2025 | Não iniciado | Próximo passo da Fase 5 |

Estimado em [`docs/arquitetura.md`](./docs/arquitetura.md): índice projetado em ~50K chunks de 1024 dimensões quando as três normas estiverem completas.

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Cloudflare Workers + Durable Objects |
| Banco vetorial | Cloudflare Vectorize (bge-m3, 1024 dim, cosine) |
| Banco relacional + FTS5 (BM25) | Cloudflare D1 |
| Storage de leis e skills | Cloudflare R2 |
| Cache | Cloudflare KV |
| Modelos | Gemini 2.5/3 Flash (geral) + Gemini 3 Pro (Auditor) |
| Camada de modelos | Vercel AI SDK |
| Framework de agentes | Cloudflare Agents SDK |
| Parser de PDFs | Container Cloudflare (Python + FastAPI + LegisParser) |
| Frontend | Next.js 15 + Tailwind 4 + shadcn inline + React Query |
| Protocolo MCP | JSON-RPC 2.0 sobre HTTPS (`/mcp/v1`) |

## Topologia

```
+--------------------+        +----------------------------+
|   Next.js Web-UI   | HTTPS  |   Worker MCP (TypeScript)  |
|  /peticoes /skills | <----> |  - /mcp/v1 (JSON-RPC)      |
|  /admin/ingestao   |        |  - /api/peticoes/*         |
+--------------------+        |  - /api/skills/*           |
                              |  - /ingestao/iniciar       |
                              |  - 13 tools MCP            |
                              |  - 7 agentes + PEVS        |
                              +---+----+----+----+----+----+
                                  |    |    |    |    |
                                  v    v    v    v    v
                              +---+--+ +-+--+ +-+--+ +-+----------+
                              |Vector| |R2  | |D1  | |Container  |
                              |ize   | |LEIS| |+FTS| |Python     |
                              |bge-m3| |R2  | |5   | |(LegisPars |
                              |1024d | |SKIL| |    | |er, FastAPI|
                              |cosine| |LS  | |    | |sob demanda|
                              +------+ +----+ +----+ +-----------+
                                                     KV CACHE
```

Detalhes em [`docs/arquitetura.md`](./docs/arquitetura.md).

## Quickstart

Requisitos: Node 22+, pnpm 10+, Wrangler 4+ autenticado, Docker (opcional, só p/ rebuild do container).

```bash
git clone <repo-url>
cd vectorgov-t
pnpm install
cp .env.example .env   # preencha CLOUDFLARE_API_TOKEN e GOOGLE_API_KEY
pnpm -F @vectorgov-t/web-ui dev    # http://localhost:3000
```

Em outro terminal, para rodar o Worker MCP localmente:

```bash
NODE_OPTIONS=--use-system-ca pnpm -F @vectorgov-t/mcp-server dev
```

Validar:

```bash
curl https://vectorgov-t-mcp.souzat19.workers.dev/health
```

Demo guiada (passo a passo): ver [`docs/demo-roteiro.md`](./docs/demo-roteiro.md).

## Estrutura do monorepo

```
vectorgov-t/
+-- apps/
|   +-- mcp-server/         Worker TypeScript (MCP + agentes + API REST)
|   +-- ingestion-api/      Container Python (parser de PDFs)
|   +-- web-ui/             Next.js (deploy via OpenNext em Cloudflare Workers)
+-- packages/
|   +-- schemas/            Zod schemas compartilhados
|   +-- skills/             Skills em markdown (source of truth -- 10 ativas)
|   +-- shared/             Utilities TypeScript
+-- infra/
|   +-- d1-migrations/      SQL schemas
+-- docs/                   Documentacao tecnica
+-- scripts/                Scripts utilitarios
+-- test/
    +-- golden-set/         5 peticoes de teste com gabaritos
```

## Documentação

| Documento | Para que serve |
|---|---|
| [`docs/arquitetura.md`](./docs/arquitetura.md) | Visão de arquitetura e decisões |
| [`docs/infra-status.md`](./docs/infra-status.md) | Inventário dos recursos Cloudflare provisionados |
| [`docs/operacao.md`](./docs/operacao.md) | Manual do dia-a-dia (saúde, ingestão, diagnóstico) |
| [`docs/api-mcp.md`](./docs/api-mcp.md) | Referência das 13 tools MCP + integração Claude Code |
| [`docs/skills-guide.md`](./docs/skills-guide.md) | Como criar, iterar e promover skills |
| [`docs/deployment.md`](./docs/deployment.md) | Deploy from-scratch em conta Cloudflare nova |
| [`docs/troubleshooting.md`](./docs/troubleshooting.md) | Problemas comuns |
| [`docs/backlog.md`](./docs/backlog.md) | Estado das fases e próximos passos |

## Observação sobre Windows + TLS

Se encontrar `UNABLE_TO_VERIFY_LEAF_SIGNATURE` ao rodar `wrangler` ou `pnpm`:

- O `.npmrc` já está configurado com `use-system-ca=true`.
- O `.env.example` inclui `NODE_OPTIONS=--use-system-ca`.
- Causa: antivírus interceptando TLS (Kaspersky, ESET, BitDefender etc.).
- Solução permanente em [`docs/troubleshooting.md`](./docs/troubleshooting.md).

## Como contribuir

Fluxo curto e opinativo:

1. **Branch.** Crie a partir de `main`. Convenção: `feature/<area>-<curta>`, `fix/<curta>`, `docs/<curta>`.
2. **Commits semânticos.** Prefixos `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Mensagem em português, foco no porquê, não no quê.
3. **Pull Request.** Descreva o problema, a solução e como validar. Cite issues/tasks. Evite PRs com mais de 400 linhas líquidas.
4. **Antes de pedir review.** `pnpm typecheck && pnpm test` devem passar. Para mudanças em skills, inclua diff legível no PR.
5. **Sem push em `main`.** Tudo via PR.

Mais sobre o sistema de skills (versão `candidate` vs `active`, A/B test, promoção) em [`docs/skills-guide.md`](./docs/skills-guide.md).
