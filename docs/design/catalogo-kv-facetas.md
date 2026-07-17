# Design — Facetas de topo do catálogo na borda (Workers KV via ETL)

> **Status:** PROPOSTA para análise (protótipo medido; nada em produção).
> **Data:** 17/07/2026
> **Decisão pendente:** GO do founder para promover à produção.

---

## 0. Explicação em linguagem simples

**O que é esse KV e para que serve.** KV (Workers KV) é um armazenamento
chave→valor da Cloudflare que fica **replicado em todos os data centers da
borda** (os PoPs, no mundo todo). A leitura é quase instantânea (~1 ms) porque
o dado já está no data center mais perto de quem pediu. A limitação: ele **não
faz consultas** — você só busca por uma chave exata que já conhece. É uma
"gaveta" rápida e global, não um banco pesquisável.

No nosso caso, a ideia é usar o KV como **cache das "facetas de topo"** do
catálogo — as listas de **grupos** (197) e **classes** (748) com as contagens
de itens. É o "mapa" que um agente consulta para explorar o catálogo ("quais
categorias existem?"). Esse dado tem três propriedades que o tornam candidato
perfeito a cache: (1) muda **só uma vez por mês** (no ETL); (2) é **muito
consultado** (todos veem a mesma lista); (3) é **caro de calcular** no banco.

**Como o teste foi feito.** Montei um **worker de teste isolado**
(`catalogo-kv-proto`), separado dos workers de produção — nada que os clientes
usam foi tocado. Esse worker tinha acesso ao **mesmo banco D1** (só leitura) e a
um **KV de teste** novo. A rota `/seed` calcula as facetas no D1 e grava no KV
(simulando o que o ETL faria após cada atualização mensal); a rota `/cmp` busca
**a mesma faceta** das duas fontes (KV e D1), **de dentro da borda** (único
lugar onde a latência real aparece), mede 5 vezes cada e compara. O ponto justo
do método: comparei o KV contra **exatamente a mesma query** que a tool
`navegar` faz hoje no D1 — mesma pergunta, duas formas de responder.

**Resultados atingidos.** Grupos: D1 **1.607 ms** → KV **1 ms**. Classes: D1
**1.902 ms** → KV **1 ms**. Cada faceta ocupa ~13 KB no KV (minúsculo). As
medições do D1 foram estáveis (1,4–2,0 s sempre), logo não é ruído — é o custo
real de agregar 346 mil linhas a cada chamada.

**O que ele resolve** (para as facetas de topo): (a) **latência** 1,6–1,9 s →
1 ms; (b) **carga no banco** — o D1 calcula a agregação pesada **uma vez por
mês** (no ETL) em vez de a cada consulta; (c) **sem risco de dado velho** — o
ETL reescreve o cache exatamente quando os dados mudam. **O que ele NÃO
resolve** (por isso o escopo é restrito): buscas em linguagem natural
(`buscar_catalogo` — cauda longa, gargalo é o reranker externo), facetas **com
filtro** (combinações quase infinitas) e `grep`/`codigo` (já sub-500 ms).

**Em uma frase:** o KV transforma a consulta mais cara e mais repetida do
catálogo (o mapa de categorias, 1,6–1,9 s no banco) numa leitura de 1 ms na
borda, atualizada de graça pelo próprio ETL mensal.

---

## 1. Pergunta

Vale usar Workers KV para deixar dados de catálogo "na borda" e acelerar as
pesquisas? Resposta curta do protótipo: **para as facetas de topo, sim, com
folga; para o resto, não.**

## 2. O que KV é (e não é)

KV = chave→valor replicado nos PoPs, leitura ~1 ms na borda, escrita eventual
(~60 s de propagação), TTL configurável. Bom para **respostas pré-computadas de
chaves conhecidas**. **Não é query-able** — não substitui o D1 para FTS,
facetas com filtro dinâmico ou keyset.

## 3. Método

Protótipo isolado ([`experiments/catalogo-kv-proto`](../../experiments/catalogo-kv-proto)):
um worker de teste com binding ao KV de teste e ao **mesmo D1** (só `SELECT`).
A `/cmp` mede, de dentro da borda, `KV.get` vs a **mesma** query de facetas do
`/navegar` (`GROUP BY <dim>` + `COUNT(DISTINCT)` sobre `catalogo_itens`, default
só-ativos), 5 amostras cada. Nenhum worker de produção foi tocado.

## 4. Resultados (produção, 17/07)

| Faceta | D1 (GROUP BY ao vivo) | KV | Ganho | Tamanho no KV |
|---|---|---|---|---|
| `dim=grupo` (197 grupos) | **1.607 ms** (mediana) | **1 ms** | −1.606 ms | 13 KB |
| `dim=classe` (200 de 748) | **1.902 ms** (mediana) | **1 ms** | −1.901 ms | 12 KB |

Amostras D1 estáveis (grupo: 1608/1566/1651/1607/1455; classe:
1924/1902/1722/1975/1684) — não é ruído, é o custo real da agregação global.

## 5. Análise

- **Correção de uma estimativa anterior:** eu havia dito que "navegar é
  sub-500 ms". Isso vale para o **browse de itens filtrados** (índice + keyset +
  limit). As **facetas de topo** (`GROUP BY` + `COUNT(DISTINCT)` global sobre
  346 k linhas) custam **1,6–1,9 s** — subestimado.
- **O ganho não é só "latência de borda":** é **não recomputar** uma query
  pesada a cada chamada, e **tirar essa carga do D1**. Vale independentemente da
  geografia (a query é intrinsecamente cara).
- **Casamento ideal com o ETL:** essas facetas mudam **só no apply mensal**, são
  o "mapa de navegação" que o agente consulta com frequência (alto reuso), e a
  invalidação é trivial — o ETL faz o *write-through* no fim do apply (o `/seed`
  do protótipo é exatamente isso). Sem TTL adivinhado; sem staleness surpresa.

## 6. Escopo (onde vale e onde NÃO vale)

| Caso | KV? | Motivo |
|---|---|---|
| `navegar dim=grupo` / `dim=classe` **sem filtro** | ✅ | poucas chaves, alto reuso, D1 caro, invalidação trivial |
| `navegar` com filtro (`dim=pdm classe=*LIMPEZA*`) | ❌ | combinação ~infinita de chaves; segue no D1 |
| `buscar_catalogo` | ❌ | linguagem natural, cauda longa → hit rate baixo; gargalo é Cohere, não D1 |
| `grep_catalogo` / `codigo_catalogo` | ❌ | já sub-500 ms no D1 |

## 7. Proposta de promoção (quando houver GO)

1. **Namespace KV de produção** `CATALOGO_FACETAS` no `catmat-catser-api`.
2. **Write-through no ETL:** ao fim de um `apply` bem-sucedido (já rastreado por
   `catalogo_etl_state`), gravar `facetas:grupo:all` e `facetas:classe:all` no
   KV. Um passo a mais no `catalogo-etl.yml`, no mesmo ciclo que muda os dados.
3. **Leitura com fallback:** `navegar_catalogo` quando `dim` sem filtro tenta o
   KV; **miss → cai no D1** e (opcional) popula o KV. Nunca serve dado errado:
   na dúvida, o D1 é a verdade.
4. **TTL 40 dias** como rede de segurança (o ETL reescreve todo mês).
5. Cache-busting no deploy do ETL: a chave carrega o `etl_run_id` do ciclo, para
   auditoria de qual carga gerou a faceta.

## 8. Riscos e custos

| Item | Avaliação |
|---|---|
| Consistência eventual do KV (~60 s) | irrelevante: muda 1×/mês |
| Staleness | limitada ao ciclo do ETL; fallback D1 cobre miss |
| Custo KV | irrisório (2 chaves, ~25 KB, leituras baratas) |
| Complexidade | +1 passo no ETL, +1 branch no `navegar` (com fallback) — pequeno |
| Superfície de cliente | nenhuma mudança de contrato; só latência menor |

## 9. Teardown do protótipo (após a análise)

```bash
npx wrangler delete --name catalogo-kv-proto
npx wrangler kv namespace delete --namespace-id acfa454eefd94ccf96c90832c4f68f07
```

## Resumo de uma linha

As facetas de topo custam 1,6–1,9 s no D1 e 1 ms no KV; como mudam só no ETL
mensal, o write-through pelo ETL é um ganho grande, barato e de invalidação
trivial — vale promover, restrito às facetas sem filtro.
