---
nome: redacao-fundamentacao-juridica
descricao: "Redige a seção de fundamentação jurídica do parecer: aplicação da Lei 14.133/2021 e diplomas correlatos (LC 214/2025, EC 132/2023, Decretos), enquadramento dos fatos e síntese argumentativa."
trigger:
  palavras_chave:
    - fundamentacao
    - juridica
    - enquadramento
    - dispositivos
    - aplicacao
    - subsuncao
    - argumentacao
  contextos:
    - escrever a seção 5 do parecer após relatório
    - aplicar a lei ao caso concreto
    - construir o raciocínio que sustenta a conclusão
agentes_aplicaveis:
  - redator
  - analista-juridico
fases_aplicaveis:
  - ANALISE_PRONTA
modelo_recomendado: gemini-3-pro
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1500
categoria: geracao-parecer
status: active
---

# Redação da fundamentação jurídica

## Quando usar

Use depois de `redacao-relatorio-fatos` e quando todas as análises técnicas (admissibilidade, superveniência, nexo causal, prazo) estão concluídas. Esta seção é o "coração argumentativo" do parecer — recomenda-se modelo Pro pela exigência de precisão dogmática.

Não use para:
- Relatório de fatos (seção 3) — sem direito.
- Conclusão (seção 6) — síntese, não argumentação plena.

## Critérios

A fundamentação obedece a 5 movimentos argumentativos:

1. **Marco normativo**: identificar o(s) regime(s) jurídico(s) aplicável(is). Para reequilíbrio em contrato da Lei 14.133/2021: `Art. 124, II, "d"` (reequilíbrio), `Art. 134` (reajuste por índice), `Art. 135` (repactuação). Para dimensão tributária: `EC 132/2023`, `LC 214/2025` (IBS/CBS), regras de transição.
2. **Subsunção do fato à norma**: para cada elemento do enquadramento, dizer porque o caso concreto preenche (ou não) a hipótese normativa.
3. **Análise dos requisitos materiais**: percorrer os 4 elementos do fato superveniente (posterioridade, imprevisibilidade, extraordinariedade, extracontratualidade) com base na análise técnica das skills anteriores.
4. **Análise do nexo causal e quantificação**: aplicar o teste das concausas; explicitar a parcela atribuível.
5. **Citação de jurisprudência e doutrina**: TCU (acórdãos paradigma) sempre que pertinente; STJ/STF quando aplicável; doutrina majoritária (Carvalho Filho, Marçal Justen Filho, Egon Bockmann) só quando agregar.

Regras de formatação:
- Citações literais sempre entre aspas + nota com `(Lei 14.133/2021, Art. X)` ou `(TCU, Acórdão Y/AAAA-Plenário)`.
- Em caso de divergência entre TCU e STJ, registrar a divergência e adotar uma posição motivada.
- Dispositivos legais grafados por extenso na primeira menção (`Art. 124, inciso II, alínea "d"`) e abreviados na sequência (`Art. 124, II, d`).
- NUNCA citar dispositivo sem verificar redação atual (delegar verificação à skill `verificacao-citacoes-literais`).

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const FundamentacaoJuridicaSchema = z.object({
  marco_normativo: z.object({
    diplomas_principais: z.array(z.string()),
    dispositivos_chave: z.array(z.object({
      diploma: z.string(),
      artigo: z.string(),
      relevancia: z.string(),
    })),
  }),
  movimentos: z.array(z.object({
    titulo: z.enum([
      "subsuncao",
      "requisitos_materiais",
      "nexo_causal_quantificacao",
      "jurisprudencia",
      "doutrina",
    ]),
    texto: z.string().min(150).max(2500),
    citacoes: z.array(z.object({
      tipo: z.enum(["lei", "decreto", "acordao_tcu", "acordao_stj", "acordao_stf", "doutrina"]),
      referencia: z.string(),
      trecho_literal: z.string().optional(),
    })),
  })).min(2).max(8),
  sintese_argumentativa: z.string().min(200).max(800),
});
```

## Exemplos

### Exemplo 1 — Trecho de subsunção (reequilíbrio acolhido parcialmente)

```json
{
  "movimentos": [
    {
      "titulo": "subsuncao",
      "texto": "A petição enquadra-se no Art. 124, II, 'd', da Lei 14.133/2021, que admite a alteração contratual \"para restabelecer o equilíbrio econômico-financeiro inicial do contrato em caso de força maior, caso fortuito ou fato do príncipe ou em decorrência de fatos imprevisíveis ou previsíveis de consequências incalculáveis, retardadores ou impeditivos da execução do ajustado, ou ainda em caso de impedimento de sua execução por fato ou ato de terceiro reconhecido pela Administração em documento contemporâneo à sua ocorrência\". Conforme construção doutrinária consolidada (Marçal Justen Filho, Egon Bockmann), o dispositivo abriga a chamada \"álea econômica extraordinária e extracontratual\". Os autos demonstram (i) posterioridade do fato (elevação do aço a partir de jan/2026, contrato assinado em mar/2024); (ii) imprevisibilidade objetiva (variação trienal média do INPC-construção: ±9%; variação observada: 47%); (iii) extraordinariedade (excede em mais de 5x a banda histórica); e (iv) extracontratualidade (a matriz de riscos do Anexo III do contrato não aloca o risco de alta extraordinária de aço à contratada).",
      "citacoes": [
        {
          "tipo": "lei",
          "referencia": "Lei 14.133/2021, Art. 124, II, 'd'",
          "trecho_literal": "para restabelecer o equilíbrio econômico-financeiro inicial do contrato em caso de força maior, caso fortuito ou fato do príncipe ou em decorrência de fatos imprevisíveis ou previsíveis de consequências incalculáveis, retardadores ou impeditivos da execução do ajustado, ou ainda em caso de impedimento de sua execução por fato ou ato de terceiro reconhecido pela Administração em documento contemporâneo à sua ocorrência"
        }
      ]
    }
  ]
}
```

### Exemplo 2 — Movimento de jurisprudência

> Aviso: os Acórdãos do TCU citados a seguir (1.595/2018-Plenário e 2.860/2023-Plenário) são **exemplos hipotéticos meramente ilustrativos da estrutura argumentativa esperada** — devem ser substituídos por jurisprudência confirmada (via skill `verificacao-citacoes-literais` + tools `buscar_acordaos_tcu` para achar precedentes e `buscar_acordaos_lexical` para confirmar o texto exato) antes de qualquer uso em produção.

```json
{
  "movimentos": [
    {
      "titulo": "jurisprudencia",
      "texto": "O Tribunal de Contas da União, no Acórdão 1.595/2018-Plenário, fixou que \"a recomposição do equilíbrio econômico-financeiro deve restringir-se à parcela do desequilíbrio atribuível ao fato superveniente, deduzindo-se as concausas relativas a risco ordinariamente assumido pela contratada\". O entendimento foi reafirmado no Acórdão 2.860/2023-Plenário e é diretamente aplicável ao caso.",
      "citacoes": [
        {
          "tipo": "acordao_tcu",
          "referencia": "TCU, Acórdão 1.595/2018-Plenário",
          "trecho_literal": "a recomposição do equilíbrio econômico-financeiro deve restringir-se à parcela do desequilíbrio atribuível ao fato superveniente, deduzindo-se as concausas relativas a risco ordinariamente assumido pela contratada"
        },
        {
          "tipo": "acordao_tcu",
          "referencia": "TCU, Acórdão 2.860/2023-Plenário"
        }
      ]
    }
  ]
}
```

> Lembrete: substituir os Acórdãos 1.595/2018-Plenário e 2.860/2023-Plenário por jurisprudência confirmada antes do uso em produção.

## Erros a evitar

- **Citar dispositivos inexistentes ou com redação errada**: cada citação literal precisa ser passada por `verificacao-citacoes-literais` antes da finalização.
- **Fundamentar apenas em doutrina**: doutrina é acessória; o eixo é a lei + jurisprudência.
- **Mencionar a Lei 8.666/93 em contrato da Lei 14.133/2021**: erro grosseiro, salvo regra de transição expressa.
- **Subsumir genericamente ("o caso se enquadra na lei")**: a subsunção precisa percorrer cada elemento do tipo legal.
- **Ignorar a matriz de riscos do contrato**: contratos sob a Lei 14.133/2021 frequentemente têm matriz de riscos (disciplinada nos §§3º a 5º do Art. 22 da Lei 14.133/2021) que altera o resultado da extracontratualidade.
- **Citar a EC 132/2023 ou LC 214/2025 sem dimensão tributária no caso**: estes só se aplicam quando o fato gerador envolver mudança de regime IBS/CBS, alíquota, ou regra de transição tributária.
