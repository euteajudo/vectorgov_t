# API MCP — Vectorgov_t

Referência completa das **13 tools** expostas pelo Worker MCP via JSON-RPC 2.0 em `POST /mcp/v1`.

URL em produção: `https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1`.

> **Convenção de nomes:** todas as tools usam `snake_case`. Os campos de input também. Schemas Zod canônicos vivem em `packages/schemas/src/mcp-tools.ts` e `packages/schemas/src/skills.ts`. Implementação em `apps/mcp-server/src/mcp/tools/`.

---

## Sumário

| Categoria | Tool | Quando usar |
|---|---|---|
| Semântica | [`buscar_legislacao`](#buscar_legislacao) | Busca livre em linguagem natural |
| Semântica | [`consultar_artigo`](#consultar_artigo) | Lookup direto por referência exata |
| Semântica | [`listar_artigos_por_tema`](#listar_artigos_por_tema) | Panorama temático |
| Semântica | [`comparar_redacoes`](#comparar_redacoes) | Diff entre versões de um dispositivo |
| Filesystem | [`fs_listar_normas`](#fs_listar_normas) | Catálogo de normas indexadas |
| Filesystem | [`fs_listar_estrutura`](#fs_listar_estrutura) | Árvore de uma norma |
| Filesystem | [`fs_ler_dispositivo`](#fs_ler_dispositivo) | Texto de um artigo/parágrafo |
| Filesystem | [`fs_ler_intervalo`](#fs_ler_intervalo) | Vários artigos em paralelo |
| Filesystem | [`fs_grep`](#fs_grep) | Busca textual (FTS5 ou regex) |
| Skills | [`skill_listar`](#skill_listar) | Catálogo de skills ativas |
| Skills | [`skill_carregar`](#skill_carregar) | Markdown completo de uma skill |
| Skills | [`skill_identificar_relevantes`](#skill_identificar_relevantes) | Recomendação por LLM |
| Skills | [`skill_publicar`](#skill_publicar) | Publica skill nova ou atualiza versão |

---

## Padrão JSON-RPC 2.0

Toda requisição segue o envelope:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "<nome_canônico>",
    "arguments": { ... }
  }
}
```

Resposta de sucesso (envelope MCP):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "<JSON serializado do output>" }]
  }
}
```

Resposta de erro de validação **dentro do envelope** (tool-level error):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "{\"error\":\"...\",\"details\":...}" }],
    "isError": true
  }
}
```

Códigos JSON-RPC usados:

- `-32700` Parse error (body não é JSON).
- `-32600` Invalid Request (envelope JSON-RPC malformado).
- `-32601` Method not found (método ou tool inexistente).
- `-32602` Invalid params (parâmetros faltando ou inválidos via Zod).
- `-32603` Internal error (exceção não tratada).

### Listar todas as tools

```bash
curl -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Devolve um array com `name`, `description` e `inputSchema` para cada uma das 13 tools.

---

## Tools semânticas

### `buscar_legislacao`

Busca híbrida (dense + lexical + RRF + rerank) sobre a base de normas. Retorna até `top_k` snippets com citação canônica e score combinado.

**Quando usar.** Perguntas livres em linguagem natural ("como funciona o regime de transição IBS/CBS?", "preferência de microempresas em licitação"). Para lookup direto de artigo conhecido use `consultar_artigo` (mais barato).

**Input**

| Campo | Tipo | Default | Observação |
|---|---|---|---|
| `query` | string (min 3) | — | Texto da pergunta |
| `top_k` | int 1..20 | 5 | Quantos snippets |
| `filtros.lei` | string | — | Restringe a uma norma |
| `filtros.tema` | string | — | Filtro por tema do metadata Vectorize |
| `filtros.tipo_dispositivo` | string | — | `artigo`, `paragrafo` etc. |

**Output**

```json
{
  "resultados": [
    {
      "citacao": {
        "norma_id": "lc-214-2025",
        "norma_label": "...",
        "artigo": 23,
        "paragrafo": null,
        "inciso": null,
        "alinea": null,
        "hierarquia_path": "art23"
      },
      "texto": "...",
      "score": 0.87,
      "tipo_dispositivo": "artigo"
    }
  ],
  "total": 5,
  "query_normalizada": "...",
  "metodo": "hybrid_rrf_rerank"
}
```

**Exemplo**

```bash
curl -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"buscar_legislacao",
      "arguments":{"query":"reequilíbrio econômico-financeiro fato superveniente","top_k":3}
    }
  }'
```

---

### `consultar_artigo`

Lookup direto de um dispositivo pela tripla (`norma`, `artigo`, [`paragrafo`, `inciso`, `alinea`]). Não usa embedding nem FTS — SQL puro sobre D1 com `data_fim IS NULL` (versão vigente).

**Quando usar.** O agente já sabe a referência exata. Custo mínimo (uma query indexada).

**Input**

| Campo | Tipo | Observação |
|---|---|---|
| `norma_id` | string | Slug. Ex.: `lei-14133-2021` |
| `artigo` | int >= 1 | — |
| `paragrafo` | int >= 0 | Opcional |
| `inciso` | string | Opcional. Ex.: `II` |
| `alinea` | string | Opcional. Ex.: `d` |

**Output**

```json
{
  "encontrado": true,
  "citacao": { "norma_id":"...", "artigo":124, "inciso":"II", "alinea":"d", "hierarquia_path":"art124-II-d", "..." : "..."},
  "texto": "Art. 124. ...",
  "versao_vigente": {
    "data_inicio": "2021-04-01",
    "data_fim": null,
    "norma_que_alterou": null
  }
}
```

Quando o artigo não existir: `{ "encontrado": false }`.

**Exemplo**

```bash
curl -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"consultar_artigo",
      "arguments":{"norma_id":"lei-14133-2021","artigo":124,"inciso":"II","alinea":"d"}
    }
  }'
```

---

### `listar_artigos_por_tema`

Recupera dispositivos com `metadata.tema == tema` no Vectorize, ordenados por similaridade ao próprio nome do tema. Implementação: embed do tema com `@cf/baai/bge-m3` + `VECTORIZE.query` com filtro.

**Quando usar.** Panorama temático ("todos os artigos sobre fato do príncipe", "preferências em licitações"). Mais preciso que `buscar_legislacao` quando o tema já está curado no metadata.

**Input**

| Campo | Tipo | Default |
|---|---|---|
| `tema` | string | — |
| `lei` | string | — (opcional, restringe a uma norma) |
| `top_k` | int 1..50 | 20 |

**Output**

```json
{
  "tema": "reequilibrio_economico_financeiro",
  "artigos": [
    {
      "citacao": { "..." : "..." },
      "score": 0.91,
      "preview": "Texto truncado em 280 chars..."
    }
  ],
  "total": 20
}
```

**Exemplo**

```bash
curl -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"listar_artigos_por_tema",
      "arguments":{"tema":"reequilibrio_economico_financeiro","top_k":10}
    }
  }'
```

---

### `comparar_redacoes`

Compara duas versões de um dispositivo (por data) e devolve diff palavra-a-palavra estruturado. Sem datas, usa primeira vs. última versão registrada.

**Quando usar.** Reportar mudanças entre redações sem despejar o texto bruto inteiro no contexto do LLM.

**Input**

| Campo | Tipo | Observação |
|---|---|---|
| `dispositivo_id` | string | UUID ou ID canônico interno |
| `data_a` | string `YYYY-MM-DD` | Opcional — versão vigente nesta data |
| `data_b` | string `YYYY-MM-DD` | Opcional — idem |

**Output**

```json
{
  "dispositivo_id": "...",
  "versao_a": { "data_inicio":"...", "data_fim":"...", "texto":"...", "norma_que_alterou":"..." },
  "versao_b": { "..." : "..." },
  "diff": [
    { "tipo": "igual", "texto": "..." },
    { "tipo": "removido", "texto": "..." },
    { "tipo": "adicionado", "texto": "..." }
  ],
  "resumo": {
    "palavras_iguais": 120,
    "palavras_adicionadas": 8,
    "palavras_removidas": 3
  }
}
```

Lança erro se o dispositivo tem menos de duas versões.

---

## Tools filesystem

### `fs_listar_normas`

Lê o `_index.json` no top-level do bucket `R2_LEIS`. Cache KV de 6 horas.

**Quando usar.** Catálogo das normas indexadas. Etapa 1 quando o agente ainda não sabe quais normas estão disponíveis.

**Input**

| Campo | Tipo | Observação |
|---|---|---|
| `tipo` | string | Opcional. Filtra por `lei`, `lei_complementar`, `decreto` etc. |

**Output**

```json
{
  "normas": [
    {
      "norma_id": "ec-132-2023",
      "tipo": "emenda_constitucional",
      "numero": "132",
      "ano": 2023,
      "ementa": "...",
      "r2_path": "ec-132-2023/"
    }
  ],
  "total": 1,
  "fonte": "cache"
}
```

`fonte` indica se veio do KV (`cache`) ou foi lido fresco do R2 (`r2`).

---

### `fs_listar_estrutura`

Lê `{norma_id}/_sumario.json` no R2 e devolve árvore hierárquica (livros, títulos, capítulos, seções, artigos).

**Quando usar.** "Mapa" da norma — agente decide onde navegar sem listar artigo a artigo.

**Input**

| Campo | Tipo | Observação |
|---|---|---|
| `norma_id` | string | — |

**Output**

```json
{
  "norma_id": "lc-214-2025",
  "estrutura": [
    {
      "tipo": "livro",
      "numero": "I",
      "titulo": "Do Imposto sobre Bens e Serviços",
      "caminho": "livro-I",
      "filhos": [ { "tipo":"titulo", "..." : "..." } ]
    }
  ],
  "total_dispositivos": 612
}
```

Erro se a norma não estiver indexada (sumário ausente no R2).

---

### `fs_ler_dispositivo`

Lê o texto de um dispositivo específico. **R2 first, fallback D1**. Suporta paginação por `max_tokens` e `cursor` em caracteres.

**Quando usar.** Texto integral de um artigo/parágrafo já localizado por busca.

**Input**

| Campo | Tipo | Default | Observação |
|---|---|---|---|
| `norma_id` | string | — | — |
| `artigo` | int >= 1 | — | — |
| `paragrafo` | int >= 0 | — | Opcional |
| `inciso` | string | — | Opcional |
| `alinea` | string | — | Opcional |
| `max_tokens` | int 100..8000 | 4000 | Pagina o texto |
| `cursor` | int >= 0 | 0 | Offset em caracteres |

**Output**

```json
{
  "citacao": { "..." : "..." },
  "texto": "Art. 23. ...",
  "tokens_aprox": 1840,
  "proximo_cursor": 7320,
  "truncado": true,
  "fonte": "r2"
}
```

`proximo_cursor: null` indica fim do conteúdo.

---

### `fs_ler_intervalo`

Lê em paralelo um intervalo de artigos `[artigo_inicio, artigo_fim]`. Limite duro de **20 artigos** por chamada (excedente sinalizado em `truncado=true`).

**Quando usar.** Carregar um capítulo inteiro de uma vez.

**Input**

| Campo | Tipo | Observação |
|---|---|---|
| `norma_id` | string | — |
| `artigo_inicio` | int >= 1 | — |
| `artigo_fim` | int >= 1 | Deve ser >= `artigo_inicio` |

**Output**

```json
{
  "norma_id": "lc-214-2025",
  "dispositivos": [
    { "citacao": {"..." : "..."}, "texto": "...", "fonte": "r2" }
  ],
  "total": 20,
  "truncado": true
}
```

Falhas individuais (artigo inexistente) não abortam o lote — o item é omitido.

---

### `fs_grep`

Busca textual em dispositivos.

- `regex=false` (default): D1 FTS5 com BM25.
- `regex=true`: regex JavaScript in-memory sobre até 1000 dispositivos, com timeout cooperativo e heurística anti-ReDoS (`(.*)+`, `(.+)+`, etc.).

Cache KV de 1 hora por chave determinística (`padrao` + `regex` + `norma_id` + `max_resultados`).

**Quando usar.** Encontrar trechos por substring/regex sem semântica vetorial.

**Input**

| Campo | Tipo | Default |
|---|---|---|
| `padrao` | string | — |
| `regex` | bool | false |
| `norma_id` | string | — (opcional) |
| `max_resultados` | int 1..100 | 20 |

**Output**

```json
{
  "padrao": "fato superveniente",
  "modo": "fts5",
  "resultados": [
    { "citacao": {"..." : "..."}, "texto": "...", "score": -8.2 }
  ],
  "total": 4,
  "fonte": "live"
}
```

Em FTS5, `score` é o BM25 (mais negativo = mais relevante). Em regex, `score` é omitido.

---

## Tools de skills

### `skill_listar`

Devolve o índice agregado das skills `active`. Lê `_meta.json` do R2 com cache KV de 5 minutos.

**Quando usar.** Catálogo: o agente quer ver o que tem antes de carregar.

**Input**

| Campo | Tipo | Enum |
|---|---|---|
| `categoria` | string | `analise-peticao`, `geracao-parecer`, `calculo-tributario`, `pesquisa-legislacao`, `utilidades` |
| `agente` | string | `orquestrador`, `pesquisador`, `analista-juridico`, `especialista-licitacoes`, `especialista-reequilibrio`, `calculista`, `auditor`, `redator` |

Ambos opcionais.

**Output**

```json
{
  "total": 10,
  "skills": [
    {
      "nome": "extracao-estruturada-peticao",
      "descricao": "...",
      "categoria": "analise-peticao",
      "agentes_aplicaveis": ["orquestrador","analista-juridico","pesquisador"],
      "versao": "1.0.0",
      "tokens_aproximados": 1400
    }
  ],
  "fonte": "cache"
}
```

---

### `skill_carregar`

Baixa o conteúdo completo da skill (metadata + corpo markdown). Cache KV de 60 segundos — TTL curto para que publicações se propaguem rápido pelos isolates.

**Input**

| Campo | Tipo | Pattern |
|---|---|---|
| `nome` | string | `^[a-z0-9-]+$`, min 3 |

**Output**

```json
{
  "skill": {
    "metadata": { "nome":"...", "descricao":"...", "..." : "..." },
    "corpo_markdown": "# Quando usar\n...",
    "r2_key": "active/extracao-estruturada-peticao.md"
  },
  "fonte": "r2"
}
```

Erro `-32603` se a skill não existir no R2.

---

### `skill_identificar_relevantes`

Usa Gemini 2.5 Flash com `generateObject` (structured output) para recomendar 1 a 3 skills relevantes para uma tarefa descrita. Sem `GOOGLE_API_KEY` configurado, cai em **fallback heurístico** por palavras-chave.

**Input**

| Campo | Tipo | Observação |
|---|---|---|
| `descricao_tarefa` | string 20..2000 | Texto da tarefa |
| `agente_solicitante` | string | Opcional. Mesmas opções do `skill_listar.agente` |
| `max_skills` | int 1..3 | Default 3 |

**Output**

```json
{
  "recomendadas": [
    { "nome": "verificacao-fato-superveniente", "motivo": "...", "score": 0.92 },
    { "nome": "analise-nexo-causal", "motivo": "...", "score": 0.78 }
  ],
  "raciocinio": "..."
}
```

Nomes inventados pelo LLM são filtrados antes de retornar.

---

### `skill_publicar`

Publica uma skill em `active/` ou `candidate/` no `R2_SKILLS`. Quando destino é `active`, regenera automaticamente o `_meta.md` + `_meta.json` global (a meta-skill).

**Input**

| Campo | Tipo | Default | Observação |
|---|---|---|---|
| `nome` | string | — | Pattern `^[a-z0-9-]+$`. Deve casar com o `nome` do front-matter |
| `conteudo_markdown` | string min 50 | — | Markdown completo com front-matter YAML |
| `destino` | `active`\|`candidate` | `active` | `candidate` não entra no `_meta` |
| `sobrescrever` | bool | false | Se a key já existe, sem isso falha com erro |

**Output**

```json
{
  "publicado": true,
  "r2_key": "active/minha-skill.md",
  "metadata": { "..." : "..." },
  "meta_regenerado": true
}
```

Erros típicos: front-matter inválido, metadata Zod inválido, `nome` discrepante, key existente sem `sobrescrever=true`.

**Exemplo**

```bash
curl -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"skill_publicar",
      "arguments":{
        "nome":"verificacao-prazo-pedido",
        "conteudo_markdown":"---\nnome: verificacao-prazo-pedido\ndescricao: \"...\"\ntrigger:\n  palavras_chave: [prazo]\n  contextos: []\nagentes_aplicaveis: [analista-juridico]\nmodelo_recomendado: gemini-3.5-flash\nversao: 1.0.1\ndata_atualizacao: 2026-05-27\nautor: \"Você\"\ntokens_aproximados: 1200\ncategoria: analise-peticao\nstatus: active\n---\n\n# Conteúdo...\n",
        "destino":"active",
        "sobrescrever":true
      }
    }
  }'
```

---

## Como integrar com Claude Code / Claude Desktop

### Claude Code (CLI)

Comando único:

```bash
claude mcp add vectorgov-t https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1
```

A partir daí, dentro do Claude Code, todas as 13 tools ficam disponíveis. Validar:

```bash
claude mcp list
```

### Claude Desktop

Editar `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) ou `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vectorgov-t": {
      "url": "https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1",
      "transport": "http"
    }
  }
}
```

Reiniciar o Claude Desktop. As tools aparecem no painel de ferramentas.

### Cliente MCP custom

O endpoint é HTTP POST com JSON-RPC 2.0. Qualquer cliente que fale o protocolo MCP versão `2024-11-05` funciona. Veja [`apps/mcp-server/src/mcp/server.ts`](../apps/mcp-server/src/mcp/server.ts) para detalhes do dispatcher.

### CORS

O Worker MCP serve `Access-Control-Allow-Origin: *` para o endpoint MCP, então integrações via browser são permitidas (com cuidado em produção).

### Rate limit

Duas dimensões aplicadas em `apps/mcp-server/src/lib/rate-limit.ts`:

- **60 req/min por IP** (janela curta)
- **500 req/dia por IP** (cota diária — adicionada na F5.1)

Excedido retorna 429 com header `X-RateLimit-Scope: minute|day` para identificar qual dimensão estourou. Ver [`troubleshooting.md`](./troubleshooting.md) para conduta.

---

## Próximas leituras

- [`operacao.md`](./operacao.md) — dia-a-dia.
- [`skills-guide.md`](./skills-guide.md) — extensão por skills.
- [`arquitetura.md`](./arquitetura.md) — decisões de design.
