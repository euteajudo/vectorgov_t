# Planta — Máquina de Estados da Conversa (FSM)

> **Objetivo:** o Gemini conduz o usuário, passo a passo, do upload ao parecer
> final — mas **sem tomar decisões de processo**. O trilho é determinístico e
> tipado no backend; o LLM é só a camada de fluidez por cima.
>
> **Filosofia de trabalho (motor de F1):** código simples que funciona, sem
> firula, só o necessário. Sem auth / multi-tenant nesta fase. Otimizar para
> "funciona e impressiona no demo", não para durabilidade.

---

## 1. Princípio central

```
┌───────────────────────────────────────────────────────────────┐
│  BACKEND (determinístico, Zod)  →  conduz o Gemini             │
│  GEMINI (liberdade tática)      →  conduz o usuário            │
└───────────────────────────────────────────────────────────────┘
```

Três regras que tornam isso confiável (e não "o modelo às vezes esquece"):

1. **Estado derivado do real, nunca da memória do modelo.** A cada turno o
   backend lê o storage (tem documento? tem rascunho? tem análise? tem parecer?)
   e *calcula* o estado. O Gemini recebe isso pronto.
2. **Liberdade tática × trilho estratégico.** As tools de **consulta**
   (read-only) ficam sempre ligadas → o Gemini conversa livre. As tools de
   **transição** (que avançam o funil) são **gated por estado** → o trilho.
   Fora do estado certo, a tool **nem é exposta** ao modelo.
3. **A transição só dispara quando a guarda (código) passa.** "Produto da fase
   completo" é um predicado tipado, não a opinião do LLM. Quando passa, **só
   existe uma aresta de saída**.

> Se tirar o Gemini, o funil continua de pé: as mesmas tools/guardas rodam pela
> UI determinística. O Gemini é UX, não o motor.

---

## 2. Os estados — `EstadoConversa` (z.enum)

Todos **deriváveis do storage** (ver §5). Nada de flag que o modelo controle.

| # | Estado | Produto da fase (o que precisa existir p/ sair) | Guarda de entrada |
|---|---|---|---|
| S0 | `AGUARDANDO_DOCUMENTO` | — | `!meta.documento_nome` |
| S1 | `DOCUMENTO_RECEBIDO` | documento anexado e indexável | `documento_nome && !rascunho` |
| S2 | `PETICAO_EXTRAIDA` | dados da petição extraídos e **completos** | `rascunho && !analise_id` |
| S3 | `ANALISE_PRONTA` | veredito + citações auditadas | `analise_id && !parecer` |
| S4 | `PARECER_GERADO` | parecer formal I-V | `parecer existe` |

Dentro de **S2** há dois sub-casos (não são estados novos, só mudam a *ação
oferecida*), derivados da guarda `podeAnalisar(rascunho)`:
- **faltam dados** (valor do contrato ≤ 0, ou fato < 50 chars) → oferecer *corrigir*;
- **completo** → oferecer *analisar agora*.

---

## 3. Tabela de transições (a estrada)

| De | Gatilho (tool/ação) | Guarda (código) | Para |
|---|---|---|---|
| S0 | upload de PDF (UI já existe) | documento anexado no DO | **S1** |
| S1 | `extrair_peticao_do_documento` | rascunho salvo | **S2** |
| S2 | `analisar_reequilibrio` | `podeAnalisar(rascunho)` = true | **S3** |
| S2 | `extrair_peticao` / corrigir campo | — | **S2** (re-extrai) |
| S3 | `gerar_parecer` | `veredito !== "inconclusiva"` | **S4** |
| S3 | corrigir e reanalisar | usuário pede | **S2** (volta) ⟲ |
| S4 | — (fim) | — | — |

As **duas únicas arestas de retorno** (S3→S2 e S2→S2) cobrem "quero corrigir um
dado e refazer". Nada além disso — funil curto.

---

## 4. Gating de tools por estado

O `buildTools()` passa a receber o `estado` e **só inclui a tool de transição se
o estado permite**. As de consulta entram sempre.

| Categoria | Tools | Disponível em |
|---|---|---|
| **Consulta (liberdade)** | `buscar_legislacao`, `consultar_artigo`, `listar_artigos_por_tema`, `comparar_redacoes`, `fs_*`, `skill_listar/carregar/identificar`, `consultar_pesquisador`, `calcular_reequilibrio`, `buscar_no_documento`, `ler_documento_inteiro`, **`oferecer_opcoes`** | **sempre** |
| **Transição (trilho)** | `extrair_peticao_do_documento` | S1, S2 |
| | `analisar_reequilibrio` | **S2** (e só executa se `podeAnalisar`) |
| | `gerar_parecer` *(nova)* | **S3** (e só se veredito ≠ inconclusiva) |

> O gate é real: a tool ausente do mapa não pode ser chamada. O system prompt
> só *reforça*; quem proíbe é o código.

---

## 5. Como o estado é derivado — `derivarEstado()`

Função pura, sem LLM. Mora em `conversational/fsm.ts`.

```ts
async function derivarEstado(nb: NotebookAgent, env): Promise<EstadoConversa> {
  const meta = await nb.getMeta();
  if (!meta.documento_nome) return "AGUARDANDO_DOCUMENTO";        // S0
  const rascunho = await nb.lerRascunho();
  if (!rascunho) return "DOCUMENTO_RECEBIDO";                     // S1
  const analiseId = await nb.lerAnaliseId();   // ← coluna nova no notebook
  if (!analiseId) return "PETICAO_EXTRAIDA";                     // S2
  const parecer = await session(env).carregarParecerPorAnalise(analiseId);
  return parecer ? "PARECER_GERADO" : "ANALISE_PRONTA";          // S4 : S3
}
```

Pequeno acréscimo de storage no `NotebookAgent` (só o necessário):
- coluna `analise_id TEXT` e `veredito TEXT` na tabela `notebook`;
- métodos `salvarAnaliseId(id, veredito)` e `lerAnaliseId()`.

`analisar_reequilibrio` passa a chamar `nb.salvarAnaliseId(peticao_id, veredito)`
logo após persistir a análise — é o que "fecha" S2→S3.

---

## 6. Tools novas

### `oferecer_opcoes` (apresenta os chips clicáveis)
```ts
input: {
  titulo: string,                 // ex.: "O que você quer fazer agora?"
  opcoes: { rotulo: string, dica?: string }[]   // 1..4
}
// retorno: as próprias opções (o frontend renderiza como botões;
// clicar manda `rotulo` como user_message)
```

### `gerar_parecer` (fecha o ciclo dentro do chat)
```ts
input: {}   // sem args — usa a análise corrente do notebook
// guarda: estado === ANALISE_PRONTA && veredito !== inconclusiva
// efeito: roda PEVS executarFeature2 (real) e persiste o parecer
// retorno: { parecer_id, peticao_id, link: "/peticoes/<id>/parecer" }
```

---

## 7. System prompt dinâmico (injetado a cada turno)

Além do prompt-base, o backend injeta um bloco gerado por código:

```
[ESTADO DA CONVERSA]
Fase atual: PETICAO_EXTRAIDA
Produto desta fase: dados da petição confirmados e completos
Próxima fase: ANALISE_PRONTA (rodar a análise)
Ações permitidas agora: corrigir dados | analisar agora
Pendências para avançar: informar o valor do contrato

Conduza o usuário à próxima fase. Você pode conversar livremente
(tirar dúvidas, explicar normas), mas ao fim de cada resposta ofereça
as próximas ações com `oferecer_opcoes`. Só avança de fase quando o
produto da fase atual estiver completo.
```

O texto é montado a partir do `estado` + `podeAnalisar` + `veredito` — tudo
determinístico.

---

## 8. Frontend (`notebook-chat.tsx`)

Reusa o stream de tool calls que já existe — sem novo tipo de evento:

- **`oferecer_opcoes`** → renderiza os `opcoes[]` como **chips/botões**. Clique →
  `socket.send({ type: "user_message", text: rotulo })`.
- **resultado de `analisar_reequilibrio`** (tem `peticao_id` + `veredito`) →
  **card**: "Veredito: …" + botões **Ver análise** (`/peticoes/<id>`) e
  **Gerar parecer**.
- **resultado de `gerar_parecer`** → **card** "Parecer gerado" + botão **Abrir
  parecer** (`/peticoes/<id>/parecer`).

Os tool calls de consulta continuam como bloco colapsável (como hoje).

---

## 9. Arquivos a tocar (mapa de impacto)

| Arquivo | Mudança |
|---|---|
| `packages/schemas/src/notebook.ts` | `EstadoConversaSchema` (z.enum), `OpcaoChipSchema`, contrato de `oferecer_opcoes`/`gerar_parecer` |
| `apps/mcp-server/src/agents/conversational/fsm.ts` *(novo)* | `derivarEstado`, `podeAnalisar`, gating de tools, montagem do bloco de estado do prompt |
| `apps/mcp-server/src/agents/conversational/engine.ts` | `buildTools(estado)` com gating; system prompt + bloco de estado; tools `oferecer_opcoes` e `gerar_parecer` |
| `apps/mcp-server/src/agents/notebook-agent.ts` | coluna `analise_id`/`veredito`; `salvarAnaliseId`/`lerAnaliseId`; deriva estado e passa ao `conversar` |
| `apps/mcp-server/src/agents/run-analise.ts` / tool `analisar_reequilibrio` | salvar `analise_id` no notebook após análise |
| `apps/web-ui/src/components/notebook-chat.tsx` | chips clicáveis + cards de ação/link |

---

## 10. Ordem de execução (To-do)

1. **Tipos da FSM** — `EstadoConversa`, `OpcaoChip`, contratos das tools novas (Zod).
2. **`fsm.ts`** — `derivarEstado` + `podeAnalisar` + gating + bloco de estado do prompt.
3. **`NotebookAgent`** — coluna `analise_id`/`veredito` + métodos; derivar estado e passar ao `conversar`.
4. **`engine.ts`** — `buildTools(estado)` com gating; system prompt dinâmico; tools `oferecer_opcoes` + `gerar_parecer`.
5. **`analisar_reequilibrio`** — salvar `analise_id` no notebook (fecha S2→S3).
6. **Frontend** — chips clicáveis + cards (ver análise / gerar parecer).
7. **Testes mínimos + deploy** — `derivarEstado` (cada estado) e gating; deploy `vectorgov-t-mcp` + UI.

> Cada item é pequeno e testável isoladamente. A FSM em si (`fsm.ts`) é a peça de
> maior valor e a mais fácil de cobrir com teste puro (input storage → estado).
