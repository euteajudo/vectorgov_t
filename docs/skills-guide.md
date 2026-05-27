# Skills — Guia de criação, iteração e promoção

Este documento explica o **sistema de skills** do Vectorgov_t: o que são, como criar, como iterar com versão `candidate` antes de promover para `active`, e como o sistema escolhe quais skills carregar em cada turno do agente.

> Pré-leituras úteis: [`arquitetura.md`](./arquitetura.md) (principio "Skills dinâmicas — iteração sem deploy"), [`api-mcp.md`](./api-mcp.md) (4 tools de skills).

---

## 1. O que é uma skill

Uma **skill** é um arquivo Markdown com **front-matter YAML** que ensina um agente a executar uma tarefa específica. Vive em duas camadas:

- **Source of truth** em `packages/skills/active/<nome>.md` (commitado no git).
- **Runtime** em `R2_SKILLS` (bucket `vectorgov-t-skills`), com três prefixos:
  - `active/<nome>.md` — versão em produção, indexada na meta-skill.
  - `candidate/<nome>.md` — em teste, **não** entra na meta-skill.
  - `archive/<nome>.md` — versões aposentadas (movidas manualmente).

Carregamento é **lazy**: a meta-skill (~500 tokens) é injetada no contexto do orquestrador; a skill completa só é baixada quando alguém chama `skill_carregar` (cache KV de 60 s).

Princípio: **iterar sem deploy**. Editar e promover uma skill não exige rebuild nem `wrangler deploy`. A próxima request já vê a versão nova (60 s de defasagem máxima por causa do cache).

---

## 2. Estrutura do front-matter

Inferido lendo as 10 skills ativas em `packages/skills/active/`. Schema canônico em `packages/schemas/src/skills.ts` (`SkillMetadata`).

```yaml
---
nome: extracao-estruturada-peticao
descricao: "Extrai dados estruturados (objeto, partes, fundamentos, pedido, anexos) de uma petição de reequilíbrio econômico-financeiro, gerando JSON normalizado para os demais agentes."
trigger:
  palavras_chave:
    - peticao
    - reequilibrio
    - extrair
  contextos:
    - usuário acabou de fazer upload de petição em PDF/DOCX
    - orquestrador precisa abrir a análise de uma nova petição
agentes_aplicaveis:
  - orquestrador
  - analista-juridico
  - pesquisador
modelo_recomendado: gemini-3.5-flash
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1400
categoria: analise-peticao
status: active
---
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `nome` | string kebab-case | sim | Identificador único. Deve casar com o nome do arquivo |
| `descricao` | string | sim | 1 frase. Aparece na meta-skill e em `tools/list`. Tente <200 chars |
| `trigger.palavras_chave` | string[] | sim | Termos que ativam a heurística de fallback do `skill_identificar_relevantes` |
| `trigger.contextos` | string[] | sim | Descrições de quando aplicar; usado pelo LLM para classificar |
| `agentes_aplicaveis` | string[] | sim | Quais dos 7 agentes podem usar |
| `modelo_recomendado` | string | sim | Sugestão (não é enforcement) |
| `versao` | semver | sim | Bumpe a cada mudança. `MAJOR` em quebra de contrato |
| `data_atualizacao` | `YYYY-MM-DD` | sim | — |
| `autor` | string | sim | — |
| `tokens_aproximados` | int | sim | Aproximação útil para o orquestrador medir custo |
| `categoria` | enum | sim | `analise-peticao`, `geracao-parecer`, `calculo-tributario`, `pesquisa-legislacao`, `utilidades` |
| `status` | enum | sim | `active`, `candidate`, `archived` |

Enum dos `agentes_aplicaveis`: `orquestrador`, `pesquisador`, `analista-juridico`, `especialista-licitacoes`, `especialista-reequilibrio`, `calculista`, `auditor`, `redator`.

O **corpo markdown** (após o segundo `---`) é livre. Convenção observada nas 10 skills:

```markdown
# <Título humano>

## Quando usar
<critérios; descreve quando aplicar e quando NÃO aplicar>

## Critérios
<lista numerada dos passos / checks>

## Schema de saída esperado (Zod TypeScript)
<código Zod do output, se a skill produz JSON estruturado>

## Exemplo
<entrada → saída>
```

---

## 3. As 10 skills atuais

Inventário em `packages/skills/active/`:

| Categoria | Nome | O que faz |
|---|---|---|
| analise-peticao | `extracao-estruturada-peticao` | Converte petição em JSON normalizado |
| analise-peticao | `analise-admissibilidade-reequilibrio` | Avalia legitimidade, prazo, prova mínima, enquadramento |
| analise-peticao | `analise-nexo-causal` | Isola concausas e quantifica parcela atribuível ao evento |
| analise-peticao | `verificacao-fato-superveniente` | Confere se evento é posterior, imprevisível, extraordinário, extracontratual |
| analise-peticao | `verificacao-prazo-pedido` | Prescrição quinquenal (Dec. 20.910/1932) + prazos contratuais |
| utilidades | `verificacao-citacoes-literais` | Compara citações byte-a-byte com fonte oficial |
| geracao-parecer | `estrutura-parecer-tecnico-juridico` | Define seções padrão do parecer (ementa, relatório, fundamentação, conclusão, recomendações) |
| geracao-parecer | `redacao-relatorio-fatos` | Narrativa cronológica neutra |
| geracao-parecer | `redacao-fundamentacao-juridica` | Aplicação da Lei 14.133/2021 e diplomas correlatos |
| geracao-parecer | `redacao-conclusao-recomendacoes` | Manifestação + providências |

---

## 4. Como criar skill nova

### Via UI

1. Acessar `/skills` na web-ui.
2. Clicar em "Nova skill".
3. Preencher front-matter no editor (template pré-carregado).
4. Botão "Salvar como candidato" → entra em `candidate/<nome>.md` (não impacta produção).
5. Iterar até estar pronto. Botão "Promover para active" → publica e regenera meta-skill.

> **Observação P0:** a tela `/skills/[nome]/comparar` tem a promoção **desabilitada** por questão de segurança (o markdown do candidate é gerado client-side e poderia sobrescrever active com texto adulterado). Ver bloqueio comentado em `apps/web-ui/src/app/skills/[nome]/comparar/_compare.tsx` (constante `PROMOCAO_HABILITADA = false`) e tasks #52/#53 no [`backlog.md`](./backlog.md). Promoção via API (`skill_publicar`) funciona normalmente.

### Via API (`skill_publicar`)

```bash
curl -X POST https://vectorgov-t-mcp.souzat19.workers.dev/mcp/v1 \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "jsonrpc":"2.0","id":1,"method":"tools/call",
  "params":{
    "name":"skill_publicar",
    "arguments":{
      "nome":"verificacao-onerosidade-excessiva",
      "destino":"candidate",
      "conteudo_markdown":"---\nnome: verificacao-onerosidade-excessiva\ndescricao: \"...\"\ntrigger:\n  palavras_chave: [onerosidade, excessiva]\n  contextos: []\nagentes_aplicaveis: [especialista-reequilibrio]\nmodelo_recomendado: gemini-3.5-flash\nversao: 0.1.0\ndata_atualizacao: 2026-05-27\nautor: \"Equipe\"\ntokens_aproximados: 1500\ncategoria: analise-peticao\nstatus: candidate\n---\n\n# Verificação de onerosidade excessiva\n\n## Quando usar\n..."
    }
  }
}
EOF
```

Validações automáticas:

- Front-matter parseável.
- `SkillMetadata` Zod válido.
- `nome` do parâmetro casa com `nome` do front-matter.
- Se a key já existe e `sobrescrever=false`, falha com `-32603`.

Quando publicar em `active`, o pipeline regenera `_meta.md` + `_meta.json` automaticamente (`apps/mcp-server/src/lib/skills-meta-generator.ts`).

---

## 5. Como iterar (versão `candidate` vs `active`)

Fluxo recomendado para mudar uma skill em produção:

1. **Snapshot.** Baixar a versão ativa atual (`skill_carregar` ou `GET /api/skills/<nome>`).
2. **Editar.** Mudar conteúdo e bumpar `versao` no front-matter (semver).
3. **Publicar como `candidate`.** `skill_publicar` com `destino: candidate`.
4. **Comparar.** Abrir `/skills/<nome>/comparar` na UI — diff lado a lado entre `active` e `candidate`.
5. **Testar.** Rodar golden set (`test/golden-set/run-golden-set.mjs`) com a skill candidate carregada manualmente, ou rodar uma análise ponta a ponta na UI.
6. **Promover.** Via API: `skill_publicar` com `destino: active` e `sobrescrever: true`. A meta-skill é regenerada automaticamente. Próximas requests veem a nova versão em até 60 s.
7. **Limpar.** Opcionalmente, remover `candidate/<nome>.md` do R2.

A versão antiga **não é mantida automaticamente** em `archive/`. Se quiser histórico, mova manualmente:

```bash
NODE_OPTIONS=--use-system-ca wrangler r2 object get \
  vectorgov-t-skills/active/<nome>.md --file /tmp/<nome>-v1.md
NODE_OPTIONS=--use-system-ca wrangler r2 object put \
  vectorgov-t-skills/archive/<nome>-v1.md --file /tmp/<nome>-v1.md
```

E sempre **commite** a mudança em `packages/skills/active/` para o git ser a fonte rastreável.

---

## 6. A/B test

Plano original do produto:

- `active/<nome>.md` atende 90% do tráfego.
- `candidate/<nome>.md` atende 10% via flag no orquestrador.
- Métricas comparadas: taxa de aprovação do Auditor, score de confiança, latência.
- Promoção quando candidata vence em N golden-cases consecutivos.

Estado atual:

- Comparação visual funciona em `/skills/<nome>/comparar`.
- **Promoção pela UI está desabilitada** (P0 #52/#53, ver §4).
- Routing 90/10 não está implementado — toda análise hoje usa `active`. **Planejado** para próxima fase.

Workaround para testar candidate sem promover: chamar `skill_carregar` manualmente apontando para o nome candidate (que tem prefixo `candidate/`). Não há atalho hoje — o agente precisa ser instruído explicitamente.

---

## 7. Meta-skill (gerador automático)

Quando uma skill é publicada em `active/`, o gerador em `apps/mcp-server/src/lib/skills-meta-generator.ts` faz:

1. `R2_SKILLS.list({prefix: "active/"})` paginado.
2. Para cada arquivo: baixa, parseia YAML, valida `SkillMetadata`. Inválidas são descartadas com warning.
3. Agrupa por `categoria` e gera `_meta.md` (tabela markdown ~500 tokens, legível).
4. Gera `_meta.json` (formato `MetaIndex` para as tools `skill_listar` e `skill_identificar_relevantes`).
5. Grava ambos no R2 + invalida a chave KV `skill:_meta`.

Falhas parciais (uma skill com YAML quebrado) **não derrubam** a regeneração — aquele item é omitido. O sistema continua operacional.

A meta-skill é o que o orquestrador injeta em cada turno como contexto. Se ela ficar grande demais (~ tokens), reduza `descricao` das skills ou divida `categoria`.

---

## 8. Boas práticas

| Diretriz | Por quê |
|---|---|
| **Skill < 2000 tokens** | Carregar é caro; orquestrador pode acionar 2-3 por turno |
| **Formato CONDITIONAL** | "Use quando X" / "NÃO use quando Y" no topo evita aplicação errada |
| **Cite artigo + lei exato** | Reduz alucinação. Use `Art. 124, II, 'd' da Lei 14.133/2021`, não "art. 124 da nova lei" |
| **Schema Zod no corpo** | Quando produz JSON estruturado, embuta o schema (TS) — outro agente consome direto |
| **Exemplo curto, real** | 1 exemplo input→output cabe na skill e ancora o LLM |
| **Bumpe semver corretamente** | PATCH em revisão de texto, MINOR em campo novo no output, MAJOR em quebra de contrato |
| **Atualize `tokens_aproximados`** | Use heurística simples (1 token ~ 4 chars). Não precisa ser exato |
| **Use kebab-case no `nome`** | Pattern `^[a-z0-9-]+$` é validado em runtime |
| **Categoria coerente** | A meta-skill agrupa por categoria; manter coesão facilita o orquestrador |
| **Lista `agentes_aplicaveis` curta** | Skill genérica para 8 agentes vira ruído; prefira 1-3 |

---

## 9. Anti-patterns

| Erro | Sintoma | Como evitar |
|---|---|---|
| **Alucinar precedente** | "Acórdão TCU 1.234/2024 fixou que..." sem fonte verificável | Cite só o que está indexado; o Auditor rejeita em produção |
| **Generalizar sem fonte** | "Em regra, o reequilíbrio é deferido quando..." sem citar artigo | Skill deve apontar dispositivo específico |
| **Conflito com outra skill** | Duas skills com `trigger.contextos` sobrepostos confundem o orquestrador | Use `agentes_aplicaveis` diferentes ou refine o trigger |
| **Skill enciclopédica** | Tenta cobrir 10 tarefas em 5000 tokens | Quebre em N skills menores |
| **Mexer no `_meta.json` à mão** | Inconsistência com `active/` | Sempre regenere via `skill_publicar` (gera automático) |
| **Editar R2 sem commit no git** | Próximo redeploy do bucket apaga | `packages/skills/active/` é a fonte canônica. Sempre commite |
| **Esquecer de bumpar `versao`** | Cache de 60 s nem percebe; observability fica cega | Bump obrigatório em qualquer mudança |
| **Confiar no fallback heurístico** | `skill_identificar_relevantes` cai em palavras-chave se Gemini falhar | Garanta `GOOGLE_API_KEY` configurado em produção |

---

## 10. Cheat sheet

| Tarefa | Comando |
|---|---|
| Listar skills ativas (catálogo) | `curl -X POST .../mcp/v1 -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"skill_listar","arguments":{}}}'` |
| Baixar markdown de uma skill | `tools/call` com `skill_carregar` |
| Recomendar 3 skills para tarefa | `tools/call` com `skill_identificar_relevantes` |
| Publicar nova versão | `tools/call` com `skill_publicar` |
| Promover candidata | `skill_publicar` com `destino: active`, `sobrescrever: true` |
| Listar keys no bucket | `wrangler r2 object list vectorgov-t-skills` |
| Baixar `_meta.json` | `wrangler r2 object get vectorgov-t-skills/_meta.json --file /tmp/meta.json` |
| Forçar regeneração da meta-skill | Republicar qualquer skill em `active` |
| Invalidar cache `_meta` | Publicação já invalida; manual: `wrangler kv key delete --binding=CACHE skill:_meta` |

Mais nos arquivos:

- `apps/mcp-server/src/mcp/tools/skills/` — implementação das 4 tools.
- `apps/mcp-server/src/lib/skills-meta-generator.ts` — meta-skill.
- `packages/schemas/src/skills.ts` — schemas Zod canônicos.
- `packages/skills/active/` — 10 skills publicadas.
