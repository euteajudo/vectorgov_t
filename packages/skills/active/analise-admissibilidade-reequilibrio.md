---
nome: analise-admissibilidade-reequilibrio
descricao: "Avalia se um pedido de reequilíbrio econômico-financeiro satisfaz os requisitos formais e materiais mínimos para conhecimento (legitimidade, interesse, prova mínima e enquadramento em Art. 124, II, 'd' da Lei 14.133/2021)."
trigger:
  palavras_chave:
    - admissibilidade
    - conhecimento
    - cabimento
    - requisitos
    - reequilibrio
    - juizo
    - preliminar
  contextos:
    - especialista de reequilíbrio recebeu petição extraída
    - analista jurídico precisa decidir conhecer ou não conhecer
    - antes de mérito é preciso filtrar pedidos sem requisitos
agentes_aplicaveis:
  - analista-juridico
  - especialista-reequilibrio
modelo_recomendado: gemini-3.5-flash
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1300
categoria: analise-peticao
status: active
---

# Admissibilidade do pedido de reequilíbrio

## Quando usar

Use logo após `extracao-estruturada-peticao`, quando o `tipo_pleito` for `reequilibrio_fato_superveniente`, `revisao` ou `repactuacao`. Esta skill responde a uma pergunta binária ("o pedido pode ser conhecido?") + lista pendências formais.

Não use para:
- Reajustes por índice contratual (estes seguem rito automático — `Art. 134` da Lei 14.133/2021).
- Análise de mérito (use `analise-nexo-causal`, `verificacao-fato-superveniente`).

## Critérios

Verificar, em ordem, os 5 requisitos:

1. **Legitimidade ativa**: requerente é a contratada (ou consórcio contratado, ou cessionário com anuência). Subcontratado não tem legitimidade.
2. **Interesse processual**: o contrato está vigente OU encerrado há menos do prazo prescricional quinquenal contra a Fazenda Pública (`Decreto 20.910/1932`). O `Art. 137 da Lei 14.133/2021` cuida de **motivos de extinção contratual** e não fundamenta o prazo de prescrição.
3. **Prova mínima do fato gerador**: documentos demonstrando (a) ocorrência objetiva do fato, (b) cronologia (data antes do desequilíbrio), (c) externalidade (fato alheio à conduta da contratada).
4. **Prova mínima do impacto econômico**: planilha analítica de custos OU laudo técnico OU índices oficiais aplicáveis ao objeto.
5. **Enquadramento legal**: o fato narrado se subsume a alguma hipótese do `Art. 124, II, 'd'` da Lei 14.133/2021 — força maior, caso fortuito, fato do príncipe, fato da administração, ou álea econômica extraordinária e extracontratual.

Conclusão possível:
- **CONHECER** — todos os 5 requisitos atendidos.
- **CONHECER COM RESSALVAS** — requisitos 1-2-5 atendidos; 3 ou 4 com lacunas sanáveis (intimar para complementar).
- **NÃO CONHECER** — falha em 1, 2 ou 5 (insanável).

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const AdmissibilidadeSchema = z.object({
  conclusao: z.enum(["conhecer", "conhecer_com_ressalvas", "nao_conhecer"]),
  requisitos: z.object({
    legitimidade_ativa: z.object({
      atendido: z.boolean(),
      observacao: z.string().optional(),
    }),
    interesse_processual: z.object({
      atendido: z.boolean(),
      observacao: z.string().optional(),
    }),
    prova_minima_fato: z.object({
      atendido: z.boolean(),
      observacao: z.string().optional(),
      pendencias: z.array(z.string()).default([]),
    }),
    prova_minima_impacto: z.object({
      atendido: z.boolean(),
      observacao: z.string().optional(),
      pendencias: z.array(z.string()).default([]),
    }),
    enquadramento_legal: z.object({
      atendido: z.boolean(),
      hipotese_aplicavel: z.enum([
        "forca_maior",
        "caso_fortuito",
        "fato_principe",
        "fato_administracao",
        "alea_economica_extraordinaria",
        "nao_se_aplica",
      ]),
      dispositivo: z.string(),
    }),
  }),
  diligencias_recomendadas: z.array(z.string()).default([]),
  fundamentacao_sumaria: z.string().min(50).max(800),
});
```

## Exemplos

### Exemplo 1 — Conhecer com ressalvas

Cenário: contratada legítima, contrato vigente, fato bem narrado (alta do aço), mas planilha de custos não veio assinada por engenheiro responsável.

Saída (parcial):
```json
{
  "conclusao": "conhecer_com_ressalvas",
  "requisitos": {
    "prova_minima_impacto": {
      "atendido": false,
      "pendencias": ["Planilha de custos sem ART do engenheiro responsável"]
    }
  },
  "diligencias_recomendadas": [
    "Intimar a contratada para juntar ART do engenheiro responsável pela planilha analítica, no prazo de 10 dias."
  ]
}
```

### Exemplo 2 — Não conhecer (ilegitimidade)

Cenário: requerente é subcontratada, não a contratada principal.

Saída (parcial):
```json
{
  "conclusao": "nao_conhecer",
  "requisitos": {
    "legitimidade_ativa": {
      "atendido": false,
      "observacao": "Requerente é subcontratada (Empresa X Ltda) e não a contratada principal (Y S.A.). Subcontratada não detém vínculo direto com a Administração."
    }
  }
}
```

## Erros a evitar

- **Confundir conhecimento com procedência**: admissibilidade é juízo formal; mérito vem depois.
- **Exigir prova plena na admissibilidade**: o filtro é `prova mínima`, não certeza absoluta.
- **Esquecer prescrição**: o prazo quinquenal do `Decreto 20.910/1932` corre da data do fato gerador, não do protocolo do pedido — calcular a partir da data informada em `peticao.fato_gerador.data_alegada`. Não confundir com o `Art. 137 da Lei 14.133/2021`, que trata de extinção contratual.
- **Tratar reajuste como reequilíbrio**: reajuste por IPCA/IGPM é rito do `Art. 134`; aqui só entra revisão por álea extraordinária.
- **Citar a Lei 8.666/93**: contratos firmados sob a Lei 14.133/2021 não admitem fundamentação em diploma revogado, salvo para contratos remanescentes do regime anterior (regra de transição).
