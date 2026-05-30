# Vectorgov_t — Propósito e Comportamento Esperado

> **Documento 1 de 2 da auditoria de engenharia de software de ponta a ponta.**
> Data: 2026-05-29. Autor: análise técnica independente.
>
> Este documento define **o que o app deveria ser e fazer** — o seu propósito, as
> funcionalidades de produto, os fluxos esperados e os critérios de aceitação.
> Ele é a *régua*. O documento 2 (`02-relatorio-auditoria-e2e.md`) confronta o
> código real contra esta régua e emite o veredito de conformidade.
>
> A régua foi derivada da intenção declarada do produto (README, `docs/arquitetura.md`,
> `docs/backlog.md`, `docs/api-mcp.md`) e da estrutura real do repositório — **não** de
> suposições externas. Onde a documentação é ambígua, isso está marcado como tal.

> ## ⚠️ Nota de escopo (correção do dono do produto, 2026-05-30)
>
> Após a primeira versão desta régua, o dono do produto esclareceu dois pontos que
> **recalibram** a avaliação (ver o adendo na seção 8 do relatório `02-...`):
>
> 1. **O app é um DEMO**, não um produto final. Se o cliente aprovar, segue para o
>    desenvolvimento final. Logo, **ausência de autenticação não é defeito** — é escopo
>    consciente. Itens de hardening de produção (authz, budget cap, RE2, secrets do
>    container) são "desenvolvimento final", não bloqueadores do demo.
> 2. **O fluxo de upload de petição (PDF → análise via formulário/REST) foi
>    DESCONTINUADO.** A filosofia oficial de interação é **apenas a interface de chat**:
>    o usuário conversa com os agentes, que extraem a petição do documento, confirmam e
>    rodam a análise. Portanto a ausência de `POST /api/peticoes/upload` e de tela
>    `/peticoes/nova` **não é um gap** — é a decisão de produto. O que resta ali é só
>    **higiene** (remover código/doc fantasma do fluxo antigo).
>
> Os critérios CA-1..CA-33 abaixo permanecem válidos como inventário técnico, mas sua
> **severidade** deve ser lida sob esse escopo. A reclassificação está no relatório 02 §8.

---

## 1. Propósito

**Vectorgov_t** é uma ferramenta especializada do portfólio **VectorGov** para o domínio
de **direito administrativo e tributário brasileiro pós-Reforma Tributária**.

O problema que resolve: analisar **pedidos de reequilíbrio econômico-financeiro** em
contratos administrativos — situação em que um contratado pede revisão de preços por causa
de um fato superveniente (ex.: mudança tributária da EC 132/2023 + LC 214/2025 que altera a
carga de IBS/CBS sobre o objeto contratado) — e produzir **pareceres técnico-jurídicos
auditáveis** que um órgão de controle (TCU, CGU, controladoria interna) aceitaria.

O diferencial declarado é **anti-alucinação por design**: todo argumento jurídico e toda
citação de norma passam por um agente **Auditor** que confere a citação contra o **texto
literal da norma** armazenado no sistema. Sem fonte verificada, a citação é rejeitada.

### Para quem
- **Analista jurídico / procurador / controlador** de um órgão público que precisa instruir
  e decidir um pedido de reequilíbrio, com revisão humana obrigatória antes de aprovar.
- Secundariamente: qualquer operador do direito que queira **consultar a legislação
  tributária pós-reforma com citação verificável** (via tools MCP, inclusive dentro do
  Claude Code / Claude Desktop).

### Princípios declarados (de `arquitetura.md`)
1. **Anti-alucinação por design** — Auditor obrigatório sobre toda citação.
2. **Sempre revisão humana** — o analista revisa o parecer antes de aprovar.
3. **Rastreabilidade total** — cada citação carrega `hash` + `r2_path` da fonte.
4. **Skills dinâmicas** — comportamento dos agentes evolui sem novo deploy.
5. **Custo previsível** — meta de **< US$ 0,50 por petição completa**.

---

## 2. Features de produto esperadas

O sistema declara **duas features primárias** sobre uma base agêntica única, mais uma
**terceira feature em construção** e dois **subsistemas de suporte**.

### Feature 1 — Análise de petição
**Entrada:** PDF da petição de reequilíbrio.
**Saída esperada:** análise técnica estruturada com:
- extração dos fatos da petição;
- juízo de **admissibilidade** (legitimidade, prazo, prova mínima, enquadramento legal);
- verificação do **nexo de causalidade** entre o fato superveniente e o desequilíbrio;
- um **veredito** (ex.: procedente / improcedente / procedente parcial / falta documento /
  ambíguo — categorias presentes no golden set);
- **citações verificadas** pelo Auditor (cada uma com referência canônica à norma).

### Feature 2 — Geração de parecer
**Entrada:** a análise verificada + a **decisão do analista humano**.
**Saída esperada:** o **parecer formal** redigido em estrutura compatível com órgãos de
controle: relatório, fundamentação, conclusão, recomendações — **editável** pelo analista.

### Feature 3 — Chat estilo NotebookLM (em construção)
Upload de PDF arbitrário + conversa em linguagem natural com um orquestrador (Gemini Flash)
que invoca tools MCP, agentes especialistas e busca semântica **sobre o documento enviado**.
Declarada como "implementação completa pronta para revisão (PR aberto)", **ainda não
deployada** (falta deploy do Container `/parse-doc`, do Durable Object `NotebookAgent` e das
3 rotas de UI). Logo, a régua para esta feature é **"existe e está coerente em código",
não "está em produção"**.

### Subsistema A — Ingestão de normas
Pipeline que recebe um **PDF de norma** (lei, LC, EC, decreto), faz parsing estruturado
(LegisParser, em container Python), gera markdown por dispositivo + sumário + índice
canônico, calcula embeddings (bge-m3) e popula **Vectorize (vetorial)**, **D1 (relacional +
FTS5/BM25)** e **R2 (markdown das leis)**. É o que abastece todas as tools de consulta.

### Subsistema B — Sistema de skills
Skills em markdown (com front-matter YAML) que parametrizam o comportamento dos agentes.
Ciclo `candidate` → `active`, com meta-skill (índice) regenerada na publicação. Permite
iterar prompts/heurísticas **sem deploy**.

---

## 3. Arquitetura esperada (alvo)

Monorepo pnpm com três apps e três pacotes, sobre stack 100% Cloudflare serverless:

| Camada | Tecnologia esperada | Papel |
|---|---|---|
| `apps/mcp-server` | Cloudflare Worker (TypeScript) + Durable Objects | Cérebro: endpoint MCP (`/mcp/v1`), API REST (`/api/*`), 13 tools, 8 roles de agente, motor PEVS, pipeline de ingestão |
| `apps/web-ui` | Next.js 15 + Tailwind 4 + React Query, deploy via OpenNext em Workers | Interface: upload de petição, visualização da análise, editor de parecer, skills, ingestão (admin), histórico, notebooks |
| `apps/ingestion-api` | Container Cloudflare (Python + FastAPI + LegisParser) | Parser de PDFs sob demanda |
| `packages/schemas` | Zod (equivalente a Pydantic) | Contrato de tipos compartilhado entre Worker e UI |
| `packages/skills` | Markdown + YAML | Source of truth das skills |
| `packages/shared` | TS utilities | Utilidades comuns |
| `infra/d1-migrations` | SQL | Schema do D1 |

Recursos Cloudflare: **Vectorize** (bge-m3, 1024 dim, cosine, ~50K chunks projetados),
**R2** (leis + skills), **D1** (versões de dispositivos + FTS5), **KV** (cache),
**Workers AI** (embeddings + reranker), **Container** (parser).

### Padrão agêntico esperado — PEVS
Os agentes orquestram-se no padrão **Plan-Execute-Verify-Synthesize**:
- **PLAN** — o Orquestrador decompõe a tarefa em subtarefas.
- **EXECUTE** — agentes especialistas rodam em paralelo (Pesquisador, Analista Jurídico,
  Especialista de Licitações, Especialista de Reequilíbrio, Calculista).
- **VERIFY** — o **Auditor (Gemini 3 Pro)** confere cada citação contra o texto literal.
- **SYNTHESIZE** — o Redator monta a saída final.

São esperados **8 roles**: orquestrador, pesquisador, analista-juridico,
especialista-licitacoes, especialista-reequilibrio, calculista, auditor, redator.
*(Nota: o README diz "7 roles + motor"; o diagrama e o código listam 8 roles. A régua
adota 8.)*

### As 13 tools MCP esperadas (JSON-RPC 2.0 em `POST /mcp/v1`)
**Semânticas (4):** `buscar_legislacao` (híbrida dense+lexical+RRF+rerank),
`consultar_artigo` (lookup SQL por referência exata, versão vigente), `listar_artigos_por_tema`,
`comparar_redacoes` (diff entre versões).
**Filesystem (5):** `fs_listar_normas`, `fs_listar_estrutura`, `fs_ler_dispositivo`
(R2-first, fallback D1, paginado), `fs_ler_intervalo` (até 20 artigos), `fs_grep`
(FTS5/BM25 ou regex anti-ReDoS).
**Skills (4):** `skill_listar`, `skill_carregar`, `skill_identificar_relevantes`
(LLM com fallback heurístico), `skill_publicar`.

### Endpoints REST esperados (Worker)
- `POST /api/peticoes/upload` — recebe petição, dispara a análise (PEVS).
- `GET /api/peticoes/:id` — estado/resultado da análise.
- `/api/peticoes/:id/parecer` — geração/edição do parecer.
- `/api/skills/*` — listar/ler/publicar/comparar skills.
- `/ingestao/iniciar` (+ status) — dispara e acompanha ingestão de norma.
- `/api/notebooks/*` — chat NotebookLM (feature 3).
- `/api/historico`, `/api/config` — histórico de análises e configuração.
- `/health` — healthcheck.

### Proteções esperadas
- Rate limit **60 req/min/IP** + cota **500 req/dia/IP** (header `X-RateLimit-Scope`).
- Cache KV (TTLs: 6h normas, 1h grep, 5min skills index, 60s skill carregar, 24h análise).
- Validação **Zod** em todas as APIs REST.
- Budget cap **US$ 50/mês** (design; enforcement pode estar pendente).
- CORS aberto no endpoint MCP.

---

## 4. Fluxos esperados (end-to-end)

### Fluxo 1 — Análise de petição
```
UI: upload PDF  →  POST /api/peticoes/upload
   →  Container Python extrai texto/estrutura do PDF
   →  Extração estruturada dos fatos (peticao-extractor)
   →  PEVS: PLAN (orquestrador)
        →  EXECUTE paralelo (pesquisador busca normas; esp-reequilíbrio/licitações
            avaliam admissibilidade e nexo; calculista quantifica)
        →  VERIFY (auditor confere CADA citação contra texto literal no R2/D1)
        →  SYNTHESIZE (consolida análise técnica + veredito)
   →  persiste resultado (KV, TTL 24h)  →  UI exibe análise + citações verificadas
```
**Critério-chave:** nenhuma citação sem fonte verificada chega ao usuário.

### Fluxo 2 — Geração de parecer
```
Análise verificada + decisão do analista  →  PEVS por seção (relatório, fundamentação,
conclusão, recomendações)  →  VERIFY  →  parecer formal editável na UI
```

### Fluxo 3 — Ingestão de norma
```
UI admin: upload PDF da norma  →  /ingestao/iniciar
   →  parse (container)  →  markdown por dispositivo + sumário + canonical
   →  upload R2 (com retry/backoff)  →  embeddings bge-m3  →  upsert Vectorize
   →  popular D1 (dispositivos + versões + FTS5)  →  atualizar _index.json
   →  status acompanhável na UI (tracker de fases)
```

### Fluxo 4 — Consulta MCP (uso direto / Claude Code)
```
Cliente MCP  →  POST /mcp/v1 (tools/list | tools/call)  →  dispatcher valida (Zod)
   →  executa tool (Vectorize/D1/R2/KV)  →  resposta JSON-RPC com citação canônica
```

### Fluxo 5 — Ciclo de skills
```
Autor edita markdown  →  skill_publicar destino=candidate  →  (futuro: A/B 90/10)
   →  comparar candidate vs active na UI  →  promover  →  skill_publicar destino=active
   →  meta-skill (_meta.json) regenerado
```

---

## 5. Critérios de aceitação (o que será verificado na auditoria)

Cada item abaixo é uma afirmação verificável. O documento 2 marca cada um como
**✅ Cumpre / ⚠️ Parcial / ❌ Não cumpre / ❔ Não verificável estaticamente**, com evidência
(`arquivo:linha`).

### CA — Build, tipos e testes (saúde de engenharia)
1. `pnpm install` resolve o workspace sem erro.
2. `pnpm typecheck` passa em todos os pacotes (zero erros TS).
3. `pnpm test` passa (a doc declara 208/208 no mcp-server; verificar número real).
4. `pnpm build` (ou `pages:build`) gera artefato da UI sem erro.
5. Não há `node_modules`/segredos versionados indevidamente; `.env` fora do git.

### CA — Tools MCP (contrato)
6. Existem exatamente **13 tools** registradas e expostas em `tools/list`.
7. Cada tool valida input com Zod e retorna o envelope MCP correto (sucesso e `isError`).
8. Erros JSON-RPC usam os códigos corretos (`-32700/-32600/-32601/-32602/-32603`).
9. `buscar_legislacao` implementa de fato busca híbrida (dense + lexical + RRF + rerank).
10. `consultar_artigo` faz lookup SQL por versão vigente (`data_fim IS NULL`).
11. Tools de filesystem honram limites (20 artigos em `fs_ler_intervalo`, paginação em
    `fs_ler_dispositivo`, anti-ReDoS em `fs_grep`).

### CA — Agentes e PEVS
12. Existem os **8 roles** e cada um tem prompt + I/O schema.
13. O **motor PEVS** implementa PLAN→EXECUTE→VERIFY→SYNTHESIZE de fato (não stub).
14. O **Auditor** efetivamente lê o texto da norma e rejeita citação sem fonte
    (anti-alucinação real, não decorativa).
15. Há uma camada de LLM trocável (mock para teste, Google real para produção).

### CA — API REST e integração de produto
16. `POST /api/peticoes/upload` **dispara o PEVS real** — *ou*, se ainda usa mock
    (`simularPipeline`), isso está claramente identificado como gap conhecido. **Este é o
    ponto crítico do produto:** a feature 1 só "funciona de verdade" se a análise real rodar.
17. Geração de parecer (feature 2) está conectada ponta a ponta.
18. As rotas da UI consomem os endpoints corretos e tratam erros/carregamento.
19. Validação Zod aplicada em `peticoes.ts` e `skills.ts` (#53).

### CA — Ingestão
20. O pipeline de ingestão existe e cobre parse→R2→Vectorize→D1→índice.
21. O retry/backoff do R2 (#54) está aplicado nos 6 pontos de `put` e a concorrência é 8.
22. Estado real das normas: EC 132 indexada; LC 214 com falha conhecida; Decreto 12.955
    não iniciado — coerente com o que o código/infra permitem afirmar.

### CA — Skills
23. As **10 skills ativas** existem em `packages/skills/active/` com front-matter válido.
24. `validate-skills.mjs` passa sobre as skills do repo.
25. Promoção candidate→active via UI: estado real (a doc diz desabilitada por segurança,
    #52) — confirmar e avaliar se a mitigação (via API) funciona.

### CA — Qualidade / golden set / observabilidade
26. O golden set tem **5 casos** com gabarito e `run-golden-set.mjs` executável.
27. O golden set roda contra o pipeline real (ou está claro que ainda é manual/mock).
28. Telemetria de custo por análise (`TrackedLLMClient`/`cost-tracker`) existe e mede.
29. Enforcement do budget cap US$ 50/mês: existe ou é gap declarado.

### CA — Segurança e robustez
30. Segredos (`GOOGLE_API_KEY`, `CLOUDFLARE_API_TOKEN`) vêm de env/secrets, nunca no código.
31. Rate limit e cota implementados e testados.
32. Inputs não confiáveis (PDF, markdown de skill, query de regex) tratados com segurança
    (anti-ReDoS, validação de front-matter, limites de tamanho).
33. CORS e exposição de endpoints coerentes com o uso pretendido.

---

## 6. Definição de "cumpre o propósito"

O app **cumpre seu propósito** se, e somente se:

- **(P1)** Um usuário consegue submeter uma petição em PDF e receber uma análise técnica
  estruturada com veredito **produzida pelos agentes reais** (não mock), e essa análise só
  contém citações que o Auditor verificou contra o texto da norma. → *feature 1 real*.
- **(P2)** A partir da análise + decisão humana, o sistema gera um parecer formal editável.
  → *feature 2 real*.
- **(P3)** A base de normas está populada o suficiente para que as citações tenham sobre o
  que se apoiar (pelo menos uma norma central indexada e consultável pelas tools).
- **(P4)** As 13 tools MCP funcionam e respeitam o contrato, permitindo uso direto e por
  agentes.
- **(P5)** As proteções (rate limit, validação, anti-alucinação) estão ativas, e os
  segredos protegidos.

Um app que **passa em build/typecheck/test e tem a arquitetura toda montada**, mas em que a
**feature 1 ainda roda em mock** no endpoint de produção (P1 não satisfeito), está num
estado de **"protótipo funcional / arquitetura pronta, produto não ligado"** — que é
exatamente o que a documentação sugere. A auditoria vai confirmar ou refutar isso com
evidência de código, e medir a distância até cada `Pn`.

---

## 7. Itens que a documentação já admite como pendentes (a confirmar no código)

Estes não são "descobertas" — são o estado declarado, que a auditoria valida:
- Análise via UI usa **`simularPipeline`** (mock); PEVS não plugado no endpoint REST.
- **LC 214/2025** falhou na ingestão (rate limit R2); EC 132 ok; Decreto 12.955 não iniciado.
- Promoção de skills **candidate→active via UI desabilitada** (#52).
- Golden set roda **manualmente**, fora de CI.
- **Budget cap** sem enforcement real.
- Chat NotebookLM **não deployado**.
- Persistência de petições só em **KV (TTL 24h)**, sem tabela SQL.
- Ingestão assíncrona sem driver de background (UI bloqueia com `?sync=true`).
