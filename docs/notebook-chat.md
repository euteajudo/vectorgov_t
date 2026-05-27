# Chat NotebookLM — vectorgov-t

Terceira feature de produto do vectorgov-t: upload de PDF arbitrário + conversa em linguagem natural com um orquestrador LLM que pode invocar 12 tools MCP read-only, agentes especialistas (Pesquisador, Calculista) e ferramentas próprias do notebook (busca semântica nos chunks do documento, leitura do documento inteiro).

Modelagem em uma frase: **um documento + uma conversa = um Durable Object**.

---

## Arquitetura

```
+------------------------------------------------------+
| Web-UI (Next.js)                                     |
|  /notebooks            (lista)                       |
|  /notebooks/nova       (upload PDF -> cria DO)       |
|  /notebooks/[id]       (chat com streaming)          |
+----------------------+-------------------------------+
                       | HTTPS + WebSocket
+----------------------v-------------------------------+
| Worker MCP                                           |
|  /api/notebooks                  POST   criar        |
|  /api/notebooks                  GET    listar       |
|  /api/notebooks/:id              GET    metadata     |
|  /api/notebooks/:id/upload       POST   PDF -> doc   |
|  /api/notebooks/:id/mensagens    GET    histórico    |
|  /api/notebooks/:id/chat         GET    Upgrade WS   |
|                                                      |
|  ConversationalEngine (apps/.../conversational/)     |
|   - GoogleLLMClient (gemini-3.5-flash thinking minimal) |
|   - Tools: 12 MCP + 2 agentes + 2 notebook           |
|   - Loop tool-call gerenciado pelo Vercel AI SDK     |
|                                                      |
+----------+----------------+----------+---------------+
           |                |          |
           v                v          v
  DurableObject       Container    Workers AI
  NotebookAgent       Python       bge-m3 emb.
   - SQL storage       /parse-doc  (chunk emb on-demand)
   - doc + chunks       (PyMuPDF)
   - mensagens
   - WebSocket handler
```

---

## Componentes principais

### Backend

| Arquivo | Função |
|---|---|
| `apps/mcp-server/src/agents/llm/google.ts` | `GoogleLLMClient` — implementação real do `LLMClient` com `generateObject` (structured) + `streamText` (free-form + tool calling). Vercel AI SDK 5 + `@ai-sdk/google` 2. Flash com `thinkingLevel: "minimal"`. |
| `apps/mcp-server/src/agents/notebook-agent.ts` | Durable Object. SQL storage com tabelas `notebook`, `pagina`, `chunk` (com embedding opcional), `mensagem`. Métodos: `criar`, `anexarDocumento`, `registrarMensagem`, `listarMensagens`, `buscarChunks` (gera embedding on-demand), `lerDocumentoInteiro`. Handler `fetch` com roteamento + WebSocket upgrade. |
| `apps/mcp-server/src/agents/conversational/engine.ts` | `conversar()` — loop principal. Monta tools (12 MCP + 2 agentes + 2 notebook), chama `llm.streamText`, faz proxy de eventos pro WebSocket callback, retorna texto final + tool calls. |
| `apps/mcp-server/src/api/notebooks.ts` | Handlers REST. Cada notebook = 1 DO instanciado via `env.NOTEBOOK_AGENT.idFromName(id)`. Índice global de notebooks em KV com prefix `notebook-idx:`. |
| `apps/ingestion-api/main.py` | Adicionado endpoint `POST /parse-doc` com PyMuPDF — aceita PDF arbitrário, devolve `{pages: [{n, text}], total_pages, total_chars, pdf_hash}`. Sem LegisParser. |
| `packages/schemas/src/notebook.ts` | Schemas Zod: `NotebookMeta`, `Mensagem`, `ToolCall`, `ChatEvent` (server → client), `ChatClientEvent` (client → server). |

### Frontend

| Arquivo | Função |
|---|---|
| `apps/web-ui/src/lib/notebooks-api.ts` | Cliente HTTP (`criarNotebook`, `uploadDocumento`, `listarMensagens`, `getNotebook`, `listarNotebooks`) + WebSocket helper `abrirChatSocket`. |
| `apps/web-ui/src/app/notebooks/page.tsx` | Lista de notebooks (cards). |
| `apps/web-ui/src/app/notebooks/nova/page.tsx` | Upload PDF + criar notebook → redireciona. |
| `apps/web-ui/src/app/notebooks/[id]/page.tsx` | Loader de metadata + render do componente `NotebookChat`. |
| `apps/web-ui/src/components/notebook-chat.tsx` | UI principal: histórico, streaming, tool call collapse, input fixo. |
| `apps/web-ui/src/components/sidebar.tsx` | Atualizado — item "Conversas" com ícone `MessageSquare`. |

---

## Tools disponíveis ao orquestrador

Total: **16 tools**.

### 12 MCP read-only (re-exposed via tool calling)

`buscar_legislacao`, `consultar_artigo`, `listar_artigos_por_tema`, `comparar_redacoes`, `fs_listar_normas`, `fs_listar_estrutura`, `fs_grep`, `fs_ler_dispositivo`, `fs_ler_intervalo`, `skill_listar`, `skill_carregar`, `skill_identificar_relevantes`.

`skill_publicar` fica fora do chat de propósito: é uma tool mutável que grava em R2 e pode alterar skills ativas.

Loop interno: `engine.ts:buildTools()` cria tools a partir de `MCP_TOOLS` (leis/filesystem) e do registry de skills read-only, aceitando tanto JSON Schema quanto Zod.

### 2 agentes especialistas

| Tool | Wraps | Quando usar |
|---|---|---|
| `consultar_pesquisador` | `criarPesquisador()` | Coletar trechos de normas com fonte exata. Devolve achados com `texto_literal` + `fonte`. |
| `calcular_reequilibrio` | `criarCalculista()` | Cálculos placeholder (Fase 2). Aceita descrição livre. |

Auditor, Redator, Analista, Esp-Reequilíbrio, Esp-Licitações **não** estão expostos — esses agentes dependem de inputs estruturados vindos do PEVS engine (e.g., resultado do Pesquisador) e não fazem sentido em chat livre.

### 2 tools próprias do notebook

| Tool | Função |
|---|---|
| `buscar_no_documento({query, top_k?})` | Busca semântica nos chunks do PDF do notebook. Gera embeddings on-demand na primeira busca (~500ms a mais). |
| `ler_documento_inteiro({max_chars?})` | Concatena todas as páginas (default truncado em 100k chars). Útil quando o documento é curto. |

---

## Fluxo de uma conversa

1. **Mount da página `/notebooks/[id]`**:
   - GET metadata via `getNotebook(id)`.
   - GET histórico via `listarMensagens(id)`.
   - Abre WebSocket via `abrirChatSocket(id, handleEvent)`.

2. **Usuário digita e envia**:
   - Client adiciona a mensagem do usuário localmente (otimismo).
   - `socket.send({type: "user_message", text})`.

3. **DO recebe `user_message`**:
   - Persiste mensagem do user no SQL storage.
   - Cria `GoogleLLMClient` a partir do `env`.
   - Chama `conversar({env, llm, notebook, userText, onEvent})`.

4. **Engine streamText**:
   - Carrega histórico do DO.
   - Monta system prompt com info do documento.
   - Define 16 tools.
   - Chama `llm.streamText` com `stopWhen: stepCountIs(8)`.

5. **Para cada evento do stream**:
   - `text-delta` → WS `{type: "token", text}` → UI concatena.
   - `tool-call` → WS `{type: "tool_call", call_id, name, args}` → UI mostra bloco colapsável.
   - `tool-result` → WS `{type: "tool_result", call_id, result, is_error}` → UI atualiza bloco.
   - `finish` → engine acumula usage.

6. **Engine finaliza**:
   - DO persiste mensagem do assistant com tool_calls.
   - WS `{type: "done", message_id, tokens, finish_reason}` → UI move mensagem do stream pro histórico.

---

## Persistência

**Durable Object SQL storage** (cada notebook tem o seu — completamente isolado):

```sql
CREATE TABLE notebook (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  documento_nome TEXT,
  documento_total_paginas INTEGER,
  documento_total_chars INTEGER,
  documento_pdf_hash TEXT,
  criado_em INTEGER,
  atualizado_em INTEGER
);
CREATE TABLE pagina (
  notebook_id, n, texto,
  PRIMARY KEY (notebook_id, n)
);
CREATE TABLE chunk (
  id PK, notebook_id, texto, pagina_inicio, pagina_fim, embedding BLOB
);
CREATE TABLE mensagem (
  id PK, notebook_id, role ('user'|'assistant'|'system'),
  content, tool_calls TEXT (JSON), modelo, tokens_total, criado_em
);
```

**Índice global em KV** (`CACHE` namespace) com prefix `notebook-idx:<id>` armazenando `{id, titulo, documento_nome, criado_em, atualizado_em}` — usado em `GET /api/notebooks` (não há query cross-DO no Cloudflare).

**Storage de PDF original**: bucket `R2_LEIS` (reusando, não criamos bucket novo) com chave `notebooks/<id>/source.pdf`.

---

## Configuração e deploy

### Pré-requisitos

- Secret `GOOGLE_API_KEY` no Worker MCP (já existente — usado pelo Auditor PEVS no plano original).
- Secret `INGESTION_API_SECRET` em ambos os Workers (já existente).

### Bindings

`apps/mcp-server/wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "NOTEBOOK_AGENT"
class_name = "NotebookAgent"

[[migrations]]
tag = "v2-notebook-agent"
new_sqlite_classes = ["NotebookAgent"]
```

### Deploy

1. **Container** (novo endpoint `/parse-doc`):
   ```bash
   pnpm -F @vectorgov-t/ingestion-api deploy
   ```

2. **Worker MCP** (novo DO + rotas):
   ```bash
   NODE_OPTIONS=--use-system-ca pnpm -F @vectorgov-t/mcp-server deploy
   ```
   Wrangler aplica automaticamente a migration `v2-notebook-agent`.

3. **Web-UI** (3 rotas novas + sidebar):
   - Build via WSL (ver `docs/deployment.md §12`).
   - Deploy via `wrangler deploy` no Windows.

---

## Custo estimado

Conversa típica de 10 turnos com 3 tool calls (médias):

| Componente | Tokens | Custo |
|---|---|---|
| Gemini 3.5 Flash input (10 turns × ~2k) | 20k | $0.0015 |
| Gemini 3.5 Flash output (10 turns × ~500) | 5k | $0.0015 |
| Workers AI embedding bge-m3 (50 chunks × 600 chars) | — | ~$0.001 |
| Vectorize storage | — | ~$0 |
| **Total** | | **~$0.005 / conversa** |

Cost tracker (`TrackedLLMClient`) pode ser plugado depois pra contabilizar e expor em `/api/notebooks/:id/custo`.

---

## Limitações conscientes

- **PDF escaneado sem OCR** retorna `total_chars=0` e o endpoint `/parse-doc` devolve 400 — UI mostra mensagem amigável.
- **PDF > 50 MB** rejeitado no upload com 413.
- **PDF > 165 páginas** pode bater no timeout do Container (6min). Avisado na UI.
- **Múltiplos documentos por notebook**: não suportado neste MVP. Cada notebook = 1 PDF. Pra anexar outro, criar notebook novo.
- **Auditor não roda no chat**: respostas têm citações via tool calls (logado no histórico), mas não passam pela auditoria estrita do PEVS. Isso é intencional — chat livre é exploratório, não substituto da análise PEVS.
- **Sem voz, sem export de podcast**: o NotebookLM real do Google tem geração de podcast TTS. Não cabe no MVP.

---

## Como adicionar uma tool nova

1. Se for filesystem/semantic/skill genérica: já está em `apps/mcp-server/src/mcp/tools/`. Registre a tool na boot e adicione o nome à allowlist read-only do chat em `engine.ts`.
2. Se for um agente especialista novo: adicionar wrapper em `engine.ts:buildTools()` seguindo o padrão de `consultar_pesquisador`.
3. Se for específica do notebook (operação sobre o DO): adicionar método no `NotebookAgent` + wrapper em `engine.ts:buildTools()`.
