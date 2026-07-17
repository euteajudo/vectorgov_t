# Design — Facetas de topo do catálogo: materializar no D1 (e talvez KV depois)

> **Status:** PROPOSTA para análise (v2, após review — request changes).
> **Data:** 17/07/2026
> **Protótipo:** RETIRADO DO AR (worker `catalogo-kv-proto` e KV de teste
> deletados em 17/07 — ver §9).
> **Decisão pendente:** GO do founder para a Fase A (tabela materializada).

---

## 0. Explicação em linguagem simples

**O problema.** As "facetas de topo" do catálogo — as listas de **grupos**
(197) e **classes** (748) com contagens — são o "mapa" que o agente usa para
explorar o catálogo. Calcular isso é um `GROUP BY` + `COUNT(DISTINCT)` sobre
**346 mil linhas**, e isso custa **1,6–1,9 s por chamada** no D1. É uma
consulta cara e muito repetida, mas o dado só muda **1×/mês** (no ETL).

**A ideia.** Pré-computar essas listas quando o catálogo muda (no ETL) e servir
o resultado pronto, em vez de recalcular a agregação a cada consulta.

**A correção de rota desta v2.** A v1 propunha ir direto para **KV** (cache na
borda da Cloudflare). A review mostrou que o caminho mais seguro é primeiro
**materializar as facetas numa tabela do próprio D1**, atualizada **junto com o
catálogo, na mesma transação**. Isso mata o custo de 1,6–1,9 s com
**consistência forte** (o número nunca fica velho, porque muda junto com os
dados) e complexidade baixa. **KV vira uma segunda camada opcional**, só se a
latência da tabela ainda justificar — e com salvaguardas que a v1 não tinha.

---

## 1. O que o protótipo mediu — e o que NÃO mediu

O protótipo isolado (`experiments/catalogo-kv-proto`, já retirado do ar) comparou
`KV.get` vs a agregação D1, de dentro da borda:

| Faceta | D1 (agregação ao vivo) | KV | Tamanho |
|---|---|---|---|
| `dim=grupo` (197) | ~1.607 ms (mediana quente) | ~1 ms (mediana quente) | 13 KB |
| `dim=classe` (748) | ~1.902 ms (mediana quente) | ~1 ms (mediana quente) | 12 KB |

**Ressalvas honestas (achados da review) — o protótipo NÃO prova:**
- **Equivalência/correção** (achado #1): o `/cmp` mediu só latência, tamanho e
  `hit`; **não** comparava o conteúdo do KV com o do D1. Um KV com lixo ou dado
  do mês anterior "passaria" no benchmark. Logo, o número comprova **latência de
  leitura**, não que o cache está certo.
- **A mesma query do contrato** (achado #2): o protótipo força `ativo = 1`, mas
  o `/navegar` hoje trata `ativo` ausente como **"tudo"**. São contagens
  diferentes.
- **Latência global** (achado #5): "1 ms" é **mediana quente num único PoP**
  (5 leituras seguidas aquecem o cache local). O KV **não** replica cada valor
  para todos os PoPs de antemão — a primeira leitura num PoP frio é mais lenta.
  O ganho é real e grande, mas o rótulo correto é "mediana quente naquele PoP",
  não "latência global garantida".

**O que fica de sólido:** a agregação D1 custa mesmo ~1,6–1,9 s (5 amostras
estáveis) — logo, **pré-computar vale a pena**. É *como* pré-computar que a v2
revê.

---

## 2. Fase A (recomendada) — tabela materializada no D1

Uma tabela `catalogo_facetas(dim, valor, n, escopo, etl_run_id)` preenchida
**na mesma carga** que atualiza `catalogo_itens`:

- **Atômica e consistente:** as facetas são regravadas na transação do apply do
  catálogo. Nunca há janela em que os itens mudaram e as facetas não —
  consistência forte, sem o staleness que o KV tem.
- **Escopo explícito** (achado #2): materializar por escopo — `escopo='active'`
  (só ativos, o default das tools) e, se quiser, `escopo='all'`. A leitura casa
  o escopo exato; nada de uma chave `all` servir contagem de `active`.
- **Barata de servir:** `SELECT ... FROM catalogo_facetas WHERE dim=? AND
  escopo=?` é um índice-scan de ~200 linhas — milissegundos, sem `GROUP BY`
  sobre 346 k.
- **Complexidade baixa:** +1 tabela, +1 passo no ETL (dentro da transação),
  `navegar` sem filtro lê a tabela. Sem serviço novo, sem cache para invalidar.

Isso sozinho deve derrubar 1,6–1,9 s → poucos ms, com consistência forte. É o
que o GO desta v2 pede.

---

## 3. Fase B (opcional, só se a Fase A não bastar) — KV como 2ª camada

Se, após a Fase A, a latência de leitura ainda justificar empurrar para a borda,
KV entra **com as salvaguardas que faltavam na v1**:

1. **Chave imutável por `etl_run_id`** (achado #3): `facetas:active:grupo:<run>`.
   Nunca se sobrescreve uma chave — cada ciclo publica chave nova e o
   `navegar` lê a chave do run corrente (ponteiro atualizado atomicamente). Um
   valor velho nunca é servido como se fosse novo.
2. **Publicação DEPOIS do gate final do ETL** (achado #3): o `catalogo-etl.yml`
   muda o D1 **antes** do gate de contagem/Vectorize. O write no KV só ocorre
   **após** todos os gates passarem — se um gate falha, nada é publicado.
3. **Escopo explícito na chave** (`active`) (achado #2).
4. **Payload versionado + validação de schema na leitura** (achado #1): a
   leitura faz `JSON.parse`, confere versão e forma; **qualquer** falha (miss,
   corrupção, versão/escopo errado) → **fallback ao D1** (agora barato, via
   tabela da Fase A).
5. **Staleness documentado, não negado** (achados #3, #5): a doc oficial do KV
   diz que valores anteriores podem ficar visíveis ~60 s ou mais. Como usamos
   chave imutável por run, o efeito é "o novo run demora alguns segundos para
   ficar global", não "serve dado errado". **Não prometemos zero staleness.**

Correção explícita das frases da v1 que a review apontou: ~~"sem risco de dado
velho"~~ e ~~"nunca serve dado errado"~~ estavam erradas — a garantia real vem
da **Fase A (D1, consistência forte)**; o KV é otimização com staleness
eventual e fallback.

---

## 4. Escopo (onde vale e onde NÃO vale)

| Caso | Materializar? | Motivo |
|---|---|---|
| `navegar dim=grupo`/`dim=classe`, escopo `active` e `all` | ✅ Fase A | poucas linhas, muito lido, agregação cara |
| `navegar` com filtro (`dim=pdm classe=*LIMPEZA*`) | ❌ | combinação ~infinita; segue agregação ao vivo |
| `buscar_catalogo` | ❌ | NL, cauda longa; gargalo é o reranker externo |
| `grep`/`codigo` | ❌ | já sub-500 ms |

---

## 5. Testes exigidos antes de qualquer promoção (da review)

- **Paridade exata** faceta materializada × `consultarFacetas`, com dataset de
  ativos **e** inativos, por escopo.
- Fase B: KV malformado / antigo / escopo errado / miss / exceção → todos caem
  no D1.
- **Falha do ETL após a mutação do D1**: garantir que o KV não é publicado e que
  a tabela materializada só "vale" após o gate.
- Benchmark **cold vs warm separados**, 30+ amostras, p50/p95, múltiplas regiões
  — e comparando conteúdo, não só latência.

---

## 6. Riscos e custos

| Item | Fase A (tabela D1) | Fase B (KV) |
|---|---|---|
| Consistência | forte (atômica com a carga) | eventual (~60 s), mitigada por chave-por-run + fallback |
| Staleness | nenhuma | limitada ao intervalo de propagação; documentada |
| Complexidade | +1 tabela, +1 passo no ETL | +namespace, +publicação pós-gate, +validação/fallback |
| Custo | ~zero | irrisório |
| Contrato de cliente | inalterado | inalterado |

---

## 7. Recomendação

**GO para aprofundar, NÃO GO para produção com KV agora** (alinhado à review).
Ordem: **Fase A** (tabela materializada — resolve o custo com consistência
forte) → medir → só então avaliar a **Fase B** (KV) se a latência ainda pedir.

---

## 8. Estado do protótipo

`experiments/catalogo-kv-proto` foi **retirado do ar** em 17/07 (worker deletado
+ KV de teste deletado) — ele existia só para medir a latência da agregação e
cumpriu o papel. O código fica no PR como registro histórico, com estas
ressalvas de método (§1). Não deve ser re-publicado sem auth (achado #4).

## Resumo de uma linha

As facetas de topo custam 1,6–1,9 s no D1 e valem pré-computar — mas por uma
**tabela materializada atômica no D1** (consistência forte, baixa complexidade)
primeiro, deixando o KV como 2ª camada opcional com chave-por-run, publicação
pós-gate, validação e fallback — sem prometer zero staleness.
