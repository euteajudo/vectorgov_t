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
| F5 — Hardening + Demo | Tracks J (hardening), K (demo), L (docs) | **Em curso** |

---

## Fase 5 — Tracks em paralelo

### Track J — Hardening
- Owner: `feature/f5-hardening`.
- Escopo: validação de input (Zod nas APIs REST), segurança, rate-limit refinado, observability básica.
- Entregáveis: notas em `docs/hardening-notes.md`.
- Status: em curso.

### Track K — Demo
- Owner: `feature/f5-demo`.
- Escopo: roteiro de demonstração ponta a ponta, cheat sheet para apresentações.
- Entregáveis: `docs/demo-roteiro.md`, `docs/demo-cheatsheet.md`.
- Status: em curso.

### Track L — Documentação operacional (este worktree)
- Owner: `feature/f5-docs`.
- Escopo: documentação completa para operação, integração e extensão.
- Entregáveis: README atualizado, `docs/operacao.md`, `docs/api-mcp.md`, `docs/skills-guide.md`, `docs/deployment.md`, este `docs/backlog.md`.
- Status: **concluído nesta sprint**.

---

## Issues abertas

### #54 — LC 214/2025 falha de ingestão (P1)
**Sintoma:** pipeline trava em `fase=markdown` com warnings `r2_delete_warn` ou erros intermitentes no upload paralelo dos `.md` por dispositivo.

**Causa provável:** rate limit do R2 quando `R2_CONCURRENCY=20` em norma com 600+ dispositivos. Estoura subrequest budget ou Class A ops em rajada.

**Workaround atual:** reduzir `R2_CONCURRENCY` para 5 em `apps/mcp-server/src/pipeline/orchestrator.ts` e re-ingerir (purge idempotente cuida da limpeza prévia).

**Próximos passos:** instrumentar logs por batch de upload, considerar backoff exponencial, avaliar fila Cloudflare Queue para serializar.

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
2. **Service binding `INGESTION`** entre Worker MCP e Container Python. Evita roundtrip público e protege contra `1042 — Worker loop detection`. Ver [`deployment.md`](./deployment.md) §7.
3. **Plug do motor PEVS real** em `POST /api/peticoes/upload`. Hoje usa `simularPipeline` que avança as fases sem chamar agentes. TODO marcado em `apps/mcp-server/src/api/peticoes.ts`.
4. **Golden set no CI.** Hoje roda manualmente (`node test/golden-set/run-golden-set.mjs`). Adicionar GitHub Action que rode em PRs e bloqueie merge se quebrar veredito ou score.
5. **Dashboard de observability.** Centralizar métricas de uso de tools, latência por fase do PEVS, taxa de aprovação do Auditor, custo por petição.
6. **Routing A/B 90/10** para skills candidate. Hoje toda análise usa `active`. Ver [`skills-guide.md`](./skills-guide.md) §6.
7. **Histórico de versões de skills.** Mover automaticamente versão anterior para `archive/` quando promover nova `active`. Hoje é manual.
8. **Persistência de petições em D1.** Hoje vivem só no KV com TTL 24h (`peticao:<id>`). Migrar para tabela SQL quando volume justificar.
9. **Cota e budget cap operacionais.** O design prevê `Budget cap $50/mês` ([`arquitetura.md`](./arquitetura.md)) — falta enforcement real.
10. **Documentação de webhooks.** Não existem hoje; planejado para integrações com sistemas de protocolo (Pencil, SEI etc.).

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
