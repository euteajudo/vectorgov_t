# Vectorgov_t — Relatório de Auditoria de Engenharia Ponta a Ponta

> **Documento 2 de 2.** Confronta o código real contra a régua definida em
> [`01-proposito-e-comportamento-esperado.md`](./01-proposito-e-comportamento-esperado.md).
> Data: 2026-05-29. Commit auditado: `f248ae9` (branch `main`).
>
> **Método.** (1) Execução real de `pnpm typecheck`, `pnpm test` e `next build`.
> (2) Auditoria estática multi-agente de 10 dimensões contra os critérios de
> aceitação CA-1..CA-33, com **verificação adversarial** de cada achado de
> severidade alta/crítica (um segundo agente tentou *refutar* cada um relendo o
> código). 28 agentes, ~1,7M tokens. Toda afirmação abaixo tem evidência
> `arquivo:linha`.

---

## 1. Veredito executivo

**O Vectorgov_t é um protótipo de engenharia sólido e honesto, mas NÃO está
"totalmente funcionando e cumprindo seu propósito" como produto de ponta a ponta.**

A distinção é importante e tem duas faces:

- **O motor funciona de verdade.** O cérebro do produto — o pipeline agêntico PEVS,
  os 8 agentes, e principalmente o **Auditor anti-alucinação** (o diferencial
  declarado) — é implementação real, não maquete, e está coberto por testes que
  inclusive provam que ele **rejeita uma citação inventada mesmo quando o LLM manda
  aprovar**. Typecheck limpo, 325 testes passando, build da UI ok.

- **O produto não está montado de ponta a ponta para o usuário-alvo.** Um analista
  **não consegue, pela interface, submeter uma petição e receber um veredito**: não
  existe tela de upload de petição nem endpoint REST para isso. A análise real só é
  alcançável indiretamente pelo chat de notebook. Além disso há **uma falha de
  segurança crítica** (superfície pública sem autenticação), a **norma central
  (LC 214) não está indexada** em produção, o **mecanismo de qualidade (golden set)
  está quebrado**, e **não há controle de custo**.

Em uma frase: **a capacidade central existe e é boa; o invólucro de produto, a
segurança e a operação ainda não.** É um "Fase 5 concluída" de engenharia interna,
não um "pronto para onboarding de usuários" (o que a própria F6 do backlog reconhece).

### Conformidade com a definição de propósito (P1–P5 da régua)

| # | Critério de propósito | Situação | Por quê |
|---|---|---|---|
| **P1** | Usuário submete PDF e recebe análise real (não mock) com citações verificadas pelo Auditor | ⚠️ **Parcial** | O motor roda de verdade (PEVS + Auditor reais, comprovados por teste), mas **só via chat de notebook**. Não há fluxo estruturado upload-de-petição→veredito na UI nem em REST. |
| **P2** | A partir da análise + decisão humana, gera parecer formal editável | ✅ **Sim** | `handleGerarParecer` chama o engine real (`executarFeature2`/Redator) ponta a ponta. Depende de P1 ter persistido a análise. |
| **P3** | Base de normas populada o suficiente para sustentar citações | ⚠️ **Parcial** | EC 132 indexada; **LC 214 (norma central) não está indexada** — falha provavelmente por OOM no container (ver ING-03). Parser funciona localmente. |
| **P4** | 13 tools MCP funcionam e respeitam o contrato | ✅ **Sim** | São **15** tools reais (13 esperadas + 2 fiscais), com Zod e envelope MCP. Divergência é de contagem/doc, não de função. |
| **P5** | Proteções ativas (rate limit, validação, anti-alucinação) e segredos protegidos | ⚠️ **Fraco** | Anti-alucinação: forte. Segredos: ok. **Mas a borda pública não tem autenticação** (crítico) e não há budget cap. |

---

## 2. Saúde de engenharia (executado, não inferido)

| Check | Comando | Resultado |
|---|---|---|
| Tipos | `pnpm -r typecheck` | ✅ **EXIT 0** — zero erros TS nos 6 pacotes |
| Testes TS (mcp-server) | `vitest run` | ✅ **291 testes / 33 arquivos** — todos passam |
| Testes TS (schemas) | `vitest run` | ✅ **25 testes** |
| Testes Python (parser) | `pytest` | ✅ **9 testes** (contra PDF real da EC 132) |
| Build da UI | `next build` | ✅ **EXIT 0** — 16 rotas compiladas |
| Testes da UI | — | ⚠️ **Nenhum** (web-ui e shared rodam `--passWithNoTests`) |

A doc dizia "208/208"; o número real subiu para **291** no mcp-server. A base de
testes é boa em quantidade e, mais importante, em *qualidade do que verifica*
(prompt-injection no Auditor, idempotência da ingestão, retry com backoff, custo por
modelo). A lacuna é a **ausência total de testes na UI** e o golden set quebrado (§4).

---

## 3. Veredito por dimensão

| # | Dimensão | Veredito | Síntese |
|---|---|---|---|
| 1 | MCP core (dispatcher + tools) | ⚠️ Parcial | Dispatcher e registro reais. São **15 tools, não 13**. Erro de input inconsistente entre lei (`isError`) e skill (`-32602`). |
| 2 | Tools semânticas/filesystem | ✅ OK | Busca híbrida **real** (embed→Vectorize+FTS5→RRF k=60→rerank). Ressalvas: filtro `tema` é no-op silencioso; anti-ReDoS parcial; testes usam D1 fake. |
| 3 | Agentes + PEVS + Auditor | ✅ OK | 8 roles reais, PEVS real com retry, **Auditor anti-alucinação genuíno e testado**. Ressalvas: comparação exata frágil (falsos REJEITADA), sem budget. |
| 4 | API REST + produto | ⚠️ Parcial | Feature 2 real ponta a ponta. **Feature 1 roda de verdade só via chat**; não há `POST /api/peticoes/upload`. Mocks estão mortos. |
| 5 | Web UI | ⚠️ Parcial | 12 rotas, build ok, bom tratamento de loading/erro. **Falta o fluxo de submissão de petição.** Telas admin de ingestão são mock; hash de auditoria é cosmético client-side. |
| 6 | Pipeline de ingestão | ⚠️ Parcial | Pipeline real, retry/concorrência=8 ok. **`purgeNorma` apaga a norma antiga antes de gravar a nova** → falha tardia destrói a fonte da verdade. |
| 7 | Parser Python | ⚠️ Parcial | Parser real e bom (parseia LC 214: 4336 disp. localmente). **Renderiza ~257 MB de imagens nunca usadas** (provável OOM da LC 214). 3 bugs de citação/sufixo. |
| 8 | Sistema de skills | ⚠️ Parcial | 10 skills válidas; tool MCP `skill_publicar` real. **Promoção via UI desabilitada (#52)**; REST `publicar` é inferior (sem validação/regeneração de _meta); sem leitura de `candidate`. |
| 9 | Golden set / observabilidade | ⚠️ Parcial | 5 casos completos; cost-tracker real. **Runner do golden set está quebrado** (aponta para endpoint inexistente). Budget cap sem enforcement. Não roda em CI. |
| 10 | Segurança e robustez | ⚠️ Parcial | Segredos ok; rate limit real. **Superfície pública inteira SEM autenticação + CORS `*`** (crítico). Container com secret fallback público. Anti-ReDoS contornável. |

---

## 4. Achados priorizados

Severidade após verificação adversarial (alguns foram *rebaixados* por um segundo
agente — sinalizado com `(corrigido de X)`).

### 🔴 CRÍTICO

**C1 — Superfície pública inteira sem autenticação + CORS `*`** · `CA-33` · *confirmado*
Qualquer pessoa na internet pode chamar todas as tools MCP, **gravar markdown
arbitrário no R2 de skills** (`POST /api/skills/:nome/publicar` está roteado e sem
auth — `index.ts:250-255`, `api/skills.ts:247-296`), **trocar a config de modelos de
todos os usuários** (`PUT /api/config/models` — `config.ts:46-69`) e disparar
ingestão/notebooks. O único freio é rate-limit por IP. Não há nenhum `Authorization`
em todo o `src` (grep confirmou). `corsHeaders()` devolve `Access-Control-Allow-Origin: *`
(`lib/security.ts:16-26`).
**Por que é o mais grave:** skills são *instruções carregadas pelos agentes* — escrever
nelas é **prompt-injection persistente**, que mina exatamente o diferencial
anti-alucinação do produto. Um sistema "auditável para órgãos de controle" não pode ter
escrita anônima no seu cérebro.
**Ação:** exigir token de aplicação nos endpoints de escrita (e idealmente em `/mcp/v1`);
trocar CORS `*` por allowlist da própria web-ui; no mínimo desligar o roteamento de
`handlePublicarSkill`/`handlePutModelos` até existir authz.

**C2 — Runner do golden set quebrado: qualidade jurídica não é medida** · `CA-27` · *confirmado*
`test/golden-set/run-golden-set.mjs:66` faz `POST ${WORKER_URL}/api/peticoes/upload` —
rota que **não existe** no Worker. Todos os 5 casos caem no `catch` como ERRO; o runner
não exercita nem o PEVS real nem o mock. **Não há nenhum mecanismo automatizado medindo
a qualidade do veredito jurídico hoje.**
**Ação:** reescrever o runner para chamar o caminho real (tool MCP de análise / `rodarAnalisePeticao`) **ou** implementar `POST /api/peticoes/upload` (ver A1). Depois, plugar no CI com gate de merge.

### 🟠 ALTO

**A1 — Não existe fluxo de submissão de petição (nem UI, nem REST)** · `CA-16`/`CA-18` · *confirmado* · (corrigido de crítico)
Não há rota `POST /api/peticoes/upload` no Worker, não há `/peticoes/nova` nem
`/peticoes` na UI, não há `uploadPeticao()` em `lib/api.ts`, não há item "Petições" no
sidebar. Restam **código fantasma**: docstring em `peticoes.ts:9-16`, tipo
`PeticaoUploadResponse` em `api.ts:117-135` e `PeticaoUploadMetadataSchema` em
`validation.ts` — todos sem consumidor. A análise real só nasce dentro do chat de
notebook (`conversational/engine.ts:421` → `rodarAnalisePeticao` → `executarFeature1`).
**Impacto:** o fluxo de produto que dá nome ao app não tem porta de entrada estruturada.
**Ação:** implementar `/peticoes/nova` + `uploadPeticao()` + `POST /api/peticoes/upload`
reusando `rodarAnalisePeticao` (a fonte única já existe — a integração ficou trivial com
o `GoogleLLMClient`). Isso também conserta C2.

**A2 — Re-ingestão com falha tardia destrói a norma vigente** · `CA-22` · *confirmado*
`runIngestionPipeline` chama `purgeNorma` (DELETE em D1 + Vectorize + R2) **antes** de
escrever a nova versão (`orchestrator.ts:566`, antes de markdown/embedding/vectorize/d1).
Como o `INSERT` no D1 é a última escrita e o `catch` só faz `markFailed` (sem rollback),
uma falha em embedding/Vectorize deixa a **norma anterior apagada e a nova incompleta**.
Para a base que alimenta o Auditor, perder a norma vigente é risco de coerência sério.
A doc (`operacao.md:134`) afirma que "re-ingerir é seguro" — não é, nesse cenário.
**Ação:** escrever em chaves temporárias e fazer *swap atômico* só após o D1 confirmar;
ou postergar o purge para depois do `insertD1`.

**A3 — Parser renderiza ~257 MB de imagens nunca consumidas (provável causa do OOM da LC 214)** · `ING-03` · *confirmado*
`pymupdf_extractor.py:83-87` renderiza **toda** página a 300 DPI para PNG+base64
(`image_png`/`image_base64`), resquício do parser VLM original — mas **nenhum
consumidor lê esses campos** (grep confirmou: só escrita). Em container `basic`
(1 vCPU / 1 GiB — `wrangler.toml:12`), o pico de RAM morta é forte candidato ao OOM que
faz a LC 214 (165 págs) falhar na ingestão. O parser em si parseia a LC 214 limpa
localmente (~33 s, 4336 dispositivos).
**Ação:** remover (ou tornar lazy/opcional) o render de imagem. Corta ~257 MB e dezenas
de segundos. Provavelmente destrava a indexação da LC 214 → conserta P3.

**A4 — Sem enforcement de budget cap** · `CA-29`/`CA-32` · *confirmado*
O `cost-tracker` mede custo de verdade, mas é só telemetria: nada soma o agregado
mensal nem corta execução ao atingir US$ 50 (`cost-tracker.ts:200-224`,
`pevs-engine.ts:414`). Uma petição patológica roda todos os retries (no teste, 29
chamadas LLM) sem freio. Combinado com C1 (sem auth), permite abuso de custo.
**Ação:** acumulador persistente (D1/KV mensal) + circuit breaker que recusa execução
ao estourar o teto (tornar o valor uma env var).

**A5 — Container Python com secret fallback público `dev-secret-change-me`** · `CA-30` · *confirmado*
`main.py:38` e o wrapper `apps/ingestion-api/src/index.ts:26-27` usam o default
`dev-secret-change-me` se `INGESTION_API_SECRET` não for setado. Se o operador esquecer,
`/parse` e `/parse-doc` (que rodam PyMuPDF sobre PDF arbitrário) ficam protegidos por um
segredo público conhecido. Comparação `!=` não é constant-time.
**Ação:** falhar (não usar default) se o secret não estiver setado; usar
`hmac.compare_digest`; idealmente expor o container só por service binding, não DNS público.

**A6 — `fs_grep` com regex de usuário: anti-ReDoS contornável + timeout que não cancela** · `CA-11`/`CA-32` · *confirmado*
A defesa é uma blacklist de 3 padrões (`(.*)+`, `(.+)+`, `(X+)+`) + deadline cooperativo
entre linhas. Mas `RegExp.test()` é síncrono e não-cancelável: um padrão catastrófico
fora da lista (ex.: `(a*)*$`) sobre texto longo trava o isolate (DoS de CPU). RE2-WASM,
previsto, não foi implementado (`fs-grep.ts:11-16`). Sem `.max()` no schema do padrão.
**Ação:** plugar RE2-WASM, ou desabilitar `regex=true` até lá; limitar tamanho de padrão e texto.

**A7 — REST de skills é inferior à tool MCP (a "mitigação via API" não é confiável)** · `CA-25` · *confirmado*
`handlePublicarSkill` (`api/skills.ts:247-296`) grava no R2 **sem** validar front-matter,
**sem** regenerar `_meta` (TODO na linha 284) e **sem** checar overwrite; os GETs
devolvem metadados placeholder. Como é a via que a UI usaria (já que a comparação está
desabilitada — #52), a mitigação documentada entrega dados não confiáveis.
**Ação:** fazer os handlers REST **delegarem às tools MCP** `skill_publicar`/`skill_carregar`/`skill_listar` (reuso, em vez de reimplementar).

### 🟡 MÉDIO (resumo)

- **M1 — 15 tools, não 13** (`CA-6`, corrigido de crítico): contagem diverge da doc; docstrings internas contraditórias (`server.ts:5` diz "13 (9 leis)"; `index.ts` diz "15" e "11"). Funciona; alinhar números.
- **M2 — Erro de input inconsistente** (`CA-7`, corrigido de alta): lei devolve `isError:true`, skill devolve `-32602`. Padronizar.
- **M3 — Filtro `tema` no-op silencioso** (`CA-9`): aceito no schema, ignorado na busca híbrida. Remover do schema ou implementar.
- **M4 — Telas admin de ingestão são mock** (`CA-18`): `ingestao-api.ts:132` retorna 2 normas hardcoded; reingerir/remover são `alert` no-op. **Mascara o estado real** (mostra LC 214 "vigente" quando falhou). Reusar a tool `fs_listar_normas` (já existe em `api.ts:241`).
- **M5 — Promoção de skills via UI desabilitada** (`CA-25`/#52, corrigido de alta): `PROMOCAO_HABILITADA=false`, candidate mockado client-side, A/B test é `setTimeout`+`alert`. Backend opera via MCP; falta `GET /api/skills/:nome/candidate`.
- **M6 — Hash de auditoria é cosmético na UI** (`CA-18`): recomputado client-side com hash não-criptográfico — passa falsa sensação de verificação. Backend deve enviar o SHA-256 real.
- **M7 — Comparação exata do Auditor pode rejeitar citações legítimas** (`CA-14`): texto do Pesquisador (FTS/preview) vs texto do Auditor (R2/D1) podem divergir byte-a-byte → falsos REJEITADA em produção. Os testes não pegam (usam o mesmo string nas duas tools).
- **M8 — `simularPipeline` na doc não existe no código** (`CA-27`, corrigido de alta): a doc é mais pessimista que o código aqui. Corrigir docs.
- **M9 — `reingestao` é dead code** (`CA-22`): flag validada no handler, nunca usada (sempre purga).
- **M10 — Modo async da ingestão pode ser cancelado** (`CA-20`): `waitUntil` sem Queue/Alarm; mitigado por `?sync=true` (workaround). 
- **M11 — Erro 500 vaza `err.message` bruto** (`CA-33`): contradiz o comentário que promete mensagem genérica.
- **M12 — Rate limit: race condition + balde `unknown`** (`CA-31`): KV não-transacional permite burst; clientes sem `CF-Connecting-IP` colapsam num balde só.
- **M13 — Testes das tools usam D1 fake que ignora binds** (`CA-10`): lógica de vigência/filtros não é validada por teste.
- **M14 — Bugs de citação no parser** (`ING-04`/`ING-05`): auto-referência rouba citações externas com sufixo; sufixo de artigo (337-E, 156-A — onipresentes na reforma) some do sumário.
- **M15 — DOs de notebook sem validação de formato de id** (`CA-33`): id não passa por allowlist regex (ao contrário de petições/skills).

### 🔵 BAIXO (resumo)
Validador de skills não roda em PR no CI (`CA-24`); `gerarParecerMock` é código morto; contagem de tokens heurística; WebSocket ecoa API key no subprotocol; Pydantic mais permissivo que Zod; filtro `_is_cabecalho` pode descartar texto em caixa-alta; exportações DOCX/PDF são placeholders honestos.

---

## 5. Pontos fortes (o que está genuinamente bom)

Não é só lista de problemas — o que funciona, funciona bem:

1. **Auditor anti-alucinação é real e robusto** (`agents/roles/auditor.ts`). Verificação
   determinística por hash/igualdade de texto, **independente e acima do LLM**, com teste
   de prompt-injection passando. É o coração do valor do produto e está sólido.
2. **Busca híbrida é de verdade** (`lib/hybrid-search.ts`): embed bge-m3 → Vectorize +
   FTS5/BM25 em paralelo → RRF (fórmula canônica k=60) → rerank cross-encoder. Sem atalhos.
3. **PEVS é genuinamente orquestrado** com paralelismo real, retry com feedback do
   Auditor e gates de qualidade (recusa parecer sobre análise inconclusiva).
4. **Telemetria de custo real e barata**: ~US$ 0,001–0,003 por análise nos testes — bem
   abaixo da meta de US$ 0,50.
5. **Higiene de segredos**: nada hardcoded, `.gitignore` correto, key Gemini por request.
6. **Parser Python competente**: parseia normas grandes com offsets canônicos determinísticos.
7. **Qualidade de testes**: 325 testes que verificam comportamento real, não só "compila".
8. **Documentação honesta**: o backlog já admitia a maioria das pendências (com a curiosa
   exceção do `simularPipeline`, onde a doc ficou *mais* pessimista que o código).

---

## 6. Plano de ação recomendado (ordem sugerida)

**Para "cumprir o propósito" como produto (mínimo viável):**
1. **C1** — autenticação na borda + CORS allowlist. *(bloqueia qualquer uso real; é pré-requisito de confiança)*
2. **A1** — implementar o fluxo de submissão de petição (UI + REST), reusando `rodarAnalisePeticao`. *(liga P1 ponta a ponta e, de quebra, conserta C2)*
3. **A3** — remover o render de imagens do parser → reingerir a **LC 214**. *(liga P3 — sem a norma central, as citações não têm sobre o que se apoiar)*
4. **C2** — consertar o golden set e colocá-lo no CI. *(passa a medir a qualidade jurídica)*

**Para operar com segurança e previsibilidade:**
5. **A4** — budget cap com enforcement. 6. **A5** — remover secret fallback do container.
7. **A2** — swap atômico na ingestão. 8. **A6** — RE2-WASM no `fs_grep`. 9. **A7** — REST de skills delegando à tool MCP.

**Higiene / consistência (rápidos):**
10. Alinhar a contagem de tools (M1) e a doc desatualizada (`simularPipeline`, `/api/peticoes/upload`).
11. Remover código fantasma (tipos/schemas de upload sem uso, `gerarParecerMock`).
12. Trocar mocks da UI admin por `fs_listar_normas` (M4) e o hash cosmético pelo real (M6).

---

## 8. Adendo — Recalibração de escopo (DEMO + chat-only) · 2026-05-30

> O dono do produto esclareceu, após a auditoria, que **(a) o app é um DEMO** (segue
> para desenvolvimento final só se o cliente aprovar) e **(b) o fluxo de upload de
> petição foi descontinuado — o canal oficial de interação é apenas o chat.** Esta
> seção recalibra os achados sob esse escopo. Os fatos técnicos das seções 1–7
> permanecem; o que muda é a **severidade** e o **veredito**.

### 8.1 Verificação adicional do fluxo de chat (feita nesta recalibração)

Confirmei, lendo o código, que o canal de chat **demonstra as duas features de ponta a
ponta com motor real**:

- **Feature 1 (análise) — 100% no chat.** O engine conversacional expõe as tools
  `extrair_peticao_do_documento` e `analisar_reequilibrio` (`conversational/engine.ts:278,310`).
  Esta última valida os dados, chama `rodarAnalisePeticao` → `PEVSEngine.executarFeature1`
  (PEVS + Auditor reais) e retorna `veredito`, `score_confianca`, `citacoes_aprovadas` e
  `peticao_id` (`engine.ts:421-435`). Persiste no SessionAgent.
- **Histórico real é o hub de navegação.** `GET /api/historico` lê do **SessionAgent store**
  ("onde TODA análise (chat ou outra) é persistida" — `api/historico.ts:36-44`), não de
  mock. A tabela linka cada análise para `/peticoes/[id]` (`historico/_table.tsx:235,240`)
  e mostra a coluna "Parecer".
- **Feature 2 (parecer) — real, via `/peticoes/[id]/parecer`** (`handleGerarParecer` →
  `executarFeature2`). Acionada a partir do histórico/tela de petição.

Fluxo navegável completo: **chat (analisa) → /historico → /peticoes/[id] → /parecer.**

### 8.2 Reclassificação dos achados sob o escopo de demo

| Achado | Severidade na auditoria | Sob escopo DEMO + chat-only |
|---|---|---|
| **C1** — borda pública sem autenticação | 🔴 Crítico | ⬇️ **Não-issue** — escopo consciente do demo. Reavaliar no dev final. |
| **A1** — sem fluxo de upload de petição | 🟠 Alto | ⬇️ **Não é gap** — feature descontinuada. Sobra só **higiene** (limpar código/doc fantasma). |
| **C2** — golden set runner quebrado | 🔴 Crítico | ⬇️ **Médio** — aponta para o endpoint descontinuado; precisa ser **reescrito para o caminho de chat** quando medir qualidade virar prioridade. Não bloqueia o demo. |
| **A4/A5/A6** — budget cap, secret do container, RE2 | 🟠 Alto | ⬇️ **Baixo (dev final)** — hardening de produção. |
| **A3** — LC 214 não indexada (render de imagens → OOM) | 🟠 Alto | ⬆️ **O mais importante do demo** (ver 8.3). |
| **M4** — telas admin de ingestão com dados mock | 🟡 Médio | ⬆️ **Alto para o demo** — mostram "LC 214 vigente/538 disp." mesmo sem indexar; risco de credibilidade se a tela for aberta na apresentação. |
| **M7** — Auditor compara texto por igualdade exata | 🟡 Médio | ⬆️ **Alto para o demo** — pode rejeitar citações legítimas ao vivo (busca ≠ leitura), derrubando um caso para "inconclusiva" inesperadamente. |
| **costura chat → parecer** (novo) | — | ⚠️ **Médio (UX do demo)** — o chat entrega o veredito mas não linka para a tela; o apresentador precisa ir ao `/historico`. Sem tool `gerar_parecer` no chat. |

### 8.3 O que realmente importa para o DEMO (ordem)

1. **Indexar a LC 214** (achado A3). É a norma central da reforma (IBS/CBS). Sem ela, o
   Pesquisador e o Auditor têm pouca base para os casos de reequilíbrio tributário — o
   coração do que o demo quer mostrar. Correção é curta: **remover o render de ~257 MB de
   imagens nunca usadas** do parser (`pymupdf_extractor.py:83-87`) destrava o OOM no
   container de 1 GiB. Sem essa norma, o demo arrisca dar "inconclusiva/diligência" nos
   casos mais interessantes.
2. **Robustez do Auditor ao vivo** (M7). Garantir que a citação que o Pesquisador propõe e
   o texto que o Auditor lê venham da **mesma fonte canônica** (ou comparar por hash do
   dispositivo do ingest), para não rejeitar citação verdadeira durante a demonstração.
3. **Polir a costura chat → parecer** (UX). Duas opções baratas: (a) o chat retornar um
   link clicável para `/peticoes/[id]`; ou (b) adicionar uma tool `gerar_parecer` ao chat.
   Aumenta muito a fluidez da história "conversei → vi o veredito → gerei o parecer".
4. **Trocar os mocks da tela admin de ingestão** (M4) por `fs_listar_normas` (já existe em
   `api.ts:241`), para não exibir estado falso na apresentação.
5. **Higiene** (rápida, opcional para o demo): remover código fantasma do upload
   descontinuado (`PeticaoUploadResponse`, `PeticaoUploadMetadataSchema`, docstring de
   `peticoes.ts:9-16`, `gerarParecerMock`) e atualizar a doc que cita `simularPipeline`
   (símbolo inexistente) e `/api/peticoes/upload`.

### 8.4 Veredito recalibrado

**Como DEMO de canal-de-chat, o Vectorgov_t cumpre o seu propósito.** O caminho que o
demo precisa mostrar — *conversar com o agente, ele analisar um pedido de reequilíbrio
com citações auditadas, e gerar um parecer formal* — **funciona com motor real e está
navegável** (chat → histórico → petição → parecer). O diferencial anti-alucinação é
genuíno e testado. Os "problemas críticos" do relatório original eram, em boa parte,
medidos contra uma régua de produto-final + fluxo-de-upload que não se aplica.

O único risco que pode **quebrar a narrativa do demo** é de **conteúdo, não de código**:
a **LC 214 não está indexada**, então os casos mais ilustrativos da reforma podem não ter
base normativa para o Auditor aprovar. Resolver A3 (e M7) é o que separa "o demo roda" de
"o demo impressiona".

---

## 7. Conclusão

O Vectorgov_t **prova a tese técnica mais difícil do produto** — análise jurídica
agêntica com anti-alucinação verificável — e tem engenharia limpa por baixo. Mas, medido
contra o próprio propósito declarado, **ainda não é um app "totalmente funcionando"**: o
usuário-alvo não tem por onde submeter uma petição pela interface, a porta de entrada
pública está sem tranca, a norma central não está indexada, e a qualidade não é medida.

São lacunas de **integração de produto, segurança e operação** — não de capacidade
central. A maior parte tem caminho de correção curto porque as peças certas já existem no
código (o motor real, a tool de análise, o parser, a tool MCP de skills); falta
**cabear, proteger e ligar ao CI**. Endereçando C1, A1, A3 e C2, o app cruza de
"protótipo que funciona por dentro" para "produto que cumpre o propósito por fora".
