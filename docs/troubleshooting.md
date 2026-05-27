# Troubleshooting — Vectorgov_t

## Erro TLS no Windows: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**Sintoma:** Wrangler ou npm/pnpm falham com erro de certificado SSL.

**Causa:** Antivírus (Kaspersky, ESET, BitDefender, etc.) intercepta conexões TLS para inspeção, mas o Node 22+ não confia automaticamente no certificado raiz injetado pelo antivírus.

**Solução permanente:**
1. O `.npmrc` do projeto já contém `use-system-ca=true` (resolve pnpm/npm)
2. Para wrangler e scripts Node, use: `NODE_OPTIONS=--use-system-ca <comando>`
3. Adicione ao seu `~/.bashrc` ou `~/.zshrc`:
   ```bash
   export NODE_OPTIONS=--use-system-ca
   ```

**Validação:**
```bash
NODE_OPTIONS=--use-system-ca wrangler whoami
```
deve retornar email + account ID.

---

## Worker MCP retorna 429 (Too Many Requests)

**Sintoma:** chamadas a `/mcp/v1` ou `/api/*` começam a falhar com 429 após várias requisições rápidas do mesmo IP.

**Causa:** rate limit de 60 req/min/IP implementado em `apps/mcp-server/src/lib/rate-limit.ts`.

**Solução curta:** esperar 60 s. Em desenvolvimento, considere distribuir testes ao longo do tempo.

**Solução longa:** ajustar limite em `rate-limit.ts` se o caso de uso legítimo exigir mais. Cuidado: o limite existe para conter abuso e proteger budget cap.

---

## `INGESTION_API_SECRET não configurado no Worker`

**Sintoma:** `POST /ingestao/iniciar` falha imediatamente; logs do Worker mostram esta mensagem.

**Causa:** secret não foi feito `put` no Worker MCP (ver [`deployment.md`](./deployment.md) §8).

**Solução:**
```bash
NODE_OPTIONS=--use-system-ca wrangler secret put INGESTION_API_SECRET \
  --config apps/mcp-server/wrangler.toml
```

E confira que o **mesmo valor** está no Container:
```bash
NODE_OPTIONS=--use-system-ca wrangler secret put INGESTION_API_SECRET \
  --config apps/ingestion-api/wrangler.toml
```

---

## Container Python retorna 502

**Sintoma:** ingestão falha em `fase=parsing` com `ContainerParseError: 502`.

**Causas possíveis:**

1. **Cold start.** Containers Cloudflare têm latência inicial alta após período inativo. Repetir após 30 s.
2. **PDF corrompido.** O parser pode falhar em PDFs digitalizados sem OCR. Confirme abrindo o PDF em outro leitor.
3. **OOM.** Container `basic` (1 GiB RAM) pode estourar memória em PDFs > 200 páginas. Considere subir `instance_type` em `apps/ingestion-api/wrangler.toml` para `standard`.

**Diagnóstico:**
```bash
NODE_OPTIONS=--use-system-ca wrangler tail vectorgov-t-ingestion --format pretty
```

---

## Ingestão trava em `fase=embedding` com `processados < total`

**Causa provável:** quota diária de Workers AI esgotada (neurônios). O free tier reseta às 00:00 UTC.

**Solução:**
- Aguardar reset (até 24h).
- Upgradear para Workers Paid (cota maior).
- Reduzir `BATCH_SIZE` em `apps/mcp-server/src/pipeline/orchestrator.ts` para distribuir consumo.

Re-ingerir a norma após reset — o purge idempotente cuida da limpeza prévia.

---

## Ingestão de norma grande falha com `r2_delete_warn`

**Sintoma:** logs com `event: r2_delete_warn` ou `event: pipeline_failed` durante upload paralelo dos `.md` por dispositivo.

**Causa:** rate limit do R2 (Class A operations) quando `R2_CONCURRENCY=20` em norma com 4000+ dispositivos. Issue rastreada como **task #54** no [`backlog.md`](./backlog.md).

**Workaround:**
1. Reduzir `R2_CONCURRENCY` em `apps/mcp-server/src/pipeline/orchestrator.ts` de 20 para 5.
2. Redeploy do Worker MCP.
3. Re-ingerir a norma.

---

## `Tool not found` ao chamar `tools/call`

**Sintoma:** JSON-RPC retorna erro `-32601 Tool not found: <name>`.

**Causa:** nome da tool digitado errado (ex.: `buscar-legislacao` em vez de `buscar_legislacao`). Convenção é `snake_case`.

**Solução:** listar nomes canônicos:
```bash
curl -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

Referência completa em [`api-mcp.md`](./api-mcp.md).

---

## `Skill 'xxx' não encontrada no R2`

**Sintoma:** `skill_carregar` retorna erro `-32603` com essa mensagem.

**Causas:**

1. Skill não foi publicada (sem `skill_publicar` ainda).
2. Nome digitado errado (case-sensitive).
3. Skill está em `candidate/` em vez de `active/` (`skill_carregar` lê apenas `active/`).

**Solução:** confirmar com `skill_listar` se aparece na meta-skill. Se não aparecer, publicar com `skill_publicar destino=active`. Detalhes em [`skills-guide.md`](./skills-guide.md).

---

## UI mostra "Petição não encontrada" mas eu acabei de criar

**Causa:** o registro KV expira em 24h (`KV_TTL_SECONDS`). Se você está vendo um link antigo, o TTL passou.

**Solução:** recriar a petição (upload novamente). Persistência permanente está planejada via D1 — ver item 8 do [`backlog.md`](./backlog.md).

---

## Análise nunca sai de `queued` ou avança muito rápido

**Causa:** o endpoint `/api/peticoes/upload` em produção hoje usa **`simularPipeline`** — um mock que avança as fases sem chamar agentes reais. A integração com o motor PEVS está marcada como TODO em `apps/mcp-server/src/api/peticoes.ts`.

**Estado:** comportamento esperado nesta fase do produto. Análise real ocorre via chamadas MCP diretas pelo Claude Code, não pela UI.

**Plano:** ver item 3 do [`backlog.md`](./backlog.md).

---

## Erro CORS no browser ao chamar o Worker MCP

**Sintoma:** browser console mostra `Access-Control-Allow-Origin` ausente.

**Causa típica:** o Worker já responde com `Access-Control-Allow-Origin: *` (via `withSecurity` em `apps/mcp-server/src/lib/security.ts`). Se o erro aparece, normalmente é cache antigo do browser.

**Solução:**
- Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`).
- Limpar cache do site.
- Confirmar que a request usa POST e Content-Type `application/json`.
