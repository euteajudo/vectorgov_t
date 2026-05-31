---
nome: analise-nexo-causal
descricao: "Avalia o nexo de causalidade entre o fato superveniente alegado e o desequilíbrio econômico-financeiro reclamado, isolando concausas e quantificando a parcela atribuível ao evento."
trigger:
  palavras_chave:
    - nexo
    - causalidade
    - causa
    - efeito
    - desequilibrio
    - impacto
    - quantificacao
    - concausa
  contextos:
    - depois de confirmar fato superveniente, medir o quanto ele explica o desequilíbrio
    - separar a parcela do impacto que vem do evento das parcelas que vêm de outras causas
    - subsidiar a decisão sobre a extensão do reequilíbrio devido
agentes_aplicaveis:
  - analista-juridico
  - especialista-reequilibrio
  - calculista
fases_aplicaveis:
  - PETICAO_EXTRAIDA
modelo_recomendado: gemini-3.5-flash
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1300
categoria: analise-peticao
status: active
---

# Análise do nexo causal

## Quando usar

Use depois de `verificacao-fato-superveniente` quando confirmado que o fato é superveniente. O nexo causal define **quanto** do desequilíbrio se atribui ao evento — sem isso, a Administração pode acabar pagando por ineficiência da contratada ou por riscos contratualmente assumidos.

Não use para:
- Reajustes automáticos por índice — o nexo já é presumido pela fórmula.
- Cálculo do valor a recompor — esse é responsabilidade do `calculista` (skill futura `calculo-recomposicao-equilibrio`).

## Critérios

Aplicar o teste das 3 dimensões:

1. **Causalidade direta**: existe ligação técnica e temporal evidente entre o fato e o aumento de custo (ex.: alta do diesel ↔ custo de transporte). Avaliar com base nos planos de custos contratuais.
2. **Causalidade exclusiva ou concorrente**: identificar concausas — outros fatores que também contribuíram para o desequilíbrio (gestão ineficiente da contratada, inadimplemento da Administração, atrasos de cronograma alheios ao fato).
3. **Quantificação do impacto atribuível**: a parcela do desequilíbrio que se atribui ao fato superveniente, em percentual e em valor. O restante NÃO entra no reequilíbrio.

Aplicar a fórmula:
```
parcela_atribuivel = impacto_total - impacto_concausas
```

Onde `impacto_concausas` agrega:
- Risco contratual assumido (deduzir).
- Ineficiência operacional comprovada (deduzir).
- Inadimplemento da Administração (NÃO deduzir do reequilíbrio — gera indenização autônoma).

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const NexoCausalSchema = z.object({
  nexo_existe: z.boolean(),
  causalidade: z.enum(["direta_exclusiva", "direta_concorrente", "indireta", "inexistente"]),
  impacto_total_reais: z.number().nonnegative(),
  concausas: z.array(z.object({
    descricao: z.string(),
    tipo: z.enum([
      "risco_contratual_assumido",
      "ineficiencia_contratada",
      "inadimplemento_administracao",
      "outro_fato_superveniente",
    ]),
    impacto_estimado_reais: z.number().nonnegative(),
    deduzir_do_reequilibrio: z.boolean(),
  })).default([]),
  parcela_atribuivel_reais: z.number().nonnegative(),
  parcela_atribuivel_pct: z.number().min(0).max(100),
  evidencias: z.array(z.string()).min(1),
  fundamentacao: z.string().min(80).max(1200),
});
```

## Exemplos

### Exemplo 1 — Causalidade direta exclusiva

Cenário: contrato de fornecimento de combustível à frota da Administração. Alta de 38% do diesel; nenhuma outra concausa identificada.

Saída (parcial):
```json
{
  "nexo_existe": true,
  "causalidade": "direta_exclusiva",
  "impacto_total_reais": 240000.00,
  "concausas": [],
  "parcela_atribuivel_reais": 240000.00,
  "parcela_atribuivel_pct": 100
}
```

### Exemplo 2 — Causalidade concorrente

Cenário: contrato de obras civis. Alta do aço de 47% (fato superveniente) + atraso na entrega de projeto pela Administração de 4 meses + planejamento de compra de aço por preço spot (decisão da contratada).

Saída (parcial):
```json
{
  "nexo_existe": true,
  "causalidade": "direta_concorrente",
  "impacto_total_reais": 580000.00,
  "concausas": [
    {
      "descricao": "Compra do aço por preço spot — política da contratada",
      "tipo": "ineficiencia_contratada",
      "impacto_estimado_reais": 90000.00,
      "deduzir_do_reequilibrio": true
    },
    {
      "descricao": "Atraso de 4 meses na entrega do projeto pela Administração",
      "tipo": "inadimplemento_administracao",
      "impacto_estimado_reais": 120000.00,
      "deduzir_do_reequilibrio": false
    }
  ],
  "parcela_atribuivel_reais": 490000.00,
  "parcela_atribuivel_pct": 84.48
}
```

(Nota: 580k - 90k = 490k; o inadimplemento da Administração gera indenização separada de 120k, não desconto do reequilíbrio.)

## Erros a evitar

- **Atribuir 100% ao fato quando há concausas**: o reequilíbrio não cobre risco assumido nem ineficiência da contratada.
- **Confundir inadimplemento da Administração com concausa que reduz reequilíbrio**: o inadimplemento da Administração GERA indenização autônoma — fundamento direto no `Art. 137, §2º, da Lei 14.133/2021` (indenização nos casos de extinção por culpa exclusiva da Administração) e/ou, supletivamente, na regra geral de responsabilidade civil objetiva do Estado (`Art. 37, §6º, da Constituição Federal`) — e NÃO deve ser descontado do valor do reequilíbrio.
- **Quantificar sem evidências**: a `evidencias` é array obrigatório com pelo menos 1 item — notas fiscais, planilhas, índices oficiais. Estimativas "de cabeça" devem ir para `concausas[].impacto_estimado_reais` apenas se houver memória de cálculo anexa.
- **Tratar correlação como causalidade**: dois eventos contemporâneos não estabelecem nexo; é preciso ligação técnica documentada.
