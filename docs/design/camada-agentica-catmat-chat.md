# Camada agêntica do catálogo — chat com Gemini (harness + skills)

> Assistente de catálogo: o usuário descreve o objeto que vai licitar e o Gemini
> o conduz até o **código CATMAT/CATSER aderente**, usando as 2 tools de busca.
> Segue os princípios da camada de chat do notebook do vectorgov-t: **liberdade
> tática (conversa) × grounding determinístico (código vem SÓ das tools)**.

## O problema que resolve
Achar o CATMAT certo é o terror do comprador (catálogo de 165k, cadastro poluído,
códigos descontinuados). O assistente faz o que o especialista faz na mão: busca
candidatos, confere aderência ao objeto, e ajuda a escolher — sem nunca inventar.

## Princípio central (anti-alucinação)
O modelo tem **liberdade tática** (conversar, pedir esclarecimento, explicar) mas
**zero liberdade sobre os dados**: todo código/descrição vem de uma **tool call**.
Se a tool não retornou, o assistente não cita. Mesmo harness do chat do notebook:
- O backend conduz o Gemini; o Gemini conduz o usuário.
- Tirando o Gemini, a busca ainda funciona (as tools são determinísticas).

## As 2 tools expostas ao Gemini
1. **`buscar_catalogo_semantico({ descricao, tipo?, top_k })`** — linguagem
   natural → códigos por similaridade (Vectorize + FTS + trigram, RRF + rerank).
2. **`buscar_catalogo_lexical({ termo, tipo?, max })`** — FTS5 unicode61
   (full-text) + trigram (substring/parcial). Para termo exato/parcial/código.

(Reusam `lib/catalogo-search.ts` do Worker dedicado — já no ar.)

## Micro-harness (estados leves)
Mais simples que a FSM do notebook (não há documento/funil). Estados derivados da
conversa:
- `EXPLORANDO` — usuário descreveu o objeto; o assistente busca e apresenta
  candidatos (chips clicáveis com código + descrição).
- `REFINANDO` — vários candidatos / aderência ambígua; o assistente pergunta o
  discriminador (apresentação, material, finalidade) e re-busca.
- `CONFIRMADO` — usuário escolheu um código; o assistente confirma e oferece
  "ver preços" (ponte para a vantajosidade) ou nova busca.

Gating: o assistente só pode "confirmar" um código que veio de uma tool nesta
sessão (não inventa). As tools de busca ficam sempre disponíveis.

## Skills (R2 do Worker dedicado)
1. **`assistente-catalogo`** — função do agente, quando usar cada tool, a
   hierarquia (semântico p/ descobrir → lexical p/ precisar), e o **alerta do
   CATMAT poluído** (testar candidatos, conferir aderência, código pode estar
   descontinuado → semântico acha o ativo). NUNCA inventar código.
2. (futura) `vinculo-preco` — como, após achar o código, encadear para a
   vantajosidade.

## Arquitetura (estende o catmat-catser-api)
- **Worker `catmat-catser-api`**: adiciona o chat.
  - `POST /api/catalogo/chat` (ou WS) — orquestra Gemini (Vercel AI SDK +
    @ai-sdk/google) com as 2 tools como function-calling.
  - Chave Gemini: header `X-Google-API-Key` (mesmo padrão do demo), sem persistir.
  - R2 de skills (bucket próprio ou reuso) + `skill_carregar` no boot do prompt.
- **Grounding:** o resultado das tools entra no contexto; o system prompt proíbe
  citar código fora do retornado.

## Frontend (Fase 2 — VPS, vectorgov.io/catmatcatser)
- Página Next com a **mesma identidade visual** do vectorgov.io.
- Entradas no **menu do admin E no menu do usuário**.
- UI de chat (input + bolhas + chips de código clicáveis) consumindo
  `POST /api/catalogo/chat` do Worker; modo busca simples (`/api/catalogo/buscar`)
  como fallback.

## To-do
1. Worker: cliente Gemini + engine conversacional + as 2 tools (function-calling).
2. Micro-harness (estados + gating + grounding anti-alucinação).
3. Skill `assistente-catalogo` (publicar no R2).
4. Endpoint `/api/catalogo/chat` (+ CORS, + chave via header).
5. Frontend `/catmatcatser` (chat + busca) — identidade do site, admin + user.
6. nginx + deploy VPS.
