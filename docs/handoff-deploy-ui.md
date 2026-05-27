# Handoff — Retomada do deploy da UI

> Documento de contexto para uma nova sessão do Claude Code. Lendo isto,
> qualquer assistente (humano ou IA) consegue retomar exatamente de onde
> a sessão anterior parou — sem você precisar reexplicar nada.
>
> **Última atualização:** 2026-05-27 (Fase 5 concluída, deploy da UI pendente)

---

## 1. Mensagem pronta para colar no Claude Code

Quando reabrir o terminal **como Administrador** e iniciar nova sessão do Claude Code dentro de `D:\2026\vectorgov-t`, cole:

```
Continue o deploy da UI pra Cloudflare via OpenNext. Tudo configurado
em docs/handoff-deploy-ui.md e na task #56 — só falta rodar o build
(que estava falhando por EPERM symlink antes) e o deploy. Leia o handoff
para o contexto completo.
```

Isso é suficiente. O assistente vai ler este documento, ver o estado e
retomar exatamente do passo 4 da seção 5 abaixo.

---

## 2. Estado atual do produto

### O que JÁ ESTÁ deployado e funcionando

| Serviço | URL | Estado |
|---|---|---|
| Worker MCP | https://vectorgov-t-mcp.souzat19.workers.dev | Em produção. Tem o hardening do PR #16 (retry R2, telemetria custo, quota 500/dia). |
| Container Python parser | https://vectorgov-t-ingestion.souzat19.workers.dev | Em produção, `/health` ok. Trava em PDFs > 5MB (issue #55). |
| Vectorize, R2, D1, KV | (bindings Cloudflare) | Provisionados, em uso. |
| UI Web | http://localhost:3000 (só local) | **NÃO deployada ainda.** Esta é a tarefa pendente. |

### Normas indexadas no Vectorize hoje

| Norma | Dispositivos | Indexado em |
|---|---|---|
| EC 132/2023 | 376 | 2026-05-27 02:46 UTC |
| Decreto 10818/2021 | 31 | 2026-05-27 13:14 UTC (teste validando o pipeline) |

### MCP integration

Claude Code conecta no MCP em produção:
```bash
claude mcp add vectorgov-t https://vectorgov-t-mcp.souzat19.workers.dev/mcp
```
13 tools disponíveis (4 semânticas, 5 filesystem, 4 skills).

---

## 3. Fase 5 — concluída

| Track | PR | Status |
|---|---|---|
| F4 fix — MCP handshake + service binding + sync mode | #12 | merged |
| F4.4 — golden set de 5 petições | #13 | merged |
| F5.2 — roteiro e cheatsheet de demo | #14 | merged |
| F5.3 — suite operacional (~2.118 linhas de doc) | #15 | merged |
| F5.1 — hardening (retry R2 + telemetria custo + quota) | #16 | merged |
| F5.R hotfix — achados do Reviewer-Final | #17 | merged |

Branch atual: `main` em `a98a924`. Repositório `etaldev/vectorgov_t`.

---

## 4. Issues conhecidos (abertos)

### #54 — LC 214/2025 falha na ingestão (parcialmente resolvida)
PDF de 4336 dispositivos batia em R2 rate limit. F5.1 reduziu
`R2_CONCURRENCY` de 20 para 8 e adicionou `withR2Retry` (backoff
exponencial). Esperado concluir em ~6-8min agora — **não foi
revalidada em produção ainda**.

### #55 — Container Python timeout em /parse com PDF 5MB
PDF do decreto 12.955/2026 (5MB, ~165 páginas) trava o Container Python
no `/parse` por mais de 6min (timeout configurado em
`apps/mcp-server/src/pipeline/container-client.ts:30` = 360000ms).
Possíveis causas: PDF escaneado/com imagens, cold start, bug no
LegisParser, memory limit. **Workaround imediato:** usar PDF menor.

### #56 — Deploy da UI para Cloudflare Pages
**Esta é a tarefa em curso.** Detalhes na seção 5.

---

## 5. Tarefa pendente — deploy da UI

### Por que o caminho atual

Tentativas anteriores na ordem:
1. **Cloudflare Pages + `@cloudflare/next-on-pages`** → falhou:
   `spawn pnpm ENOENT` no Windows (patcheado), depois bug ESM no
   Vercel CLI 54.x, depois "Unable to find lambda" mesmo com `runtime = 'edge'`.
2. **Migração para `@opennextjs/cloudflare`** (sucessor moderno do
   next-on-pages) → falhou na criação de symlinks Next standalone:
   `EPERM: operation not permitted, symlink ...` (Windows bloqueia
   symlinks sem Developer Mode ou Admin).

Decisão atual: **continuar com OpenNext rodando terminal como
Administrador**. Stack continua 100% Cloudflare.

### O que já está configurado

| Arquivo | Conteúdo |
|---|---|
| `apps/web-ui/wrangler.toml` | name `vectorgov-t-web-ui`, main `.open-next/worker.js`, `compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]`, assets binding, vars `NEXT_PUBLIC_MCP_BASE_URL` e `NEXT_PUBLIC_MCP_WORKER_URL` apontando pro Worker MCP. |
| `apps/web-ui/open-next.config.ts` | `defineCloudflareConfig({})` (defaults). |
| `apps/web-ui/package.json` scripts | `pages:build` = `opennextjs-cloudflare build`, `pages:deploy`, `pages:preview`. |
| `apps/web-ui/.env.local` | duas vars apontando pra Worker MCP em produção (gitignored). |
| Reverts | Removidos os `export const runtime = "edge"` das 6 rotas dinâmicas que adicionei pro next-on-pages (OpenNext usa Node runtime). |

Dependências instaladas:
- `@opennextjs/cloudflare@^1.19.11`
- `wrangler@^4.94.0`

Dependências removidas:
- `@cloudflare/next-on-pages`
- `vercel`

### Passos exatos para concluir

**Após reabrir terminal como Administrador**, dentro de `D:\2026\vectorgov-t`:

**1. Confirme que o terminal é admin de fato:**
```bash
net session 1>nul 2>&1 && echo "ADMIN OK" || echo "NÃO É ADMIN"
```
Se retornar "NÃO É ADMIN", refaça abrindo Claude Code via clique-direito → "Executar como administrador".

**2. (Opcional, mais seguro) Habilite também o Developer Mode do Windows:**
Configurações → Sistema → Para desenvolvedores → Modo Desenvolvedor ON.
Não requer reboot.

**3. Limpe builds anteriores:**
```bash
cd D:\2026\vectorgov-t\apps\web-ui
rm -rf .next .open-next
```

**4. Build do OpenNext:**
```bash
cd D:\2026\vectorgov-t\apps\web-ui
NODE_OPTIONS=--use-system-ca \
NEXT_PUBLIC_MCP_BASE_URL=https://vectorgov-t-mcp.souzat19.workers.dev \
NEXT_PUBLIC_MCP_WORKER_URL=https://vectorgov-t-mcp.souzat19.workers.dev \
pnpm pages:build
```

Resultado esperado: pasta `.open-next/` com `worker.js` + `assets/`
preenchidos. Sem mais EPERM.

**5. Deploy:**
```bash
NODE_OPTIONS=--use-system-ca pnpm pages:deploy
```

Wrangler vai criar o Worker `vectorgov-t-web-ui` na conta Cloudflare
(account_id `a89dbdb0224cd8d2292cda8a038bc297`) e retornar a URL final:

```
https://vectorgov-t-web-ui.souzat19.workers.dev
```

**6. Smoke test pós-deploy:**
```bash
curl -sSk https://vectorgov-t-web-ui.souzat19.workers.dev/ -o /dev/null -w "home: HTTP %{http_code}\n"
curl -sSk https://vectorgov-t-web-ui.souzat19.workers.dev/admin/ingestao -o /dev/null -w "admin: HTTP %{http_code}\n"
```

Esperado: `HTTP 200` em ambos.

### Se o deploy falhar com bug específico

| Sintoma | Causa provável | Fix |
|---|---|---|
| Ainda EPERM symlink | Terminal não está admin | Refaça como admin de verdade (`net session` precisa funcionar) |
| Bindings faltando no wrangler deploy | wrangler.toml mal lido | Confira que `cd` está no `apps/web-ui` antes do deploy |
| Build trava no Tailwind | PostCSS plugin Tailwind 4 não acha config | Confira `postcss.config.mjs` e `app/globals.css` |
| 502 ao abrir URL pública | Worker subiu mas runtime erro | `wrangler tail vectorgov-t-web-ui --format pretty` pra ver |

---

## 6. Bugs que eu mesmo apliquei nesta sessão (que precisam fix definitivo)

### 6.1 Patch no `@cloudflare/next-on-pages` (REVERTIDO pelo uninstall)
Não tem mais relevância porque o pacote foi removido. Ignorar.

### 6.2 Hot fix do `?sync=true` no `ingestao-api.ts`
`apps/web-ui/src/lib/ingestao-api.ts` linha ~90 passa `?sync=true` ao
chamar `/ingestao/iniciar`. Necessário porque `ctx.waitUntil()` é
cancelado antes do Container Python responder.

**Trade-off:** UI fica em "Enviando..." sem progresso visual até o
pipeline inteiro terminar. Não mostra as fases parsing → markdown → etc.
em tempo real.

**Fix definitivo (futuro):** implementar Durable Object Alarms ou
Cloudflare Queue como background driver real, sem o limite do
`waitUntil`. Resolve a UX e remove a necessidade de `?sync=true`.
Listado como item 2 do backlog em `docs/backlog.md`.

### 6.3 Bug das env vars duplicadas (mitigado por `.env.local`)
- `apps/web-ui/src/lib/api.ts:21` usa `NEXT_PUBLIC_MCP_BASE_URL`
  (fallback pra produção — funciona).
- `apps/web-ui/src/lib/ingestao-api.ts:27` usa `NEXT_PUBLIC_MCP_WORKER_URL`
  (fallback pra `http://localhost:8787` — quebra sem env file).

`.env.local` da web-ui seta as duas pra produção. O wrangler.toml
também. Mas o fix definitivo é unificar a variável (chip de tarefa
foi spawnado durante a sessão).

### 6.4 Sidebar antiga apontava `/ingestao` (placeholder), corrigido para `/admin/ingestao`
`apps/web-ui/src/components/sidebar.tsx`. `/ingestao/page.tsx` virou
redirect pra `/admin/ingestao` (suporta bookmarks antigos).

### 6.5 Service binding INGESTION (já mergeado)
PR #12. `[[services]] binding = "INGESTION"` em
`apps/mcp-server/wrangler.toml`. Evita erro 1042 (Worker loop detection).

---

## 7. O que foi feito nesta sessão (resumo cronológico)

1. Fase 4 finalizada — fix MCP handshake + service binding + sync mode
   (PR #12).
2. Golden set de 5 petições commitado e mergeado (PR #13).
3. **Fase 5 disparada em 3 tracks paralelos (worktrees isolados):**
   - Track J (Hardening) → PR #16 mergeado. 4 commits, 208/208 testes.
     R2 retry, telemetria custo, quota diária.
   - Track K (Demo) → PR #14 mergeado. Roteiro 25-30min + cheatsheet.
     Corrigi paths inventados pelo agent.
   - Track L (Docs) → PR #15 mergeado. README + 4 docs novos (operacao,
     api-mcp, skills-guide, deployment) + backlog atualizado +
     troubleshooting estendido.
4. Reviewer-Final spawnado para revisão F5.R. Achou 1 P0 (workaround
   obsoleto pós #16) + 3 P1. Fix em PR #17 hotfix, mergeado.
5. Deploy do Worker MCP com hardening (`pnpm -F @vectorgov-t/mcp-server
   run deploy`). Version `2533ce31-a67b-402d-8d93-9751926e6d21`.
6. **UI local subiu** em http://localhost:3000 (Next.js dev server).
7. Bug `Failed to fetch` na tela de ingestão → `.env.local` criado +
   sidebar corrigido + redirect na rota antiga + `?sync=true` no upload.
8. **Ingestão validada end-to-end:** decreto 10818/2021 (3 páginas, 8
   artigos → 31 dispositivos) processado em <90s com sucesso.
9. Decreto 12.955/2026 (5MB) deu timeout no Container Python — issue #55
   aberto, não bloqueante.
10. **Iniciado deploy da UI no Cloudflare Pages** — esta a tarefa em
    curso (ver seção 5).

---

## 8. Comandos de diagnóstico rápido (para nova sessão)

Antes de qualquer coisa, valide que tudo segue como esperado:

```bash
# Worker MCP em produção (deve retornar {"status":"ok"})
curl -sSk https://vectorgov-t-mcp.souzat19.workers.dev/health

# Listar normas indexadas (deve mostrar EC 132 + decreto 10818)
curl -sSk -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fs_listar_normas","arguments":{}}}'

# Container Python health
curl -sSk https://vectorgov-t-ingestion.souzat19.workers.dev/health

# Git: deve estar em main, limpo, no commit a98a924 ou mais recente
cd D:\2026\vectorgov-t && git status && git log --oneline -3
```

---

## 9. Variáveis e secrets que VOCÊ NÃO PRECISA setar de novo

Já configurados em produção:

| Recurso | Onde |
|---|---|
| `GOOGLE_API_KEY` | secret do Worker MCP |
| `INGESTION_API_SECRET` | secret de ambos Workers (MCP + Container) |
| Account ID Cloudflare | `a89dbdb0224cd8d2292cda8a038bc297` |
| Subdomain workers.dev | `souzat19` |

---

## 10. Limpeza pós-deploy (opcional)

Quando o deploy da UI funcionar, considere:

- Remover o item de menu "Listagem" ou similar duplicado (se houver) em
  `apps/web-ui/src/components/sidebar.tsx`.
- Atualizar `docs/backlog.md` removendo "Deploy do frontend para
  Cloudflare Pages" do item 1 dos próximos itens.
- Atualizar `README.md` mudando "deploy Pages diferido" para a URL
  pública real.
- Atualizar `docs/deployment.md` §11 com instruções OpenNext em vez de
  Pages diretamente.
- Commit + PR pra fechar oficialmente a task #56.

---

## 11. Como navegar este projeto sem mim

| Quero | Vou ler |
|---|---|
| Visão geral | `README.md` |
| Arquitetura | `docs/arquitetura.md` |
| Operar dia-a-dia | `docs/operacao.md` |
| Lista das 13 tools MCP | `docs/api-mcp.md` |
| Como criar/editar skills | `docs/skills-guide.md` |
| Deploy from-scratch | `docs/deployment.md` |
| Roteiro de demo | `docs/demo-roteiro.md` |
| Cola de demo | `docs/demo-cheatsheet.md` |
| Status do hardening | `docs/hardening-notes.md` |
| Backlog atual | `docs/backlog.md` |
| Problemas comuns | `docs/troubleshooting.md` |
| Recursos Cloudflare | `docs/infra-status.md` |
| **Este handoff** | **`docs/handoff-deploy-ui.md`** |
