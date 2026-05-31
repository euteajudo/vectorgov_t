---
nome: redacao-conclusao-recomendacoes
descricao: "Redige as seções de conclusão e recomendações operacionais do parecer: manifestação clara (favorável/desfavorável/parcial) e lista de providências a serem adotadas pela Administração."
trigger:
  palavras_chave:
    - conclusao
    - dispositivo
    - manifestacao
    - opinativo
    - recomendacoes
    - providencias
    - encaminhamento
  contextos:
    - escrever as seções 6 e 7 do parecer
    - converter análise técnica em ato administrativo recomendado
    - listar diligências e comunicações necessárias
agentes_aplicaveis:
  - redator
fases_aplicaveis:
  - ANALISE_PRONTA
modelo_recomendado: gemini-3.5-flash
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1100
categoria: geracao-parecer
status: active
---

# Redação da conclusão e recomendações

## Quando usar

Use como última etapa de redação do parecer, depois de `redacao-fundamentacao-juridica`. Esta skill cobre as seções 6 (conclusão) e 7 (recomendações operacionais).

Não use para:
- Resumir o relatório (isso é função da ementa).
- Substituir a fundamentação — a conclusão NÃO repete argumentos, só sintetiza o veredito.

## Critérios

A conclusão (seção 6) tem 3 elementos obrigatórios:

1. **Verbo opinativo claro**: "opina-se pelo deferimento parcial", "opina-se pelo indeferimento", "recomenda-se a abertura de diligência prévia".
2. **Objeto preciso**: o que se está acolhendo/rejeitando — não basta "favorável ao pedido"; tem que ser "favorável ao reequilíbrio parcial no valor de R$ X, decorrente da alta do aço CA-50 em jan-mar/2026".
3. **Fundamento sumário**: 1-2 frases citando a base normativa principal (`nos termos do Art. 124, II, "d", da Lei 14.133/2021, combinado com a planilha técnica de fls. 161-178`).

As recomendações operacionais (seção 7) listam atos a praticar, na ordem cronológica:

- **Diligências**: pedidos de complementação documental, oitivas, perícias.
- **Atos contratuais**: termo aditivo, glosa, indenização autônoma.
- **Comunicações**: ciência ao fiscal, à contratada, ao controle interno, ao TCU/TCE quando aplicável.
- **Marcos temporais**: prazos para cumprimento de cada providência.

Manifestações possíveis na conclusão:
- `deferimento_total`
- `deferimento_parcial`
- `indeferimento`
- `conversao_em_diligencia`
- `nao_conhecimento`

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const ConclusaoRecomendacoesSchema = z.object({
  conclusao: z.object({
    manifestacao: z.enum([
      "deferimento_total",
      "deferimento_parcial",
      "indeferimento",
      "conversao_em_diligencia",
      "nao_conhecimento",
    ]),
    objeto: z.string().min(30).max(500),
    fundamento_sumario: z.array(z.string()).min(1).max(5),
    valor_recomendado_reais: z.number().nonnegative().optional(),
    texto_final: z.string().min(100).max(600),
  }),
  recomendacoes: z.array(z.object({
    ordem: z.number().int().positive(),
    tipo: z.enum(["diligencia", "ato_contratual", "comunicacao", "registro_controle"]),
    descricao: z.string().min(20).max(400),
    prazo_dias: z.number().int().positive().optional(),
    responsavel: z.string(),
  })).min(1),
});
```

## Exemplos

### Exemplo 1 — Deferimento parcial com valor

```json
{
  "conclusao": {
    "manifestacao": "deferimento_parcial",
    "objeto": "Recomposição parcial do equilíbrio econômico-financeiro do Contrato 047/2024 no valor de R$ 490.000,00, decorrente da elevação extraordinária do preço do aço CA-50 entre janeiro e março/2026.",
    "fundamento_sumario": [
      "Art. 124, II, 'd', da Lei 14.133/2021",
      "TCU, Acórdão 1.595/2018-Plenário",
      "Planilha analítica de fls. 161-178 e Nota Técnica do fiscal de fls. 200-205"
    ],
    "valor_recomendado_reais": 490000.00,
    "texto_final": "Ante o exposto, opina-se pelo DEFERIMENTO PARCIAL do pedido formulado pela Construtora Alfa Ltda., para reconhecer o direito à recomposição do equilíbrio econômico-financeiro do Contrato Administrativo nº 047/2024 no valor de R$ 490.000,00 (quatrocentos e noventa mil reais), nos termos do Art. 124, inciso II, alínea 'd', da Lei nº 14.133/2021, deduzida a parcela de R$ 90.000,00 atribuível à política de compra spot da contratada (ineficiência operacional)."
  },
  "recomendacoes": [
    {
      "ordem": 1,
      "tipo": "ato_contratual",
      "descricao": "Lavrar termo aditivo ao Contrato 047/2024 formalizando a recomposição de R$ 490.000,00, com nova planilha de preços anexa e nova data-base.",
      "prazo_dias": 30,
      "responsavel": "Gestor do contrato"
    },
    {
      "ordem": 2,
      "tipo": "comunicacao",
      "descricao": "Cientificar a contratada da glosa de R$ 90.000,00 referente à parcela atribuível à ineficiência operacional, abrindo prazo recursal de 3 dias úteis (Art. 165 da Lei 14.133/2021 — recurso administrativo).",
      "prazo_dias": 3,
      "responsavel": "Setor de contratos"
    },
    {
      "ordem": 3,
      "tipo": "registro_controle",
      "descricao": "Registrar o ato no sistema de governança contratual e encaminhar cópia ao controle interno do órgão para acompanhamento.",
      "prazo_dias": 10,
      "responsavel": "Coordenação de licitações"
    }
  ]
}
```

### Exemplo 2 — Indeferimento (intempestividade)

```json
{
  "conclusao": {
    "manifestacao": "indeferimento",
    "objeto": "Pedido de reequilíbrio econômico-financeiro intempestivo, por violação da cláusula 11.3 (notificação em 60 dias do conhecimento).",
    "fundamento_sumario": [
      "Cláusula 11.3 do Contrato 047/2024",
      "Princípio da preclusão consensual"
    ],
    "texto_final": "Ante o exposto, opina-se pelo INDEFERIMENTO do pedido, em razão de sua intempestividade, sem prejuízo de reapreciação caso a contratada apresente justificativa idônea para a inobservância do prazo contratual."
  },
  "recomendacoes": [
    {
      "ordem": 1,
      "tipo": "comunicacao",
      "descricao": "Notificar a contratada da decisão, com abertura de prazo recursal de 3 dias úteis (Art. 165 da Lei 14.133/2021 — recurso administrativo).",
      "prazo_dias": 3,
      "responsavel": "Setor de contratos"
    }
  ]
}
```

## Erros a evitar

- **Conclusão genérica ("opina-se pela legalidade")**: tem que indicar o ato concreto recomendado.
- **Recomendar termo aditivo sem definir o valor**: a Administração não pode lavrar aditivo "em branco".
- **Esquecer prazo recursal da contratada**: o `Art. 165` da Lei 14.133/2021 disciplina o recurso administrativo (em regra, 3 dias úteis — conferir se há hipóteses especiais aplicáveis ao caso); o parecer deve sinalizar a abertura do prazo. Atenção: o `Art. 168` trata de **impugnação ao edital**, não de recurso administrativo contra decisão de execução contratual.
- **Misturar conclusão com fundamentação**: a conclusão sintetiza, não argumenta. Argumentação ficou na seção 5.
- **Recomendar ao TCU quando não há valor relevante**: nem todo aditivo demanda comunicação automática ao Tribunal de Contas — verificar o regimento local.
- **Confundir indeferimento de mérito com não-conhecimento**: se falhou requisito formal (legitimidade, prazo), é `nao_conhecimento`; se falhou mérito (não há fato superveniente), é `indeferimento`.
