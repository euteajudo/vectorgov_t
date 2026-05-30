# Capacidades de Vantajosidade: Preços Públicos + Pesquisa Web

> Capacidades novas para a análise de **vantajosidade** no juízo de reequilíbrio.
> Revisada após feedback de domínio (13 anos de comprador público): o CATMAT é
> um *join key sujo* e a pesquisa de preço exige aderência verificada + docs de
> suporte. Filosofia motor-F1: simples, funciona, determinístico onde importa.

## O problema do CATMAT tem DUAS camadas

1. **Achar o código certo** — catálogo com ~166k linhas; difícil até pra
   especialista. → Resolve-se com um **repositório de catálogo** (busca
   semântica + grep), espelhando o módulo de leis.
2. **Amostras poluídas sob o código certo** — pregoeiros cadastram o primeiro
   CATMAT que veem (certames com 100 itens no mesmo código). → Nenhum índice
   resolve; só um **portão de aderência** (conferir descrição + ata/TR), que é
   o que o comprador faz na mão.

Consequência de design: o determinismo fica na *busca + estatística*, mas
**uma amostra só entra na mediana se passar no portão de aderência**. Cada
amostra carrega proveniência (`id_compra`) **e** flag de aderência — reforça o
Auditor (nada de média de lixo).

## Tiers de confiança

| Tier | Fonte | Confiança | Natureza |
|---|---|---|---|
| **1 — Autoritativo** | Compras.gov.br "Preços Praticados" (CATMAT/CATSER) + homologados PNCP 14.133, **filtrado por aderência** | Alta — citável | Tool determinística + portão de aderência |
| **2 — Suplementar** | Tavily (mercado aberto) | Baixa — com ressalva | Tool com proveniência (URL) obrigatória |

Mediana das amostras aderentes = preço de referência (TCU / IN 65/2021).

---

## Módulo A — Repositório de Catálogo (produto independente)

Espelha a estrutura do módulo de leis (reusa o *esqueleto de busca*; a ingestão
é mais simples — linhas, não PDFs). Construído **desacoplado** (bucket + índice
próprios) para poder ser destacado como produto.

- **Fonte:** planilha CATMAT/CATSER (download compras.gov.br) ou API
  `modulo-material/4_consultarItemMaterial` / `modulo-servico/6_consultarItemServico`.
- **Armazenamento:** R2 (linhas brutas) + D1 FTS5 (grep) + Vectorize (semântico, bge-m3).
- **Tools:**
  - `buscar_catalogo_semantico({ descricao, tipo, top_k })` → candidatos CATMAT/CATSER por similaridade.
  - `grep_catalogo({ padrao, tipo, max })` → varredura textual exata (FTS5/regex), igual ao `fs_grep` das leis.
- **Skills (2):** como navegar o catálogo (semântico p/ descobrir → grep p/ precisar → testar vários candidatos).

> Decisão: **grep + semântico agora**. A ingestão semântica das ~166k linhas é
> um job único (embeddings bge-m3 + storage Vectorize) — passo **gated**: confirmo
> antes de disparar e preciso do arquivo-fonte.

## Módulo B — Preços públicos + aderência (Tier 1)

- **Cliente** `lib/compras-gov.ts` — `https://dadosabertos.compras.gov.br`, público sem auth:
  - `/modulo-pesquisa-preco/1_consultarMaterial?codigoItemCatalogo={CATMAT}` (+ `2_*Detalhe`)
  - `/modulo-pesquisa-preco/3_consultarServico?codigoItemCatalogo={CATSER}` (+ `4_*Detalhe`)
  - `/modulo-contratacoes/3_consultarResultadoItensContratacoes_PNCP_14133` (homologados 14.133)
- **Tool** `consultar_precos_praticados({ codigo_item, tipo, uf?, municipio?, esfera?, poder?, data_inicio?, data_fim? })`:
  1. Busca amostras (paginação agregada + cache KV).
  2. **Portão de aderência (médio):** filtra amostras pela aderência da descrição
     do item ao objeto **e** puxa o registro da ata/contratação como corroboração.
  3. Agrega só as aderentes → estatística determinística (mediana/P25/P75/...).

## Módulo C — Documentos de suporte (exigência legal)

- **Cliente** `lib/pncp-consulta.ts` — `https://pncp.gov.br/api/consulta`, público:
  - `/v1/atas` — ARP por período de vigência (documento de suporte).
  - `/v1/contratacoes/publicacao` — contratações por data.
  - `/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}` — detalhe da contratação (`consultarCompra`).
- **Tool** `buscar_documentos_suporte({ id_compra | cnpj+ano+sequencial })` → anexa
  ARP/ata + contratação (com link PNCP) e referência do TR para conferência de aderência.
  (Endpoint de download do PDF do TR confirmado na implementação — vem nos arquivos da contratação.)

## Módulo D — Pesquisa web (Tavily, Tier 2)

- **Tool** `pesquisar_web({ query, topico?, max_resultados? })` → `POST https://api.tavily.com/search`
  (search+extract). Saída `ResultadoWeb[]` com **url obrigatória**. Secret `TAVILY_API_KEY` (free tier MVP).
- Resultados rotulados "mercado aberto — confirmar"; Redator cita com ressalva.

---

## Integração

- `tools-adapter.ts` já funde registry → as tools chegam sozinhas aos 8 agentes **e** ao MCP externo.
- `roles/pesquisador.ts`: hierarquia — catálogo (achar código) → preços públicos (aderência) → docs de suporte → web só complementa.
- `roles/esp-reequilibrio.ts`: consome `PrecoReferencia` no juízo de vantajosidade.
- `packages/schemas` (análise/parecer): `preco_referencia: PrecoReferencia` + `documentos_suporte[]` + `fontes_preco[]`.
- Auditor: amostras Tier 1 verificáveis por `id_compra` + flag de aderência; Tier 2 carrega URL.

---

## To-do

1. **Schemas** — `catalogo.ts` (`ItemCatalogo`), `precos.ts` (`AmostraPreco`, `EstatisticasPreco`, `PrecoReferencia`, `DocumentoSuporte`), `pesquisa-web.ts` (`ResultadoWeb`) + exports.
2. **Cliente Compras** `lib/compras-gov.ts` (fetch + paginação + cache KV).
3. **Cliente PNCP Consulta** `lib/pncp-consulta.ts` (atas/contratações/compra).
4. **Repositório catálogo** — ingestão R2 + D1 FTS + Vectorize *(gated: confirma + arquivo-fonte)*; reusa esqueleto de busca das leis.
5. **Tools catálogo** `buscar_catalogo_semantico` + `grep_catalogo`.
6. **Tool preços** `consultar_precos_praticados` + agregação determinística + **portão de aderência (médio)**.
7. **Tool docs** `buscar_documentos_suporte`.
8. **Tool web** `pesquisar_web` (Tavily) + secret.
9. **Registrar** tudo no registry (chega ao PEVS + MCP).
10. **Skills (2)** do catálogo + **prompts** dos roles (`pesquisador`, `esp-reequilibrio`) com a hierarquia de tiers.
11. **Campo** `preco_referencia` + `documentos_suporte` na análise/parecer (schema + Redator).
12. **Testes** (mock das APIs) + smoke real: objeto → catálogo → preço → aderência → doc.
13. **Deploy**.

> Escopo MVP: sem rate-limit/quota sofisticada, sem multi-tenant. Tavily free tier. Custos revisados se o cliente aprovar.

---

## Validação contra dados reais (smoke test)

Endpoints e shapes confirmados em produção (públicos, sem auth):

- **Catálogo material:** `342.148` itens (CATMAT) — `descricaoItem` rica e
  estruturada (ótima para embedding). O filtro `descricaoItem` da API **não** é
  busca livre (retorna vazio) → confirma a necessidade do índice semântico próprio.
- **Preços praticados (CATMAT 269894 = "luva de procedimento", o caso real do
  cliente):** 203 registros em 2024. Campos: `precoUnitario` (REAIS, decimal →
  `×100` centavos), `descricaoItem`/`descricaoDetalhadaItem` (aderência),
  `siglaUnidadeFornecimento`/`capacidadeUnidadeFornecimento` (normalização de
  unidade — ex.: R$ 22,50 / CAIXA de 100), `forma` ("SISRP" → tem ARP),
  `marca`, `nomeFornecedor`, `objetoCompra`, UF/órgão/poder/esfera, `idCompra`.
- **Homologados 14.133:** 14.162 registros num único dia; traz
  `valorUnitarioHomologado` + `numeroControlePNCPCompra` mas **não** a descrição
  do item (exige join com `2_consultarItensContratacoes` para aderência).

### Gotcha de domínio incorporado: normalização de unidade
O preço é por **unidade de fornecimento** (CAIXA-de-100 ≠ UNIDADE). A agregação
agrupa por unidade, usa a predominante e descarta+conta as demais — senão a
mediana mistura R$/caixa com R$/unidade. Já implementado em `preco-stats.ts`.

### Ponto aberto: ligar amostra de preço → documento de suporte
O `idCompra` do Compras.gov ("16010305900212024") **não** é o
`cnpj+ano+sequencial` / `numeroControlePNCP` que a API de Consulta do PNCP usa
para `consultarCompra`/atas. Ligar uma amostra ao seu PDF de ARP/TR exige uma
ponte de identificadores — decisão de design pendente (Módulo C).
