# Futuro — Análise preditiva de preços (sobrepreço × inexequibilidade)

> Ideia parqueada para um **produto de data science** sobre o lago de dados de
> compras públicas. Não é o demonstrador atual — é um produto à parte, que se
> conecta à vantajosidade (reusa o preço de referência), mas vive na camada
> analítica. Registrado para atacar depois.

## O insight central

Cada item de processo licitatório entrega um **par rotulado**:
`(valor_orçado, valor_homologado)` ligado a um **CATMAT/CATSER**. Ou seja: a
estimativa do órgão **e** o que o mercado realmente cobrou. Isso é verdade-terreno
embutida — transforma "adivinhar preço justo" em **aprendizado supervisionado**.

## O que o produto prevê

Dado um preço de referência `P` para um CATMAT:

1. **P(sobrepreço | P, CATMAT)** — onde `P` cai na distribuição real de
   homologados. Percentil alto (ex.: ≥ P95) → "excessivamente elevado"
   (IN 65/2021, art. 2º, II). Substitui a regra fixa de desvio-padrão por uma
   **probabilidade fundamentada no histórico**.
2. **P(inexequível | P, CATMAT)** — cauda inferior (ex.: ≤ P5). Sinaliza risco de
   inexequibilidade (Lei 14.133, art. 59, §4º). Para bens, distribuição empírica
   bate qualquer limiar genérico.
3. **Faixa esperada de homologação** — a razão `homologado/orçado` por CATMAT dá
   o "desconto" típico do mercado sobre a estimativa → prevê faixa de homologação
   e risco de certame deserto/fracassado.

## Dados

- **Fontes:** PNCP / Compras.gov (itens com orçado + homologado), anos de série.
- **Chave:** CATMAT/CATSER (com as ressalvas de poluição — ver caveats).
- **Pré-processamento obrigatório (3 normalizações):**
  1. **Índice temporal** — deflaciona tudo para uma data-base comum.
  2. **Unidade de fornecimento** — R$/caixa-de-100 ≠ R$/unidade (já temos a lógica).
  3. **Aderência** — filtra amostras cujo objeto não bate com o código.

## Normalização por índice (o ponto que o cliente levantou)

IPCA é instrumento cego para muitas categorias. O certo é **índice setorial por
categoria CATMAT**:
- construção → INCC / SINAPI; combustível → próprio; saúde/medicamento →
  específicos; geral → IPCA / IGP-M.
- **v1:** IPCA como baseline, com **override por grupo/classe** quando houver
  índice setorial. Melhora muito a precisão sem complicar o começo.

## Modelagem (espectro + alerta jurídico)

1. **v1 — estatística transparente (começar aqui):** distribuição empírica por
   CATMAT (normalizada por índice+unidade) → probabilidades por percentil.
   Esparsidade resolvida com **fallback hierárquico** (classe/grupo) e
   *shrinkage* bayesiano. **100% explicável e auditável.**
2. **v2 — ML interpretável:** *quantile regression* ou *gradient boosting*
   prevendo a distribuição condicionada a features (CATMAT, região, quantidade,
   modalidade, porte do fornecedor, tempo).

> ⚠️ **Defensabilidade jurídica é uma restrição de design, não um detalhe.** O
> output vira documento que alguém assina e o **TCU audita**; a IN 65 (art. 6º,
> §3º) exige critério **descrito e fundamentado**. Caixa-preta de ML = risco.
> Toda probabilidade tem que vir com "como cheguei nela". Por isso v1 estatística
> primeiro, e ML só com interpretabilidade (SHAP, intervalos, método publicado).

## Arquitetura (separa analytics de serving)

```
PNCP/Compras (milhões de itens orçado+homologado, anos)
        │  ingest + normaliza (índice + unidade + aderência)
        ▼
R2 Data Catalog / Apache Iceberg  ──(DuckDB/Spark)──►  treino + distribuições/CATMAT
        │  pré-computa stats/modelo
        ▼
D1 / KV (serving)  ──►  tool MCP: P(sobrepreço|P,CATMAT) / P(inexequível) / faixa
        │
        ▼
agente responde em ms, COM a fundamentação
```

- **Iceberg** = lake histórico + treino (job pesado, fora do request) — é o caso
  de uso real do R2 Data Catalog.
- **D1/KV** = serving de baixa latência (distribuições pré-computadas por CATMAT).
- **Tool MCP** = o agente consulta a probabilidade por request.

## Caveats honestos

1. **Poluição do CATMAT** — modelo treinado em código mal-cadastrado aprende
   ruído. Aderência é pré-requisito; considerar clusterizar por **descrição** em
   vez do código cru.
2. **Unidade de fornecimento** — sem normalizar, a distribuição mistura unidades.
3. **Esparsidade** — muitos CATMATs com poucos homologados → fallback
   hierárquico + reportar `n`/confiança sempre.
4. **Defensabilidade** — ver alerta acima (transparente > caixa-preta).
5. **Efeitos regionais/temporais** — preço varia por região e tempo; condicionar
   a distribuição (ou ao menos reportar o recorte usado).

## Roadmap por fases

- **F0 — Lake:** ingestão histórica PNCP/Compras (orçado+homologado) em Iceberg;
  pipeline de normalização (índice+unidade+aderência).
- **F1 — Estatística v1:** distribuições empíricas por CATMAT + fallback
  hierárquico; pré-computa para D1/KV; tool MCP `avaliar_preco_referencia`.
- **F2 — Índices setoriais:** override por categoria (INCC/SINAPI/etc.).
- **F3 — ML interpretável:** quantile regression com covariáveis + explicabilidade.
- **F4 — Produto:** dashboard de risco + integração na vantajosidade (o veredito
  de sobrepreço/inexequibilidade entra no parecer).

## Conexão com o vectorgov-t

A vantajosidade atual usa a **mediana** como preço de referência. Este produto
eleva isso a **probabilidade de risco** (sobrepreço/inexequível) — o
`consultar_precos_praticados` ganharia um irmão `avaliar_risco_preco`, e o parecer
passaria a dizer não só "a mediana é R$ X" mas "há N% de chance de este preço ser
sobrepreço, fundamentado na distribuição histórica de M homologados".
