# Operação — Vectorgov_t

Manual do dia-a-dia para operar o sistema em produção. Cobre verificação de saúde, ingestão de normas, monitoramento de análises, diagnóstico de falhas, recuperação e controle de custo.

Pré-requisitos para todos os comandos abaixo:

- `wrangler` 4+ autenticado na conta `a89dbdb0224cd8d2292cda8a038bc297`.
- Em Windows: `NODE_OPTIONS=--use-system-ca` em todos os comandos (ver [`troubleshooting.md`](./troubleshooting.md)).
- Working dir: raiz do monorepo, salvo aviso em contrário.

---

## 1. Saúde do sistema

### Health do Worker MCP

```bash
curl https://vectorgov-t-mcp.souzat19.workers.dev/health
```

Resposta esperada:

```json
{ "status": "ok", "uptime_seconds": 12, "version": "0.1.0" }
```

`uptime_seconds` reseta a cada cold start de isolate. Não é métrica de processo.

### Versão do build

```bash
curl https://vectorgov-t-mcp.souzat19.workers.dev/version
```

Devolve nome do servidor, versão semântica, versão do protocolo MCP e data do build. Útil para confirmar que um deploy entrou no ar.

### Contagem de normas no D1

```bash
NODE_OPTIONS=--use-system-ca wrangler d1 execute vectorgov-t-db --remote \
  --command "SELECT COUNT(*) as total FROM normas"
```

Confronta com [`infra-status.md`](./infra-status.md): hoje deve indicar a EC 132/2023 ao menos. LC 214 está ausente (issue conhecida, ver §9).

Contagem de dispositivos:

```bash
NODE_OPTIONS=--use-system-ca wrangler d1 execute vectorgov-t-db --remote \
  --command "SELECT norma_id, COUNT(*) as dispositivos FROM dispositivos GROUP BY norma_id"
```

### Dashboard Cloudflare

Links úteis (mesmo account ID):

- Worker MCP — observability tab para logs em tempo real.
- Vectorize `legislacao-tributaria` — gráfico de vetores ingeridos.
- R2 `vectorgov-t-leis` e `vectorgov-t-skills` — tamanho e contagem de objetos.
- D1 `vectorgov-t-db` — query console.
- KV `CACHE` — contagem de keys.

URLs completas em [`infra-status.md`](./infra-status.md).

### Listar tools MCP disponíveis

```bash
curl -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Deve trazer 13 tools (4 semânticas + 5 filesystem + 4 skills). Referência completa em [`api-mcp.md`](./api-mcp.md).

---

## 2. Ingerir uma norma nova

Duas vias: UI Admin (recomendada para humano) e API direta (recomendada para script).

### Via UI

1. `pnpm -F @vectorgov-t/web-ui dev` (ou abrir o domínio Pages quando deployado).
2. Acessar `http://localhost:3000/admin/ingestao/nova`.
3. Selecionar PDF e preencher 5 campos:
   - `lei_id` — slug canônico (kebab-case). Ex.: `lc-214-2025`.
   - `lei_tipo` — uma das opções do select (`lei_complementar`, `lei`, `decreto`, `emenda_constitucional`, `instrucao_normativa`).
   - `numero` — string. Ex.: `214`.
   - `ano` — inteiro. Ex.: `2025`.
   - `data_publicacao` — ISO `YYYY-MM-DD`.
4. Enviar. Redireciona para `/admin/ingestao/status/{ingestao_id}` com polling automático.

### Via API direta

```bash
NODE_OPTIONS=--use-system-ca curl -X POST \
  https://vectorgov-t-mcp.souzat19.workers.dev/ingestao/iniciar \
  -F "pdf=@./lc-214-2025.pdf" \
  -F "lei_id=lc-214-2025" \
  -F "lei_tipo=lei_complementar" \
  -F "numero=214" \
  -F "ano=2025" \
  -F "data_publicacao=2025-01-16"
```

Resposta 202 com `{ "ingestao_id": "<uuid>" }`.

O pipeline corre em background. Polling:

```bash
curl https://vectorgov-t-mcp.souzat19.workers.dev/ingestao/status/<uuid>
```

Resposta:

```json
{
  "ingestao_id": "...",
  "fase": "embedding",
  "progresso_pct": 40,
  "total_dispositivos": 612,
  "processados": 400,
  "iniciado_em": "...",
  "atualizado_em": "..."
}
```

Fases possíveis (`fase`): `pending`, `parsing`, `markdown`, `embedding`, `vectorize`, `d1`, `indices`, `done`, `failed`. Detalhes em §4.

---

## 3. Re-ingerir uma norma (idempotência)

Re-ingerir é seguro: o orquestrador faz `purgeNorma()` antes do upsert. Esse purge remove a norma de:

- **D1** — `normas`, `dispositivos`, `versoes_dispositivos` (`batch()` transacional), e `dispositivos_fts` (por `norma_id`).
- **Vectorize** — `deleteByIds` em batches de até 1000 IDs.
- **R2** — `list({prefix: "<lei_id>/"})` paginado, depois `delete([...keys])`.

Como acionar: simplesmente repetir o `POST /ingestao/iniciar` com o **mesmo `lei_id`**. Não há flag obrigatória — o purge sempre roda.

Validar pós-reingestão:

```bash
NODE_OPTIONS=--use-system-ca wrangler d1 execute vectorgov-t-db --remote \
  --command "SELECT COUNT(*) FROM dispositivos WHERE norma_id='<lei_id>'"
```

Conferir contra `total_dispositivos` reportado pelo status de ingestão.

---

## 4. Monitorar análise em andamento

Cada petição é um registro no KV (`peticao:<id>`, TTL 24h). Para acompanhar:

```bash
curl https://vectorgov-t-mcp.souzat19.workers.dev/api/peticoes/<id>
```

Resposta inclui `fase`, `progresso_pct`, `iniciado_em`, `atualizado_em`, `analise` (presente só quando `fase=done`) e `erro` (presente em `failed`).

Fases da análise (motor PEVS, Feature 1):

| Fase | Significado |
|---|---|
| `queued` | Pedido recebido, agendado |
| `PLAN` | Orquestrador decompondo em subtarefas |
| `EXECUTE` | Subtarefas paralelas (pesquisador, especialistas, calculista) |
| `ANALYZE` | Analista jurídico consolidando |
| `VERIFY` | Auditor checando citações byte-a-byte |
| `SYNTHESIZE` | Geração da análise final assinada |
| `done` | Concluído |
| `failed` | Erro — campo `erro` populado |

> **Estado atual:** o endpoint `/api/peticoes/upload` ainda usa um `simularPipeline` que avança as fases sem chamar o motor PEVS real. A integração final está marcada como TODO em `apps/mcp-server/src/api/peticoes.ts`. Análise real ocorre via chamadas MCP diretas pelo agente (Claude Code ou similar).

---

## 5. Diagnosticar análise ou ingestão que falhou

### Logs em tempo real

```bash
NODE_OPTIONS=--use-system-ca wrangler tail vectorgov-t-mcp --format pretty
```

Filtrar por evento:

```bash
NODE_OPTIONS=--use-system-ca wrangler tail vectorgov-t-mcp --search "pipeline_failed"
NODE_OPTIONS=--use-system-ca wrangler tail vectorgov-t-mcp --search "vectorize_delete_warn"
NODE_OPTIONS=--use-system-ca wrangler tail vectorgov-t-mcp --search "r2_delete_warn"

# Telemetria de custo (adicionada na F5.1):
NODE_OPTIONS=--use-system-ca wrangler tail vectorgov-t-mcp --search "analise_completa"
NODE_OPTIONS=--use-system-ca wrangler tail vectorgov-t-mcp --search "parecer_completo"
```

Os eventos `analise_completa` e `parecer_completo` registram `tokens_total`, `custo_estimado_usd`, `chamadas_llm` e breakdown `por_modelo` (Flash/Pro). Útil para auditoria de custo por petição.

### Campos de diagnóstico

Em uma ingestão `failed`, o KV (`ingestao:<id>`) tem:

- `fase` — onde parou (`parsing`, `embedding`, `vectorize`, `d1`, `indices`).
- `erro` — mensagem do `Error.message` capturado pelo orchestrator.
- `warnings[]` — coletados ao longo do pipeline (parsing parcial, dispositivos vazios, etc.).

Em uma petição `failed`, o KV (`peticao:<id>`) tem:

- `fase` — em qual fase PEVS parou.
- `erro` — mensagem.

### Tabela rápida de erros comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| `INGESTION_API_SECRET não configurado` | Secret não setado no Worker MCP | `wrangler secret put INGESTION_API_SECRET` |
| Status 502 do Container | Cold start do container ou parse de PDF inválido | Repetir; checar `wrangler tail vectorgov-t-ingestion` |
| `fase=embedding` com `processados < total` parado | Quota Workers AI esgotada (Neuron limit) | Aguardar reset diário ou aumentar limite |
| `r2_delete_warn` em batch grande | Rate limit R2 (issue conhecida task #54) | Re-ingerir; deixar idempotência limpar |
| `Tool not found` ao chamar MCP | Tool name digitado errado | `tools/list` e copiar nome canônico |

---

## 6. Reindexar tudo (disaster recovery)

Caso de uso: corrupção em massa, mudança de modelo de embeddings, recriação do índice.

Procedimento manual (ordem importa):

1. Drop do índice Vectorize:
   ```bash
   NODE_OPTIONS=--use-system-ca wrangler vectorize delete legislacao-tributaria
   NODE_OPTIONS=--use-system-ca wrangler vectorize create legislacao-tributaria \
     --dimensions=1024 --metric=cosine \
     --description="Legislacao tributaria brasileira pos-reforma"
   ```
2. Recriar metadata indexes (4):
   ```bash
   NODE_OPTIONS=--use-system-ca wrangler vectorize create-metadata-index \
     legislacao-tributaria --property-name=lei --type=string
   NODE_OPTIONS=--use-system-ca wrangler vectorize create-metadata-index \
     legislacao-tributaria --property-name=artigo --type=number
   NODE_OPTIONS=--use-system-ca wrangler vectorize create-metadata-index \
     legislacao-tributaria --property-name=tema --type=string
   NODE_OPTIONS=--use-system-ca wrangler vectorize create-metadata-index \
     legislacao-tributaria --property-name=tipo_dispositivo --type=string
   ```
3. Limpar D1:
   ```bash
   NODE_OPTIONS=--use-system-ca wrangler d1 execute vectorgov-t-db --remote \
     --command "DELETE FROM dispositivos_fts; DELETE FROM versoes_dispositivos; DELETE FROM dispositivos; DELETE FROM normas;"
   ```
4. Limpar R2:
   ```bash
   NODE_OPTIONS=--use-system-ca wrangler r2 bucket delete vectorgov-t-leis --force
   NODE_OPTIONS=--use-system-ca wrangler r2 bucket create vectorgov-t-leis
   ```
   (não é `delete recursive`; o `--force` confirma o purge.)
5. Re-ingerir cada norma com `POST /ingestao/iniciar` (ver §2).

Cuidado: drop do Vectorize **não é reversível**. Faça backup do dump dos vetores antes (não há comando nativo — exportar via `query` é o substituto pragmático).

---

## 7. Backup de skills

As skills moram em duas camadas:

- **Source of truth** em `packages/skills/active/*.md` (commitado no git).
- **Runtime** em `R2_SKILLS` (bucket `vectorgov-t-skills`), prefixos `active/`, `candidate/` e `archive/`.

Para backup do bucket R2:

```bash
# Lista todas as keys
NODE_OPTIONS=--use-system-ca wrangler r2 object list vectorgov-t-skills

# Baixa uma skill específica
NODE_OPTIONS=--use-system-ca wrangler r2 object get \
  vectorgov-t-skills/active/extracao-estruturada-peticao.md \
  --file ./backup/extracao-estruturada-peticao.md
```

Para backup em massa, iterar com `r2 object list` + `r2 object get` em loop (não há comando `sync` nativo do wrangler). Alternativa: rodar `scripts/upload-skills-to-r2.mjs` do git como fonte canônica e tratar R2 como cache descartável.

---

## 8. Tweaks de custo

O sistema é projetado para custo **abaixo de $0,50/petição completa** (alvo, ver [`arquitetura.md`](./arquitetura.md)). Para reduzir gasto:

| Knob | Onde | Efeito |
|---|---|---|
| TTL do cache de busca | `apps/mcp-server/src/mcp/tools/filesystem/fs-grep.ts` (`GREP_CACHE_TTL`) | Reduz hits em D1 |
| TTL do cache `_meta` de skills | `packages/schemas/src/skills.ts` (`SKILL_KV_TTL_META`) | Reduz reads R2 |
| TTL do cache de skills individuais | (`SKILL_KV_TTL_SKILL`) | Reduz reads R2 |
| `BATCH_SIZE` da ingestão | `apps/mcp-server/src/pipeline/orchestrator.ts` | 100 é o teto seguro; reduzir economiza memória mas aumenta subrequests |
| `R2_CONCURRENCY` (default: **8** após F5.1) | mesmo arquivo, linha 82 | Reduzir desafoga subrequest budget (50 free / 1000 pago) e diminui rate-limit do R2 |
| Skill compacta | escrever skills < 2000 tokens (ver [`skills-guide.md`](./skills-guide.md)) | Economia direta em tokens de input |
| `top_k` em `buscar_legislacao` | argumento da tool | Menos chunks lidos do Vectorize |

Modelo: o agente Auditor usa Gemini 3 Pro (caro). Trocar por Flash compromete a anti-alucinação — não recomendado.

---

## 9. Limites conhecidos

- **Ingestão de normas grandes (> 4.000 dispositivos)** sofreu rate limit R2 historicamente. F5.1 reduziu `R2_CONCURRENCY` para 8 e adicionou `withR2Retry` (backoff + jitter). LC 214 deve concluir em ~6-8min em vez de falhar. Issue rastreada em **task #54** como "parcialmente resolvida — aguarda validação em produção" (ver [`backlog.md`](./backlog.md)). Se ainda falhar, reduzir `R2_CONCURRENCY` para 5 em `apps/mcp-server/src/pipeline/orchestrator.ts:82` e re-ingerir.
- **Worker timeout**: 30s para requisições síncronas, 15min para tarefas em `ctx.waitUntil`. O pipeline de ingestão é todo `waitUntil`, então não bate o limite. Análise de petição (Feature 1) também é assíncrona via background task.
- **D1 batch**: máximo 100 statements por `batch()`. O orquestrador respeita esse teto dividindo em `dispBatchSize = BATCH_SIZE/3`.
- **Workers AI**: limite diário de neurônios depende do plano. Free tier suficiente para demo; produção exige plano Workers Paid.
- **Vectorize**: 5M vetores e 50K queries/dia no free tier; suficiente para todas as três normas previstas.
- **MCP `tools/call`** devolve `isError: true` no envelope para erros de validação (não erro JSON-RPC) — clientes precisam checar esse campo. Ver [`api-mcp.md`](./api-mcp.md).

---

## 10. Acesso aos secrets

Os secrets do Worker MCP são geridos via `wrangler secret`:

| Secret | Uso |
|---|---|
| `GOOGLE_API_KEY` | Gemini (Flash + Pro) via Vercel AI SDK |
| `INGESTION_API_SECRET` | Autenticação Worker MCP → Container Python (header `X-Ingestion-Secret`) |

### Listar secrets configurados

```bash
NODE_OPTIONS=--use-system-ca wrangler secret list \
  --config apps/mcp-server/wrangler.toml
```

Devolve nomes, não valores.

### Rotar `GOOGLE_API_KEY`

1. Gerar nova key em https://aistudio.google.com/apikey.
2. Atualizar no Worker:
   ```bash
   NODE_OPTIONS=--use-system-ca wrangler secret put GOOGLE_API_KEY \
     --config apps/mcp-server/wrangler.toml
   ```
   (cola o novo valor quando solicitado).
3. Validar com qualquer tool que chame Gemini, ex.:
   ```bash
   curl -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"skill_identificar_relevantes","arguments":{"descricao_tarefa":"Verificar admissibilidade de pedido de reequilíbrio econômico-financeiro com base em fato superveniente"}}}'
   ```
4. Revogar a key antiga no Google AI Studio.

### Rotar `INGESTION_API_SECRET`

Procedimento idêntico, **em ambos os workers** (MCP e Container), com o **mesmo valor**:

```bash
NODE_OPTIONS=--use-system-ca wrangler secret put INGESTION_API_SECRET \
  --config apps/mcp-server/wrangler.toml
NODE_OPTIONS=--use-system-ca wrangler secret put INGESTION_API_SECRET \
  --config apps/ingestion-api/wrangler.toml
```

Em produção, dropar e recriar é instantâneo — o Worker passa a usar o novo valor no próximo isolate.

---

## Atalhos úteis

| Tarefa | Comando |
|---|---|
| Logs ao vivo do Worker MCP | `wrangler tail vectorgov-t-mcp --format pretty` |
| Logs do Container Python | `wrangler tail vectorgov-t-ingestion --format pretty` |
| Saúde rápida | `curl .../health` |
| Contagem de normas | `wrangler d1 execute vectorgov-t-db --remote --command "SELECT COUNT(*) FROM normas"` |
| Re-rodar golden set | `cd test/golden-set && node run-golden-set.mjs` |
| UI local | `pnpm -F @vectorgov-t/web-ui dev` |
| Worker local | `pnpm -F @vectorgov-t/mcp-server dev` |

Mais cenários de falha em [`troubleshooting.md`](./troubleshooting.md).
