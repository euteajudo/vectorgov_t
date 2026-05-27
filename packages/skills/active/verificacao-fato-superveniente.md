---
nome: verificacao-fato-superveniente
descricao: "Verifica se o evento alegado pela contratada é juridicamente superveniente: posterior à assinatura, imprevisível à época, extraordinário em intensidade e extracontratual quanto à álea."
trigger:
  palavras_chave:
    - superveniente
    - imprevisivel
    - extraordinario
    - alea
    - data
    - cronologia
    - assinatura
    - posterior
  contextos:
    - analisar se o evento configura álea econômica extraordinária
    - especialista de reequilíbrio precisa testar imprevisibilidade
    - separar risco ordinário (assumido pela contratada) de risco extraordinário
agentes_aplicaveis:
  - analista-juridico
  - especialista-reequilibrio
modelo_recomendado: gemini-3.5-flash
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1200
categoria: analise-peticao
status: active
---

# Verificação de fato superveniente

## Quando usar

Use depois de `analise-admissibilidade-reequilibrio` quando a hipótese for `alea_economica_extraordinaria` ou `fato_principe`. É o "teste dos 4 elementos clássicos" da teoria da imprevisão consolidada no `Art. 124, II, "d"` da Lei 14.133/2021.

Não use para:
- Reajuste por índice — esse não exige análise de imprevisibilidade.
- Caso fortuito ou força maior naturais (enchente, pandemia) — para esses, a discussão é o nexo causal, não a imprevisibilidade (já é assumida).

## Critérios

Avaliar cumulativamente os 4 elementos. Se UM deles falhar, o fato NÃO é superveniente para fins de reequilíbrio:

1. **Posterioridade temporal**: o fato ocorreu após a assinatura do contrato (não da proposta, nem do edital). Comparar `peticao.fato_gerador.data_alegada` com `contrato.vigencia_inicio`.
2. **Imprevisibilidade à época da contratação**: um licitante diligente, considerando o cenário macroeconômico, geopolítico e setorial vigente, não poderia razoavelmente antecipar a ocorrência ou a magnitude.
3. **Extraordinariedade quanto à intensidade**: o evento foge da álea normal do setor — variações dentro do desvio histórico (ex.: oscilação cambial < 15% a.a. em mercado livre) são álea ordinária e estão na conta da contratada.
4. **Extracontratualidade**: o risco não foi alocado expressa ou implicitamente à contratada (verificar cláusulas de "risco assumido", "matriz de riscos", "fórmula paramétrica de reajuste já compensa o evento").

Sinal de alerta — fatos NÃO supervenientes típicos:
- Aumento sazonal previsível (combustíveis, commodities cíclicas).
- Variação cambial dentro de banda observada no triênio anterior.
- Mudança de alíquota tributária já em consulta pública no momento da licitação.
- Greve setorial pontual sem efeito sistêmico duradouro.

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const FatoSupervenienteSchema = z.object({
  superveniente: z.boolean(),
  elementos: z.object({
    posterioridade: z.object({
      verificado: z.boolean(),
      data_evento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      data_assinatura_contrato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dias_entre: z.number().int(),
    }),
    imprevisibilidade: z.object({
      verificado: z.boolean(),
      justificativa: z.string().min(30),
      indicadores_objetivos: z.array(z.string()),
    }),
    extraordinariedade: z.object({
      verificado: z.boolean(),
      variacao_observada_pct: z.number().optional(),
      banda_historica_pct: z.number().optional(),
      justificativa: z.string().min(30),
    }),
    extracontratualidade: z.object({
      verificado: z.boolean(),
      clausula_de_risco_aplicavel: z.string().nullable(),
      justificativa: z.string().min(30),
    }),
  }),
  fundamentacao: z.string().min(80).max(1000),
});
```

## Exemplos

### Exemplo 1 — Superveniente (guerra causando explosão do diesel)

Cenário: contrato de transporte assinado em 2024-08; em 2026-02 conflito geopolítico eleva o diesel em 38% (banda histórica trienal: ±9%).

Saída (parcial):
```json
{
  "superveniente": true,
  "elementos": {
    "extraordinariedade": {
      "verificado": true,
      "variacao_observada_pct": 38,
      "banda_historica_pct": 9
    }
  }
}
```

### Exemplo 2 — Não superveniente (variação cambial ordinária)

Cenário: contrato de aquisição de equipamento importado; dólar variou 11% em 8 meses (banda histórica 5 anos: ±15%); contrato tem fórmula paramétrica cambial.

Saída (parcial):
```json
{
  "superveniente": false,
  "elementos": {
    "extraordinariedade": {
      "verificado": false,
      "variacao_observada_pct": 11,
      "banda_historica_pct": 15,
      "justificativa": "Variação dentro da banda histórica trienal/quinquenal — álea ordinária."
    },
    "extracontratualidade": {
      "verificado": false,
      "clausula_de_risco_aplicavel": "Cláusula 9.4 — fórmula paramétrica cambial",
      "justificativa": "O risco cambial está alocado pela própria fórmula contratual."
    }
  }
}
```

### Exemplo 3 — Superveniente (transição tributária IBS/CBS)

Cenário: contrato administrativo firmado em 2025 (regime ICMS/ISS/PIS/COFINS). Em 2026, entra em vigor a CBS (`EC 132/2023`, regulamentada pela `LC 214/2025`), alterando a carga tributária incidente sobre o objeto contratado em magnitude que extrapola a álea ordinária. O contrato não previu cláusula específica de neutralidade tributária para a transição.

Saída (parcial):
```json
{
  "superveniente": true,
  "elementos": {
    "posterioridade": {
      "verificado": true,
      "data_evento": "2026-01-01",
      "data_assinatura_contrato": "2025-04-10",
      "dias_entre": 266
    },
    "imprevisibilidade": {
      "verificado": true,
      "justificativa": "Embora a EC 132/2023 já estivesse promulgada à época da contratação, a regulamentação infraconstitucional (LC 214/2025) só foi editada após a assinatura, fixando alíquotas e regras de transição em patamar não antecipável objetivamente.",
      "indicadores_objetivos": [
        "Promulgação da LC 214/2025 posterior ao contrato",
        "Ausência de minuta consolidada na data da licitação"
      ]
    },
    "extraordinariedade": {
      "verificado": true,
      "justificativa": "Alteração estrutural do sistema tributário extrapola a álea ordinária prevista no Art. 124, II, 'd', combinada com o Art. 195, V, da CF (incluído pela EC 132/2023)."
    },
    "extracontratualidade": {
      "verificado": true,
      "clausula_de_risco_aplicavel": null,
      "justificativa": "O contrato não atribui à contratada o risco de mudança de regime tributário decorrente da Reforma Tributária."
    }
  },
  "fundamentacao": "Caracteriza-se fato superveniente apto a ensejar reequilíbrio: Art. 124, II, 'd', da Lei 14.133/2021, combinado com a EC 132/2023 (Art. 195, V, CF) e a LC 214/2025, que instituiu a CBS e seu regime de transição."
}
```

## Erros a evitar

- **Posterioridade contra a data da proposta**: o marco é a assinatura do contrato, não a apresentação da proposta nem o edital.
- **Confundir imprevisibilidade com surpresa subjetiva da contratada**: o critério é objetivo (um licitante diligente).
- **Ignorar a matriz de riscos**: contratos firmados sob a Lei 14.133/2021 frequentemente têm matriz de riscos explícita (disciplinada nos `§§3º a 5º do Art. 22` da Lei 14.133/2021) — se o risco está lá alocado à contratada, não há extracontratualidade.
- **Usar variação nominal sem deflator**: comparar 38% de aumento em ano de alta inflação ignorando o deflator distorce a análise — sempre confrontar com banda histórica em termos reais.
