---
nome: pesquisa-de-precos-vantajosidade
descricao: "Apura o preco de referencia (vantajosidade) no vectorgov-t usando as tools da plataforma: resolve CATMAT/CATSER, consulta precos publicos praticados (mediana com aderencia e unidade), anexa ARP de suporte e complementa com web. Versao enxuta da IN 65/2021 para o demonstrador (so bens, nao engenharia)."
categoria: analise-peticao
status: active
modelo_recomendado: gemini-3.5-flash
agentes_aplicaveis:
  - orquestrador
  - especialista-reequilibrio
  - pesquisador
versao: 1.0.0
data_atualizacao: 2026-05-30
autor: "vectorgov-t"
tokens_aproximados: 1400
trigger:
  palavras_chave:
    - preco
    - precos
    - vantajosidade
    - preco de referencia
    - pesquisa de precos
    - catmat
    - catser
    - mercado
    - mediana
    - valor estimado
  contextos:
    - "Apurar se o preco do contrato segue vantajoso vs mercado no reequilibrio."
    - "Descobrir o codigo CATMAT/CATSER de um objeto e o preco publico praticado."
    - "Anexar documento de suporte (ARP) a uma pesquisa de preco."
---

# Pesquisa de preços (vantajosidade) — demonstrador

## O que esta skill faz

Orienta a apuração do **preço de referência** de um objeto usando as **tools da
plataforma** — não coleta manual. É a versão enxuta da metodologia da IN
SEGES/ME nº 65/2021 adaptada ao demonstrador: a plataforma já faz o trabalho
pesado (aderência e normalização de unidade são **determinísticas** nas tools).

> **Na análise de reequilíbrio isso é automático** (`analisar_reequilibrio`
> apura catálogo→preço→docs e anexa `preco_referencia` ao parecer, seção IV).
> Use esta skill quando o usuário pedir a pesquisa **avulsa** no chat, ou um
> cliente MCP externo for usar as tools.

## Escopo do demonstrador

- **Cobre:** bens em geral (material/**CATMAT**) com preços públicos do
  Compras.gov + ARPs do PNCP + complemento de mercado (web).
- **Não cobre:** obras e serviços de engenharia (art. 23, §2º — Sicro/Sinapi);
  geração de mapa de preços/relatório/memória formatados; coleta por navegador.
  Serviço (CATSER) ainda não tem preço público nesta fase — só material.

## Fluxo com as tools (nesta ordem)

**1. Resolver o objeto → código de catálogo.**
- `buscar_catalogo_semantico({ descricao, top_k })` — descreva o objeto em
  linguagem natural; devolve os CATMAT/CATSER aderentes (semântico).
- `grep_catalogo({ padrao })` — confere por termo exato quando precisar de precisão.
- ⚠️ O CATMAT é um *join key sujo*: cadastro relapso na origem, e códigos podem
  estar **descontinuados** (a busca semântica acha o **ativo**). Se o resultado
  parecer estranho, teste outra descrição.

**2. Consultar o preço público praticado.**
- `consultar_precos_praticados({ codigo_item, descricao_objeto, data_inicio, data_fim })`.
- A tool **já aplica**: portão de **aderência** (descarta amostras cujo objeto não
  bate) e **normalização de unidade de fornecimento** (R$/caixa-de-100 ≠ R$/unidade
  — usa a unidade predominante e conta as descartadas). Leia
  `estatisticas`: a **mediana** é o preço de referência (art. 6º; recomendação TCU),
  `n` = amostras aderentes, `n_descartadas_*` = transparência anti-lixo.

**3. Anexar documento de suporte (exigência legal — art. 3º, VII).**
- `buscar_documentos_suporte({ data_inicio, data_fim, cnpj_orgao? })` — lista ARPs
  do PNCP como candidatas. MVP: **candidatos por órgão+período** (sem vínculo 1:1);
  escolha a aderente ao objeto.

**4. Complementar com mercado (só se faltar amostra pública).**
- `pesquisar_web({ query })` — **TIER 2, suplementar**. Cada resultado tem URL
  (proveniência). Use apenas para complementar quando os preços públicos aderentes
  forem insuficientes, e **cite com ressalva** ("preço de mercado, conferir").

## Núcleo metodológico (essencial — IN 65/2021)

- **Hierarquia de tiers:** público (Compras.gov / PNCP, art. 5º incs. I-II) **antes**
  do mercado aberto (web). Nunca trate preço de e-commerce como equivalente a
  homologado público.
- **Mínimo ~3 amostras** aderentes sempre que possível (art. 6º). Com poucas
  amostras, sinalize a fragilidade.
- **Mediana** é o default seguro (reduz peso de extremos); a tool já a calcula
  sobre as amostras saneadas. Se a base for só Painel/Compras, o valor **não deve
  superar a mediana** (art. 6º, §6º).
- **Saneamento já é feito** pela tool (aderência + unidade). Reporte ao usuário o
  que foi descartado e por quê — nunca um descarte sem motivo.
- **Não invente** valor, fonte, número de acórdão ou CATMAT. Faltou dado → diga.

## Como reportar ao usuário

1. Diga o **código** resolvido e a **descrição** (confirme aderência ao objeto).
2. Dê a **mediana** (R$ por unidade de fornecimento), `n` e as descartadas.
3. Liste os **documentos de suporte** (ARPs) com link PNCP.
4. Se usou web, separe claramente como **estimativa de mercado (tier 2)**.
5. Limites honestos: dado público é referência; a conferência final é humana.
