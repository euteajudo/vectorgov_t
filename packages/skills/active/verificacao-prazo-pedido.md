---
nome: verificacao-prazo-pedido
descricao: "Verifica o cumprimento dos prazos legais e contratuais para protocolo do pedido de reequilíbrio: prescrição quinquenal contra a Fazenda Pública (Decreto 20.910/1932), prazos contratuais específicos e marco inicial."
trigger:
  palavras_chave:
    - prazo
    - prescricao
    - decadencia
    - protocolo
    - termo
    - quinquenal
    - tempestividade
  contextos:
    - decidir se o pedido foi protocolado dentro do prazo
    - calcular dies a quo da prescrição
    - verificar cláusulas contratuais de prazo (notificação prévia, etc.)
agentes_aplicaveis:
  - analista-juridico
  - especialista-reequilibrio
fases_aplicaveis:
  - PETICAO_EXTRAIDA
modelo_recomendado: gemini-3.5-flash
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1100
categoria: analise-peticao
status: active
---

# Verificação de prazo do pedido

## Quando usar

Use junto com `analise-admissibilidade-reequilibrio` — a tempestividade é um dos requisitos formais. Esta skill detalha o cálculo do dies a quo e a interação entre prazo prescricional legal e prazos contratuais.

Não use para:
- Prazos processuais judiciais (intimação, recurso) — esses seguem o CPC.
- Prazos de execução do contrato (atrasos, sanções) — usar `controle-sancoes-administrativas`.

## Critérios

Aplicar os 3 marcos em sequência:

1. **Marco contratual**: o contrato exige notificação prévia em prazo específico (ex.: 30 dias do conhecimento)? Se sim, o pedido também precisa atender essa janela.
2. **Marco prescricional legal**: `Decreto 20.910/1932` (prescrição quinquenal de toda e qualquer pretensão contra a Fazenda Pública) — prescreve em 5 anos contados da data em que o credor poderia exigir o direito (em geral, a data do fato gerador, salvo se a contratada só pudesse conhecer o impacto posteriormente). Observação: o `Art. 137 da Lei 14.133/2021` cuida de **motivos de extinção contratual**, não de prescrição — não confundir.
3. **Marco contratual de extinção**: se o contrato já se extinguiu (vide hipóteses do `Art. 137 da Lei 14.133/2021`), o pedido ainda é cabível dentro da prescrição quinquenal do Decreto 20.910/1932, mas com regime de execução por cobrança ordinária, não revisão contratual stricto sensu.

Aplicar a fórmula:
```
dies_a_quo = max(data_fato_gerador, data_conhecimento_inequivoco)
prazo_legal_fim = dies_a_quo + 5 anos
prazo_contratual_fim = data_conhecimento + prazo_clausula_notificacao
```

Conclusão:
- **TEMPESTIVO** — protocolado antes de TODOS os marcos.
- **INTEMPESTIVO** — protocolado depois de qualquer marco insuperável.
- **DUVIDOSO** — dies a quo controverso (ex.: o impacto só se materializou meses depois do fato gerador).

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const VerificacaoPrazoSchema = z.object({
  conclusao: z.enum(["tempestivo", "intempestivo", "duvidoso"]),
  marcos: z.object({
    data_fato_gerador: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    data_conhecimento_inequivoco: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    data_protocolo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dies_a_quo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  prazo_prescricional: z.object({
    fundamento_legal: z.string().describe(
      "Ex.: 'Decreto 20.910/1932' (prescrição quinquenal contra a Fazenda); " +
      "'Art. 137 da Lei 14.133/2021' aplica-se a hipóteses de extinção contratual, não de prescrição."
    ),
    duracao_anos: z.number().int().positive().default(5),
    fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dias_restantes_no_protocolo: z.number().int(),
  }),
  prazo_contratual: z.object({
    aplicavel: z.boolean(),
    clausula: z.string().optional(),
    duracao_dias: z.number().int().optional(),
    fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cumprido: z.boolean().optional(),
  }),
  fundamentacao: z.string().min(80).max(800),
});
```

## Exemplos

### Exemplo 1 — Tempestivo dentro do quinquenal

Cenário: fato gerador em 2024-03-15; protocolo em 2026-05-01; sem cláusula contratual de notificação prévia.

Saída (parcial):
```json
{
  "conclusao": "tempestivo",
  "marcos": {
    "data_fato_gerador": "2024-03-15",
    "data_protocolo": "2026-05-01",
    "dies_a_quo": "2024-03-15"
  },
  "prazo_prescricional": {
    "fundamento_legal": "Decreto 20.910/1932 (prescrição quinquenal contra a Fazenda Pública)",
    "duracao_anos": 5,
    "fim": "2029-03-15",
    "dias_restantes_no_protocolo": 1049
  }
}
```

### Exemplo 2 — Intempestivo por cláusula contratual

Cenário: contrato exige notificação em 60 dias do conhecimento; conhecimento em 2025-12-01; protocolo em 2026-05-01 (151 dias depois).

Saída (parcial):
```json
{
  "conclusao": "intempestivo",
  "prazo_contratual": {
    "aplicavel": true,
    "clausula": "Cláusula 11.3 — notificação em 60 dias do conhecimento",
    "duracao_dias": 60,
    "fim": "2026-01-30",
    "cumprido": false
  },
  "fundamentacao": "Embora dentro da prescrição quinquenal, o protocolo violou a cláusula 11.3, que exige notificação em 60 dias do conhecimento (que se deu em 2025-12-01). Sem ressalva expressa na petição justificando a inobservância, opera a preclusão consensual."
}
```

## Erros a evitar

- **Confundir dies a quo do fato com dies a quo do conhecimento**: para impactos diferidos (ex.: alta de combustível só se materializa nos meses seguintes), o `dies_a_quo` é o conhecimento inequívoco, não o evento puro.
- **Ignorar cláusulas de notificação prévia**: contratos administrativos modernos frequentemente impõem prazos contratuais menores que o quinquenal — descumprí-los gera preclusão.
- **Confundir prescrição com extinção contratual**: o `Decreto 20.910/1932` é o fundamento da prescrição quinquenal contra a Fazenda Pública. O `Art. 137 da Lei 14.133/2021` trata de **motivos de extinção** do contrato — usá-lo como base prescricional é erro técnico.
- **Calcular o prazo em dias úteis**: prescrição civil/administrativa conta dias corridos.
- **Confundir prescrição com decadência**: o direito ao reequilíbrio é de natureza patrimonial e prescreve; não há decadência aplicável.
