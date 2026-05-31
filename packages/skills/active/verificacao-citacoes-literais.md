---
nome: verificacao-citacoes-literais
descricao: "Verifica se cada citação literal de lei, decreto, acórdão ou doutrina presente no parecer corresponde exatamente ao texto da fonte oficial, prevenindo alucinações e citações inexistentes."
trigger:
  palavras_chave:
    - verificar
    - citacoes
    - literal
    - aspas
    - fidelidade
    - auditoria
    - alucinacao
    - rastreabilidade
  contextos:
    - antes de finalizar o parecer, conferir todas as citações entre aspas
    - auditor verificando integridade do documento gerado
    - prevenção de alucinação em outputs LLM
agentes_aplicaveis:
  - auditor
fases_aplicaveis:
  - ANALISE_PRONTA
modelo_recomendado: gemini-3-pro
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1100
categoria: geracao-parecer
status: active
---

# Verificação de citações literais

## Quando usar

Use como ÚLTIMO passo antes de entregar o parecer ao analista humano. O Auditor verifica cada trecho entre aspas contra a fonte oficial (lei via tool `lei_consultar_artigo`, jurisprudência via `lei_buscar_jurisprudencia`), produzindo um relatório de fidelidade.

Esta skill é o pilar do princípio "anti-alucinação por design" do Vectorgov_t.

Não use para:
- Verificação de raciocínio jurídico (isso é função da revisão humana).
- Substituição da revisão humana (a skill complementa, não substitui).

## Critérios

Para cada citação literal:

1. **Extrair**: identificar todo trecho entre aspas duplas (`"..."`) ou simples (`'...'`) que contenha 3+ palavras e esteja seguido de referência (`Art. X`, `Acórdão Y`).
2. **Resolver fonte**: localizar o artigo/acórdão/dispositivo via tools de filesystem (`lei_consultar_artigo`, `lei_buscar_jurisprudencia` — Track D).
3. **Comparar**: normalizar pontuação, espaços, hífens e acentuação; confrontar caractere a caractere.
4. **Tolerar variações benignas**: pequenas diferenças tipográficas (`"` vs `”`), elisão indicada por `[...]`, supressão de notas de rodapé.
5. **Rejeitar variações materiais**: acréscimo/supressão de palavras alterando sentido; troca de número de artigo; mudança de quantificadores ("todos" → "alguns").

Status possíveis por citação:
- `fiel` — texto idêntico (ou variação benigna).
- `divergente_benigno` — pequenas diferenças tipográficas; manter no parecer.
- `divergente_material` — discrepância de sentido; SUBSTITUIR por trecho fiel ou retirar.
- `nao_localizado` — não foi possível resolver a fonte; PEDIR esclarecimento ao redator.
- `referencia_inexistente` — artigo/acórdão citado não existe; ERRO GRAVE, refazer seção.

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const VerificacaoCitacoesSchema = z.object({
  total_citacoes_extraidas: z.number().int().nonnegative(),
  citacoes_verificadas: z.array(z.object({
    indice: z.number().int().nonnegative(),
    trecho_no_parecer: z.string(),
    referencia_declarada: z.string(),
    fonte_oficial_localizada: z.string().nullable(),
    trecho_oficial_correspondente: z.string().nullable(),
    status: z.enum([
      "fiel",
      "divergente_benigno",
      "divergente_material",
      "nao_localizado",
      "referencia_inexistente",
    ]),
    observacao: z.string().optional(),
    sugestao_correcao: z.string().optional(),
  })),
  contagem_por_status: z.object({
    fiel: z.number().int().nonnegative(),
    divergente_benigno: z.number().int().nonnegative(),
    divergente_material: z.number().int().nonnegative(),
    nao_localizado: z.number().int().nonnegative(),
    referencia_inexistente: z.number().int().nonnegative(),
  }),
  veredicto: z.enum(["aprovado", "aprovado_com_ajustes", "reprovado"]),
  acoes_requeridas: z.array(z.string()).default([]),
});
```

## Exemplos

### Exemplo 1 — Aprovado com 1 ajuste benigno

```json
{
  "total_citacoes_extraidas": 3,
  "citacoes_verificadas": [
    {
      "indice": 0,
      "trecho_no_parecer": "sobrevierem fatos imprevisíveis, ou previsíveis porém de consequências incalculáveis",
      "referencia_declarada": "Lei 14.133/2021, Art. 124, II, 'd'",
      "fonte_oficial_localizada": "Lei 14.133/2021, Art. 124, II, 'd'",
      "trecho_oficial_correspondente": "sobrevierem fatos imprevisíveis, ou previsíveis, porém de consequências incalculáveis",
      "status": "divergente_benigno",
      "observacao": "Vírgula após 'previsíveis' ausente no parecer; sentido preservado."
    },
    {
      "indice": 1,
      "trecho_no_parecer": "recomposição do equilíbrio econômico-financeiro deve restringir-se à parcela do desequilíbrio atribuível ao fato superveniente",
      "referencia_declarada": "TCU, Acórdão 1.595/2018-Plenário",
      "fonte_oficial_localizada": "TCU, Acórdão 1.595/2018-Plenário",
      "trecho_oficial_correspondente": "recomposição do equilíbrio econômico-financeiro deve restringir-se à parcela do desequilíbrio atribuível ao fato superveniente",
      "status": "fiel"
    },
    {
      "indice": 2,
      "trecho_no_parecer": "deduzindo-se as concausas relativas a risco ordinariamente assumido pela contratada",
      "referencia_declarada": "TCU, Acórdão 1.595/2018-Plenário",
      "fonte_oficial_localizada": "TCU, Acórdão 1.595/2018-Plenário",
      "trecho_oficial_correspondente": "deduzindo-se as concausas relativas a risco ordinariamente assumido pela contratada",
      "status": "fiel"
    }
  ],
  "contagem_por_status": {
    "fiel": 2,
    "divergente_benigno": 1,
    "divergente_material": 0,
    "nao_localizado": 0,
    "referencia_inexistente": 0
  },
  "veredicto": "aprovado_com_ajustes",
  "acoes_requeridas": ["Adicionar vírgula após 'previsíveis' na citação 0."]
}
```

### Exemplo 2 — Reprovado por citação inexistente

```json
{
  "citacoes_verificadas": [
    {
      "indice": 0,
      "trecho_no_parecer": "É vedado o reequilíbrio cumulativo no mesmo exercício financeiro",
      "referencia_declarada": "Lei 14.133/2021, Art. 124, §5º",
      "fonte_oficial_localizada": null,
      "trecho_oficial_correspondente": null,
      "status": "referencia_inexistente",
      "observacao": "O Art. 124 da Lei 14.133/2021 não possui §5º. O artigo termina no §4º.",
      "sugestao_correcao": "Remover a citação. Se o autor quis se referir à vedação de aditivos consecutivos, citar o Art. 125 com fundamentação adequada."
    }
  ],
  "veredicto": "reprovado",
  "acoes_requeridas": [
    "Remover ou substituir a citação ao Art. 124, §5º (inexistente).",
    "Revisar seção 5 do parecer e ressubmeter para auditoria."
  ]
}
```

## Erros a evitar

- **Aceitar variações materiais como benignas**: troca de "deve" por "pode", supressão de "exceto", inclusão de "sempre" — todas alteram o comando normativo.
- **Aprovar quando há `referencia_inexistente`**: zero tolerância para citações fabricadas. Veredicto SEMPRE `reprovado`.
- **Confundir paráfrase com citação literal**: paráfrase (sem aspas) não passa por esta verificação; só trechos entre aspas precisam de fidelidade caractere a caractere.
- **Não consultar a fonte oficial**: a verificação visual sem tool de filesystem não conta — use sempre `lei_consultar_artigo` ou `lei_buscar_jurisprudencia`.
- **Tolerância excessiva com elisão**: `[...]` é aceitável se preserva sentido; corte que muda significado é reprovação.
- **Verificar só leis, esquecer jurisprudência**: acórdãos do TCU/STJ/STF também precisam ser confirmados — citação imprecisa de jurisprudência é tão grave quanto de lei.
