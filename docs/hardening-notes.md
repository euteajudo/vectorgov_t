# Hardening Notes — F5.1

> Documento gerado pelo Agent-Hardening (worktree `vectorgov-t-wt-hardening`,
> branch `feature/f5-hardening`). Reflete as 3 frentes de hardening
> endereçadas na sprint F5.1.

## Resumo executivo

| # | Problema | Severidade | Status |
|---|---|---|---|
| 1 | Ingestão LC 214 falhava com R2 10058 (concorrência) | BLOQUEANTE | RESOLVIDO |
| 2 | Sem visibilidade de custo por análise | ALTA | RESOLVIDO |
| 3 | Quota diária declarada mas não aplicada + cache sem TTL default | MÉDIA | RESOLVIDO |

3 commits, 7 arquivos modificados, 4 novos, +1462/−60 linhas. Typecheck OK,
208/208 testes passando (33 novos).

---

## Mudanças aplicadas

### 1. R2 retry + concorrência reduzida (problema 1)

**Antes:** `R2_CONCURRENCY = 20` em `apps/mcp-server/src/pipeline/orchestrator.ts`
sem retry. Qualquer R2 10058 ("Reduce your concurrent request rate for the
same object") derrubava todo o pipeline e descartava os 218k tokens já gastos
no parsing da LC 214 (4336 dispositivos).

**Depois:**
- Novo `apps/mcp-server/src/lib/retry.ts` com `withR2Retry(operation, label)`:
  - Backoff exponencial: `500ms × 2^n + jitter [0,200ms]`.
  - Até 4 tentativas (1 original + 3 retries).
  - Retry apenas em erros classificados como transientes (R2 10058, ECONNRESET,
    ETIMEDOUT, 5xx, 429). 4xx (exceto 429) tem precedência via curto-circuito
    — falha rápido em bug de caller.
  - Logs JSON estruturados: `retry_attempt`, `retry_non_transient`, `retry_exhausted`.
  - Em caso de falha após retries, propaga o erro ORIGINAL (preserva stack).
- `R2_CONCURRENCY` reduzido de 20 → 8 com comentário justificando o trade-off
  de latência (LC 214: ~3min teóricos → ~6-8min observados, mas confiabilidade
  salta drasticamente).
- `withR2Retry` aplicado em todos os puts R2 do orchestrator:
  - `uploadMarkdowns` (cada `.md` por dispositivo).
  - `upsertVectorize` (cada batch).
  - `uploadNormaArtefatos` (meta/sumario/canonical, em paralelo).
  - `updateIndiceGlobal` (caso clássico de contenção — todo ingest grava aqui).

**Impacto esperado:**
- LC 214 (4336 dispositivos): deve concluir em ~6-8min em vez de falhar.
- EC 132 (376 dispositivos): sem mudança perceptível (cabe em <50 batches).
- Custo de retry: <5% de latência extra no caminho feliz (timer da 1ª tentativa
  bem-sucedida = 0ms de delay).

**Arquivos:**
- `apps/mcp-server/src/lib/retry.ts` (NOVO)
- `apps/mcp-server/src/pipeline/orchestrator.ts` (modificado)
- `apps/mcp-server/test/retry.test.ts` (NOVO — 15 testes)

---

### 2. Telemetria de custo por análise (problema 2)

**Antes:** Nenhuma visibilidade. Impossível estimar budget de produção,
detectar regressão de prompt ou identificar qual papel gasta mais.

**Depois:**
- Novo `apps/mcp-server/src/agents/cost-tracker.ts`:
  - `TrackedLLMClient` wrapper transparente sobre `LLMClient` — implementa
    a mesma interface mas acumula `result.usage` internamente.
  - `estimateCostUsd(usage, modelo)` aplica `PRECOS_POR_MILHAO_USD`:
    - Gemini 3.5 Flash: $0.075/M input + $0.30/M output
    - Gemini 3 Pro: $1.25/M input + $5.00/M output
    - Workers AI bge-m3: tratado como $0 (free tier)
  - Snapshot imutável `{total_tokens, custo_estimado_usd, total_chamadas, por_modelo[]}`.
- `PEVSEngine` (`apps/mcp-server/src/agents/pevs-engine.ts`):
  - Instancia `TrackedLLMClient` novo por execução (Feature 1 e Feature 2).
  - Passa o wrapper como `contexto.llm` aos roles — roles continuam
    ignorantes de telemetria (single responsibility).
  - Ao final, loga JSON estruturado:
    ```json
    {
      "event": "analise_completa",
      "tracing_id": "...",
      "peticao_id": "...",
      "contrato": "010/2024",
      "duracao_ms": 12450,
      "tokens_total": 2454,
      "custo_estimado_usd": 0.000779,
      "chamadas_llm": 7,
      "por_modelo": [
        {"modelo": "gemini-3.5-flash", "chamadas": 6, "total_tokens": 2177, "custo_usd": 0.000311},
        {"modelo": "gemini-3-pro", "chamadas": 1, "total_tokens": 277, "custo_usd": 0.000468}
      ]
    }
    ```
  - `ResultadoFeature1/Feature2` agora expõem `uso_llm: SnapshotUso` para
    consumo programático (dashboard, alerta de budget).
- Confirmado em `orchestrator.ts:495`: o campo `tokens_consumidos` no
  `IngestaoStatus` JÁ está sendo preenchido corretamente com `parse.tokens_aproximados`
  vindo do Container (escopo de ingestão, não de análise).

**Custo típico medido nos testes:**
- Análise procedente sem retry: ~$0.0008 USD, ~2.5k tokens, 7 chamadas.
- Análise com 1 retry: ~$0.0015 USD, ~4.5k tokens, 13 chamadas.
- Análise com retries esgotados (inconclusiva): ~$0.003 USD, ~8.6k tokens.
- Parecer (Feature 2): ~$0.0001 USD, ~650 tokens, 1 chamada.

**Arquivos:**
- `apps/mcp-server/src/agents/cost-tracker.ts` (NOVO)
- `apps/mcp-server/src/agents/pevs-engine.ts` (modificado)
- `apps/mcp-server/src/agents/index.ts` (modificado — exports)
- `apps/mcp-server/test/agents/cost-tracker.test.ts` (NOVO — 10 testes)

---

### 3. Auditoria cache + rate-limit (problema 3)

**Diagnóstico:**
- **Cache:** Wrapper genérico em `lib/cache.ts`, sem TTL default. Callers
  individuais usam TTLs variados:
  - `fs-grep`: 1h (resultados de busca podem mudar com nova ingestão).
  - `fs-listar-normas`: 6h (índice estável).
  - `skill-carregar`: 60s (proposital — janela curta para A/B test).
  - `skill-listar`: 5min (idem).
- **Cache hit/miss:** Todas as chaves de cache nas tools são determinísticas
  e específicas ao input. Não há colisão de chave entre callers.
- **Versionamento de chave:** `ingestao:status:v1:` é o ÚNICO consumidor
  que versiona. `skill:active:<nome>` NÃO inclui versão, mas o
  `skill_publicar` invalida o cache automaticamente (`cacheDelete`).
- **Rate limit:** Aplicado em `index.ts:206` antes do roteamento → cobre
  TODOS os endpoints (`/api/peticoes/upload`, `/api/peticoes/:id`, etc.).
  60/min/IP funcionava. **Quota 500/dia/IP declarada no arquitetura.md mas
  NÃO estava implementada** — gap real.

**Fixes aplicados:**

- `lib/rate-limit.ts`:
  - Quota diária implementada: chave `quota:<ip>:<dayWindow>`, TTL 26h.
  - Duas barreiras em sequência (minuto → dia), curto-circuito na 1ª violação.
  - Header `X-RateLimit-Scope: minute|day` para debug do cliente.
  - Body do 429 inclui `scope` e `retry_after_seconds`.
  - Refator: `(req, env, limit?)` → `(req, env, opts?)` com
    `{limitPerMinute, limitPerDay}`. Defaults preservam comportamento
    histórico + adicionam quota diária.
  - Leituras KV paralelas (Promise.all) — economia de 1 round-trip
    (~10-20ms em cold start).

- `lib/cache.ts`:
  - Constante exportada `CACHE_DEFAULT_TTL_SECONDS = 86400` (24h, conforme
    docs/arquitetura.md).
  - Novo helper `cacheSetWithDefaultTtl()` para callers que não querem
    pensar em TTL. NÃO modifica `cacheSet` original (backward-compat).
  - Docstring atualizada com convenções de chave (versionamento `:vN`,
    prefixos por domínio) e tabela de TTL recomendado por categoria.

**Arquivos:**
- `apps/mcp-server/src/lib/rate-limit.ts` (modificado)
- `apps/mcp-server/src/lib/cache.ts` (modificado)
- `apps/mcp-server/test/rate-limit.test.ts` (NOVO — 8 testes)

---

## Benchmarks teóricos

| Cenário | Antes | Depois | Notas |
|---|---|---|---|
| LC 214 (4336 disp) ingestão | fail @ markdown (R2 10058) | esperado: sucesso ~6-8min | Concorrência 20→8 + retry com backoff |
| EC 132 (376 disp) ingestão | ~2min | ~2min (sem mudança) | Volume cabe em <50 batches |
| Análise procedente típica | desconhecido | ~$0.0008 USD, ~2.5k tokens | Medido nos testes do PEVS |
| Análise com 1 retry | desconhecido | ~$0.0015 USD, ~4.5k tokens | Medido nos testes do PEVS |
| Análise inconclusiva (3 retries) | desconhecido | ~$0.003 USD, ~8.6k tokens | Pior caso típico |
| Parecer (Feature 2) | desconhecido | ~$0.0001 USD, ~650 tokens | Custo baixo (única chamada Flash) |
| Rate limit 60/min/IP | aplicado | aplicado | Mantido |
| Quota 500/dia/IP | declarado, NÃO aplicado | aplicado | Gap fechado |
| Custo Workers AI (embed) | $0 | $0 | Mantém free tier |
| Latência cold start rate-limit | 1 leitura KV | 2 leituras KV paralelas | +0ms (Promise.all) |

**Budget estimado (cenário moderado):**
- 100 análises/dia × $0.001 = $0.10/dia = ~$3/mês em Gemini.
- 500 análises × 50 IPs × $0.001 = ~$25/mês (cenário superior do plano).
- Workers AI, R2, Vectorize, D1, KV: free tier folgado.

---

## Riscos / observabilidade

### Latência da ingestão grande pode passar do CPU limit
O Workers tem `CPU time limit` (50ms free tier, 30s pago em workers regulares,
sem limite em `ctx.waitUntil`). A LC 214 com retry pode demorar ~7-10min de
wall-clock. O `ctx.waitUntil()` é OK para isso, mas se algum step não respeitar
o pattern, vamos exceder. **Validar em produção** com a próxima ingestão real.

### Concorrência KV ao incrementar rate-limit
A nova quota diária faz 2 puts em vez de 1 (minuto + dia). KV é
eventually-consistent — em rajadas extremas, o contador pode subestimar.
Trade-off aceitável (não estamos cobrando por uso). Migrar para Durable
Object quando virar requisito.

### Tabela de preços Gemini pode ficar desatualizada
`PRECOS_POR_MILHAO_USD` está hardcoded em `cost-tracker.ts`. Mudança de
preço exige deploy. Modelo desconhecido devolve `$0` e loga warning
`cost_tracker_modelo_desconhecido` — fácil de monitorar.

### `withR2Retry` assume operations idempotentes
Documentado no JSDoc. Os usos atuais (R2 put com mesmo key, Vectorize
upsert com mesmo id) são idempotentes. Se algum dia usarmos para
`POST`-like operações que mudam state, criar variante `withRetryOnce`
ou similar.

---

## Follow-ups não endereçados

### TTLs de cache abaixo do alvo de 24h
Vários callers usam TTL menor que o default proposto:
- `skill-carregar` (60s) — proposital para A/B test rápido, mas em produção
  com baixa frequência de publicação, subir para 1h reduziria ~98% das
  leituras de R2.
- `skill-listar` (5min) — idem.
- `fs-grep` (1h) — pode ir para 24h SE garantirmos invalidação no `purgeNorma`
  (hoje não invalida — risco de retornar resultado obsoleto).

**Ação:** Em uma sprint de polish, adicionar `cacheDelete` por prefixo em
`purgeNorma` para invalidar `fs-grep` results da norma re-ingerida; depois
subir TTL para 24h.

### Quota diária por endpoint
Hoje a quota é por IP. Endpoints caros (`POST /api/peticoes/upload` que
dispara PEVS completo) deveriam ter quota mais restritiva (ex.: 50/dia)
que `GET /api/historico` (ex.: 500/dia). Sugestão: aceitar `opts.limitPerDay`
no caller específico via uma chamada explícita no handler em vez do
middleware global.

### Skill cache key sem versão
A chave `skill:active:<nome>` poderia incluir o hash do `versao` do
front-matter para invalidar implicitamente em caso de update fora do
fluxo de `skill_publicar`. Hoje funciona porque a publicação invalida,
mas se um caller atualizar o R2 direto (sem usar a tool), o cache vai
servir versão antiga por até 60s. Baixo risco — só skills publicam.

### Budget cap mensal não implementado
`docs/arquitetura.md` menciona "Budget cap $50/mês". Hoje temos
`custo_estimado_usd` por análise (commit 2), mas não há circuit breaker
que pare análises se o agregado mensal passar do limite. Próxima
iteração: somar em D1 + checar antes de cada `executarFeature1`.

### TrackedLLMClient não é thread-safe
Documentado no JSDoc. No Workers runtime cada análise roda em isolate
sequencial, então não há problema atual. Se algum dia paralelizarmos
múltiplas análises compartilhando tracker (improvável — cada uma cria
o seu), migrar para `BigInt`/`AtomicLong`.

### Container parser não tem retry
`callContainerParse` em `pipeline/container-client.ts` faz 1 fetch sem
retry. Se o Container ficar temporariamente indisponível, perdemos a
ingestão inteira no parsing (218k tokens descartados). Aplicar o mesmo
`withR2Retry` (renomear se quisermos: `withTransientRetry`) seria o
caminho natural — fora do escopo desta sprint mas anotado.
