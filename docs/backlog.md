# Backlog — Vectorgov_t

Snapshot do estado real do projeto. Atualizado em 2026-05-27.

> Documento vivo. Para detalhes de **operação** ver [`operacao.md`](./operacao.md); para **arquitetura**, [`arquitetura.md`](./arquitetura.md); para **API**, [`api-mcp.md`](./api-mcp.md).

---

## Mapa das fases

| Fase | Escopo | Status |
|---|---|---|
| F0 — Setup | Conta, wrangler, monorepo, secrets, estrutura | Concluída |
| F1 — Infraestrutura | Vectorize, R2, D1, KV, Container, bindings | Concluída |
| F2 — Componentes core | Tools MCP, sistema de skills, parser, agentes | Concluída |
| F3 — Frontend | Next.js, rotas, integração API | Concluída (deploy Pages diferido) |
| F4 — Integração end-to-end | Pipeline orquestrador → tools → agentes; handshake MCP corrigido | Concluída |
| F5 — Hardening + Demo | Tracks J (hardening), K (demo), L (docs) | Concluída — review final aplicado |

---

## Fase 5 — Tracks em paralelo

### Track J — Hardening
- Owner: `feature/f5-hardening` (mergeada via PR #16).
- Escopo: R2 retry com backoff exponencial + concorrência reduzida (20→8); telemetria de custo por análise (`TrackedLLMClient` + log `analise_completa`); quota diária 500/IP além da janela de 60/min.
- Entregáveis: `apps/mcp-server/src/lib/retry.ts`, `apps/mcp-server/src/agents/cost-tracker.ts`, notas em `docs/hardening-notes.md`. 33 testes novos (208/208 passando).
- Status: **concluído nesta sprint**.

### Track K — Demo
- Owner: `feature/f5-demo` (mergeada via PR #14).
- Escopo: roteiro de demonstração ponta a ponta, cheat sheet para apresentações.
- Entregáveis: `docs/demo-roteiro.md`, `docs/demo-cheatsheet.md`.
- Status: **concluído nesta sprint**.

### Track L — Documentação operacional (este worktree)
- Owner: `feature/f5-docs`.
- Escopo: documentação completa para operação, integração e extensão.
- Entregáveis: README atualizado, `docs/operacao.md`, `docs/api-mcp.md`, `docs/skills-guide.md`, `docs/deployment.md`, este `docs/backlog.md`.
- Status: **concluído nesta sprint**.

---

## Issues abertas

### #54 — LC 214/2025 falha de ingestão (P1 — parcialmente resolvida)
**Sintoma original:** pipeline trava em `fase=markdown` com warnings `r2_delete_warn` ou erros intermitentes no upload paralelo dos `.md` por dispositivo (4336 dispositivos da LC 214 disparavam erro R2 10058).

**Causa raiz:** rate limit do R2 quando `R2_CONCURRENCY=20` em norma grande estoura subrequest budget e Class A ops em rajada.

**Mitigação aplicada (PR #16 / F5.1):**
- `R2_CONCURRENCY` reduzido de 20 para 8 em `apps/mcp-server/src/pipeline/orchestrator.ts:82`
- `withR2Retry` aplicado em todos os 6 pontos de put R2 (uploadMarkdowns, upsertVectorize, updateIndiceGlobal, uploadNormaArtefatos meta/sumario/canonical) com backoff exponencial 500ms × 2^n + jitter 0-200ms (até 4 retentativas, só erros transientes)
- Expectativa: LC 214 conclui em ~6-8min em vez de falhar

**Pendente:** validar em produção com re-ingestão real da LC 214. Se ainda falhar, reduzir `R2_CONCURRENCY` para 5 e/ou avaliar Cloudflare Queue para serializar.

### #53 — Validação Zod nas APIs REST (P0 — em verificação)
**Estado:** já implementada em `apps/mcp-server/src/api/validation.ts` e usada em `peticoes.ts` e `skills.ts`. Falta auditoria final.

### #52 — Promoção candidate→active via UI desabilitada (P0)
**Sintoma:** a tela `/skills/[nome]/comparar` desabilita o botão "Promover candidata" por segurança — o markdown candidate é gerado client-side e poderia sobrescrever a skill ativa com texto adulterado.

**Solução:** expor `GET /api/skills/:nome/candidate` que lê de `R2:candidate/<nome>.md` e usar essa fonte no diff. Detalhes inline em `apps/web-ui/src/app/skills/[nome]/comparar/_compare.tsx` (constante `PROMOCAO_HABILITADA`).

**Mitigação atual:** promoção via API (`skill_publicar destino=active sobrescrever=true`) funciona normalmente.

### Decreto 12.955/2025 — não iniciado
Não há PDF baixado, nem chamada de `/ingestao/iniciar` registrada. Próxima norma da fila depois que #54 estiver resolvido.

---

## Estado das normas indexadas

| Norma | Estado | Próxima ação |
|---|---|---|
| EC 132/2023 | Indexada | Validar metadata `tema` em chunks |
| LC 214/2025 | Ingestão falhou | Aplicar workaround do #54 |
| Decreto 12.955/2025 | Não iniciado | Aguarda LC 214 |

---

## Próximos itens (não bloqueados)

1. **Deploy do frontend para Cloudflare Pages.** Hoje só roda local. Detalhes em [`deployment.md`](./deployment.md) §12.
2. **Plug do motor PEVS real** em `POST /api/peticoes/upload`. Hoje usa `simularPipeline` que avança as fases sem chamar agentes. TODO marcado em `apps/mcp-server/src/api/peticoes.ts`.
3. **Golden set no CI.** Hoje roda manualmente (`node test/golden-set/run-golden-set.mjs`). Adicionar GitHub Action que rode em PRs e bloqueie merge se quebrar veredito ou score.
4. **Dashboard de observability.** Centralizar métricas de uso de tools, latência por fase do PEVS, taxa de aprovação do Auditor, custo por petição.
5. **Routing A/B 90/10** para skills candidate. Hoje toda análise usa `active`. Ver [`skills-guide.md`](./skills-guide.md) §6.
6. **Histórico de versões de skills.** Mover automaticamente versão anterior para `archive/` quando promover nova `active`. Hoje é manual.
7. **Persistência de petições em D1.** Hoje vivem só no KV com TTL 24h (`peticao:<id>`). Migrar para tabela SQL quando volume justificar.
8. **Cota e budget cap operacionais.** O design prevê `Budget cap $50/mês` ([`arquitetura.md`](./arquitetura.md)) — falta enforcement real.
9. **Documentação de webhooks.** Não existem hoje; planejado para integrações com sistemas de protocolo (Pencil, SEI etc.).

---

## Critérios de conclusão da Fase 5

- LC 214 indexada (issue #54 resolvida).
- Decreto 12.955 indexado.
- Frontend deployado em Pages com URL pública.
- Golden set verde em CI.
- Promoção de skills via UI reabilitada (#52).
- Demo ponta a ponta ensaiada com `docs/demo-roteiro.md`.
- Documentação consolidada (este worktree).

Saída da F5 abre a F6 — produção e onboarding de primeiros usuários.
