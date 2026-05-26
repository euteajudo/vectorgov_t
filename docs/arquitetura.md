# Arquitetura — Vectorgov_t

> Documento vivo. Reflete as decisões consolidadas até o momento.

## Visão geral

Sistema multi-agente serverless para análise de pedidos de reequilíbrio econômico-financeiro e geração de pareceres técnico-jurídicos, baseado na legislação tributária brasileira pós-reforma.

## Componentes

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Cloudflare Pages)                      │
│   Upload de petição │ Visualização │ Editor de parecer │ Skills │ Logs  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ HTTPS / SSE
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKER (MCP server + Agents)                    │
│                                                                         │
│   MCP endpoint (/mcp/v1)        Agentes (Durable Objects)               │
│   ├─ 9 tools de legislação      ├─ Orquestrador (Gemini 3.5 Flash)      │
│   │   • 4 semânticas            ├─ Pesquisador                          │
│   │   • 5 filesystem            ├─ Analista Jurídico                    │
│   └─ 4 tools de skills          ├─ Especialista de Licitações           │
│                                 ├─ Especialista de Reequilíbrio         │
│   Proteções:                    ├─ Calculista                           │
│   ├─ Rate limit 60/min/IP       ├─ Auditor (Gemini 3 Pro)               │
│   ├─ Quota 500/dia/IP           └─ Redator                              │
│   ├─ Cache KV (24h)                                                     │
│   └─ Budget cap $50/mês                                                 │
└────┬──────────────┬──────────────┬──────────────┬─────────────┬─────────┘
     │              │              │              │             │
     ▼              ▼              ▼              ▼             ▼
┌─────────┐   ┌─────────┐    ┌─────────┐    ┌─────────┐   ┌──────────┐
│Vectorize│   │   R2    │    │   D1    │    │Workers  │   │Container │
│         │   │         │    │         │    │   AI    │   │ (Python) │
│ ~50K    │   │ Leis    │    │ Versões │    │         │   │          │
│ chunks  │   │ +       │    │ +       │    │ bge-m3  │   │ Parser   │
│ 1024dim │   │ Skills  │    │ FTS5    │    │ +       │   │ de PDFs  │
│ cosine  │   │ MD+YAML │    │ (BM25)  │    │ reranker│   │ (sob     │
│         │   │         │    │         │    │         │   │ demanda) │
└─────────┘   └─────────┘    └─────────┘    └─────────┘   └──────────┘
```

## Decisões arquiteturais

| Domínio | Decisão | Justificativa |
|---|---|---|
| Runtime | Cloudflare Workers + Durable Objects | Edge global, state persistente |
| Modelos | Gemini 3.5 Flash + Gemini 3 Pro (Auditor) | Custo baixo + qualidade no ponto crítico |
| Adapter de LLM | Vercel AI SDK | Universal, troca de provider em 1 linha |
| Banco vetorial | Cloudflare Vectorize | Free tier folgado, integrado |
| Storage | Cloudflare R2 | $0 egress, S3-compatible |
| Versionamento de leis | D1 SQLite | Relacional simples, FTS5 nativo (BM25 grátis) |
| Busca híbrida | Vectorize + D1 FTS5 + RRF | Performance + precisão |
| Anti-alucinação | Agente Auditor verifica TODA citação contra filesystem | Garantia jurídica |
| Padrão agêntico | Plan-Execute-Verify-Synthesize (PEVS) | Decomposição + paralelismo + verificação |
| Skills | Meta-skill + lazy loading | Reduz contexto, A/B test sem deploy |
| Schemas | Zod (equivalente Pydantic 2) | Type-safe + structured outputs |

## Fluxo das 2 features

### Feature 1 — Análise de petição
```
Upload → Extração estruturada → PLAN → EXECUTE paralelo
      → ANALYZE → VERIFY (Auditor) → SYNTHESIZE → Análise técnica
```

### Feature 2 — Geração de parecer
```
Análise + decisão do analista → PLAN → EXECUTE paralelo por seção
      → VERIFY → SYNTHESIZE → Parecer formal (editável)
```

## Princípios

1. **Anti-alucinação por design** — Auditor obrigatório
2. **Sempre revisão humana** — analista revisa parecer antes de aprovar
3. **Rastreabilidade total** — cada citação tem hash + r2_path
4. **Skills dinâmicas** — iteração sem deploy
5. **Custo previsível** — < $0,50 por petição completa

## Próximas leituras

- [`operacao.md`](./operacao.md) — operação do dia-a-dia
- [`api-mcp.md`](./api-mcp.md) — referência das 13 tools
- [`skills-guide.md`](./skills-guide.md) — como criar e iterar skills
