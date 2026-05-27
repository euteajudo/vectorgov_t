# Deployment — Vectorgov_t

Guia from-scratch para subir o sistema em **uma conta Cloudflare nova**. Replica o estado descrito em [`infra-status.md`](./infra-status.md) e [`arquitetura.md`](./arquitetura.md).

Tempo estimado: 30–60 min em conexão estável, sem contar download de imagem Docker.

---

## 1. Pré-requisitos

| Software | Versão mínima | Como obter |
|---|---|---|
| Node.js | 22.0.0 | https://nodejs.org |
| pnpm | 10.0.0 | `npm i -g pnpm@latest` |
| Wrangler CLI | 4.59.0 | `npm i -g wrangler` |
| Docker Desktop | 4.x | https://www.docker.com/products/docker-desktop |
| Conta Cloudflare | — | https://dash.cloudflare.com/sign-up — plano Workers Paid recomendado |
| Google AI Studio | — | https://aistudio.google.com/apikey para `GOOGLE_API_KEY` |

Validar localmente:

```bash
node --version    # v22.x
pnpm --version    # 10.x
wrangler --version  # 4.59+
docker --version
```

**Caveat box — Windows:** o Wrangler exige `NODE_OPTIONS=--use-system-ca` em **todos** os comandos quando há antivírus interceptando TLS (Kaspersky, ESET, BitDefender). Sem isso falha com `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Detalhes em [`troubleshooting.md`](./troubleshooting.md). Os exemplos abaixo já usam o prefixo.

---

## 2. Clonar e instalar

```bash
git clone <repo-url> vectorgov-t
cd vectorgov-t
pnpm install
cp .env.example .env
```

Editar `.env` e preencher:

```env
CLOUDFLARE_ACCOUNT_ID=<seu_account_id>
CLOUDFLARE_API_TOKEN=<token_com_workers_edit_e_d1_edit>
GOOGLE_API_KEY=<chave_gerada_no_ai_studio>
INGESTION_API_SECRET=<gere_um_aleatório_seguro>
NODE_OPTIONS=--use-system-ca
```

O `INGESTION_API_SECRET` é um valor arbitrário (sugestão: `openssl rand -hex 32`) — vai ser usado como senha compartilhada entre o Worker MCP e o Container Python.

---

## 3. Configurar conta Cloudflare

```bash
NODE_OPTIONS=--use-system-ca wrangler login
NODE_OPTIONS=--use-system-ca wrangler whoami
```

Deve devolver o email e o `account_id`. Anote o `account_id`.

Editar `apps/mcp-server/wrangler.toml` e `apps/ingestion-api/wrangler.toml` substituindo o valor de `account_id` pelo seu (atualmente fixado em `a89dbdb0224cd8d2292cda8a038bc297`).

---

## 4. Provisionar recursos Cloudflare

Use exatamente estes parâmetros (espelham [`infra-status.md`](./infra-status.md)).

### 4.1 Vectorize

```bash
NODE_OPTIONS=--use-system-ca wrangler vectorize create legislacao-tributaria \
  --dimensions=1024 --metric=cosine \
  --description="Legislacao tributaria brasileira pos-reforma"
```

Metadata indexes (4):

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

Validar:

```bash
NODE_OPTIONS=--use-system-ca wrangler vectorize list
NODE_OPTIONS=--use-system-ca wrangler vectorize list-metadata-index legislacao-tributaria
```

**Caveat box — idempotência:** se o índice já existir, o comando `create` falha com erro 409. Sem problema — verifique com `list` e siga.

### 4.2 R2 buckets

```bash
NODE_OPTIONS=--use-system-ca wrangler r2 bucket create vectorgov-t-leis
NODE_OPTIONS=--use-system-ca wrangler r2 bucket create vectorgov-t-skills
```

Validar:

```bash
NODE_OPTIONS=--use-system-ca wrangler r2 bucket list
```

### 4.3 D1 database

```bash
NODE_OPTIONS=--use-system-ca wrangler d1 create vectorgov-t-db
```

A saída inclui um `database_id` no formato UUID. **Copie esse valor** e cole em `apps/mcp-server/wrangler.toml` no campo `[[d1_databases]].database_id` (substitua o atual `44068178-9600-42f3-875d-26ce47a11fd4`).

### 4.4 KV namespace

```bash
NODE_OPTIONS=--use-system-ca wrangler kv namespace create CACHE
```

A saída inclui um `id`. Cole em `apps/mcp-server/wrangler.toml` no campo `[[kv_namespaces]].id` (substitua o atual `0b4eaf157c064a51bcbf1d5e87af6f66`).

---

## 5. Migrations do D1

Aplicar o schema inicial (5 tabelas + FTS5 virtual + 3 índices):

```bash
NODE_OPTIONS=--use-system-ca wrangler d1 execute vectorgov-t-db --remote \
  --file infra/d1-migrations/0001_initial.sql
```

Validar (deve retornar ~12 tabelas, incluindo virtuais da FTS5):

```bash
NODE_OPTIONS=--use-system-ca wrangler d1 execute vectorgov-t-db --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Esperado: `normas`, `dispositivos`, `versoes_dispositivos`, `relacoes`, `dispositivos_fts` + tabelas internas da FTS5 (`_fts_config`, `_fts_content`, `_fts_data`, `_fts_docsize`, `_fts_idx`) + `sqlite_sequence` + `_cf_KV`.

---

## 6. Container Python (parser de PDFs)

O parser corre em um Container Cloudflare dedicado (`apps/ingestion-api/`), com FastAPI + LegisParser. Build via Docker.

```bash
cd apps/ingestion-api
docker build -t vectorgov-t-ingestion:local .
cd ../..
```

Deploy (Wrangler faz upload da imagem como parte do deploy do Worker):

```bash
NODE_OPTIONS=--use-system-ca wrangler deploy \
  --config apps/ingestion-api/wrangler.toml
```

Validar — chame `/health` do worker (URL ecoa o nome configurado em `wrangler.toml`, ex.: `https://vectorgov-t-ingestion.<sua_subdomain>.workers.dev/health`).

**Caveat box:** o `wrangler.toml` do container usa Durable Objects + `[[containers]]`. Esses recursos exigem **Workers Paid** (não funcionam no free tier). Sem o plano pago, esta etapa falha.

---

## 7. Bindings entre os Workers

Hoje o Worker MCP chama o Container Python via HTTP direto (`apps/mcp-server/src/pipeline/container-client.ts` aponta para `https://vectorgov-t-ingestion.souzat19.workers.dev`), autenticando com header `X-Ingestion-Secret`.

> **Planejado:** introduzir um **service binding `INGESTION`** entre os dois workers para evitar o roundtrip pela internet pública e o risco de `1042 — Worker loop detection` em cenários de chamada recursiva. Quando esse binding existir, o `container-client.ts` deve passar a usar `env.INGESTION.fetch()`. Atualizar `apps/mcp-server/wrangler.toml` adicionando:
>
> ```toml
> [[services]]
> binding = "INGESTION"
> service = "vectorgov-t-ingestion"
> ```
>
> Não está em produção ainda. Por enquanto, ajuste a URL hard-coded em `container-client.ts` para o domínio real do seu Container Worker.

---

## 8. Secrets

Os dois workers precisam de secrets. **Mesmo `INGESTION_API_SECRET` em ambos.**

```bash
# Worker MCP
NODE_OPTIONS=--use-system-ca wrangler secret put GOOGLE_API_KEY \
  --config apps/mcp-server/wrangler.toml
NODE_OPTIONS=--use-system-ca wrangler secret put INGESTION_API_SECRET \
  --config apps/mcp-server/wrangler.toml

# Container Python
NODE_OPTIONS=--use-system-ca wrangler secret put INGESTION_API_SECRET \
  --config apps/ingestion-api/wrangler.toml
```

Cada comando pede o valor interativamente (não passe `-v`). Confirmar:

```bash
NODE_OPTIONS=--use-system-ca wrangler secret list \
  --config apps/mcp-server/wrangler.toml
```

---

## 9. Deploy do Worker MCP

```bash
NODE_OPTIONS=--use-system-ca pnpm -F @vectorgov-t/mcp-server deploy
```

Equivale a `wrangler deploy` lendo `apps/mcp-server/wrangler.toml`. URL final no formato `https://vectorgov-t-mcp.<sua_subdomain>.workers.dev`.

---

## 10. Smoke test

```bash
BASE=https://vectorgov-t-mcp.<sua_subdomain>.workers.dev

# Health
curl $BASE/health

# Versão
curl $BASE/version

# Listar tools (deve trazer 13)
curl -X POST $BASE/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# Listar normas (deve trazer 0 -- ainda não ingerimos nada)
curl -X POST $BASE/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fs_listar_normas","arguments":{}}}'
```

Se `tools/list` devolveu 13 tools e `fs_listar_normas` devolveu `{"normas":[],"total":0,"fonte":"r2"}`, o backend está saudável.

---

## 11. Upload das skills iniciais

As 10 skills do git ainda não estão no R2. Subir:

```bash
NODE_OPTIONS=--use-system-ca node scripts/upload-skills-to-r2.mjs
```

O script faz `R2_SKILLS.put` para cada arquivo em `packages/skills/active/` e dispara regeneração da meta-skill.

Validar:

```bash
curl -X POST $BASE/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"skill_listar","arguments":{}}}'
```

Deve trazer 10 skills.

---

## 12. Frontend (Cloudflare Pages)

> **Status:** **Planejado.** O deploy do frontend para Pages ainda não está em produção. O app roda localmente via `pnpm -F @vectorgov-t/web-ui dev`.

Quando for fazer o deploy:

1. Configurar o build no dashboard Cloudflare Pages:
   - Framework: Next.js.
   - Build command: `pnpm -F @vectorgov-t/web-ui build`.
   - Output directory: `apps/web-ui/.next`.
   - Variável `NEXT_PUBLIC_API_BASE` apontando para o domínio do Worker MCP.
2. Conectar o repositório GitHub.
3. Definir build de preview em branches `feature/*`.

Localmente, sempre testar com:

```bash
pnpm -F @vectorgov-t/web-ui dev
```

acessando `http://localhost:3000`.

---

## 13. Integrar com Claude Code

```bash
claude mcp add vectorgov-t https://vectorgov-t-mcp.<sua_subdomain>.workers.dev/mcp/v1
claude mcp list
```

A partir daí, dentro do Claude Code, as 13 tools ficam disponíveis. Detalhes em [`api-mcp.md`](./api-mcp.md).

---

## 14. Ingerir a primeira norma

Baixe o PDF da norma (ex.: EC 132/2023 do Planalto). Depois:

```bash
NODE_OPTIONS=--use-system-ca curl -X POST $BASE/ingestao/iniciar \
  -F "pdf=@./ec-132-2023.pdf" \
  -F "lei_id=ec-132-2023" \
  -F "lei_tipo=emenda_constitucional" \
  -F "numero=132" \
  -F "ano=2023" \
  -F "data_publicacao=2023-12-20"
```

Polling do status:

```bash
curl $BASE/ingestao/status/<ingestao_id>
```

Detalhes operacionais em [`operacao.md`](./operacao.md).

---

## Caveat boxes

### Custo estimado mensal

Estimado para tráfego de demo (poucas centenas de petições/mês, 3 normas indexadas):

- Workers Paid plan: **$5/mês** (assinatura base, inclui 10M req/mês, Container e Durable Objects).
- Workers AI (embeddings bge-m3): incluído no plano com cota generosa.
- D1: incluído (limite de 5GB e 25M reads/dia, suficiente).
- Vectorize: incluído (5M vetores, 50K queries/dia).
- R2: pago por GB armazenado e classe A/B ops; **< $1/mês** para até ~10 GB.
- Gemini API (Flash + Pro): variável. Alvo do produto: **< $0,50 por petição completa**.

Total típico para demo: **$5–20/mês**. Para produção com volume real, projete por número de petições e contratualize Gemini via Vertex AI se necessário.

### Vectorize index pré-existente

Se você reaproveitar uma conta e o `legislacao-tributaria` já existir, `wrangler vectorize create` falha. Skip e siga — o `list` confirma. Mas valide as 4 metadata indexes (`lei`, `artigo`, `tema`, `tipo_dispositivo`) com `list-metadata-index`.

### Erro TLS no Windows

Sintoma: `UNABLE_TO_VERIFY_LEAF_SIGNATURE` em qualquer comando wrangler ou pnpm.

Solução curta:

- `.npmrc` do projeto já tem `use-system-ca=true`.
- Sempre prefixe wrangler com `NODE_OPTIONS=--use-system-ca`.
- Ou exporte permanente no shell: `export NODE_OPTIONS=--use-system-ca`.

Detalhes em [`troubleshooting.md`](./troubleshooting.md).

### Quota Workers AI

O free tier de Workers AI tem cota diária de "neurônios" (unidade de compute). Ingestão da LC 214 (600+ dispositivos) consome embeddings em batch e pode estourar. Sintoma: pipeline trava em `fase=embedding` com `processados < total`. Espere reset diário ou faça upgrade para Workers Paid.

### Plano free vs Paid

Várias features deste sistema **exigem Workers Paid**:

- Containers Cloudflare (parser Python).
- Durable Objects (binding do Container).
- Subrequest budget de 1000/req (vs. 50 no free) — necessário em ingestão grande.

Free tier serve para experimentação do Worker MCP + tools, mas não para o pipeline de ingestão completo.

---

## Checklist final

Marque conforme avança:

- [ ] Account ID atualizado em `apps/mcp-server/wrangler.toml` e `apps/ingestion-api/wrangler.toml`
- [ ] Vectorize criado com 4 metadata indexes
- [ ] R2 buckets `vectorgov-t-leis` e `vectorgov-t-skills` criados
- [ ] D1 `vectorgov-t-db` criado, `database_id` colado no wrangler.toml, migration aplicada
- [ ] KV `CACHE` criado, `id` colado no wrangler.toml
- [ ] Container Python deployado e respondendo `/health`
- [ ] Secrets (`GOOGLE_API_KEY`, `INGESTION_API_SECRET`) setados em ambos os workers
- [ ] Worker MCP deployado, `tools/list` devolve 13 tools
- [ ] 10 skills uploaded, `skill_listar` devolve 10
- [ ] (Opcional) Frontend rodando local em http://localhost:3000
- [ ] Claude Code integrado via `claude mcp add`
- [ ] Pelo menos 1 norma ingerida e visível em `fs_listar_normas`

Próximos passos: ver [`backlog.md`](./backlog.md).
