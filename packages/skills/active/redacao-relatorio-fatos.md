---
nome: redacao-relatorio-fatos
descricao: "Redige a seção de relatório de fatos do parecer: narrativa cronológica neutra, com referência a volumes/folhas, sem juízo de valor nem opiniões."
trigger:
  palavras_chave:
    - relatorio
    - fatos
    - narrativa
    - cronologia
    - historico
    - sintese
  contextos:
    - escrever a seção 3 do parecer técnico-jurídico
    - resumir o histórico processual para o leitor
    - separar fatos de fundamentação
agentes_aplicaveis:
  - redator
modelo_recomendado: gemini-3.5-flash
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1100
categoria: geracao-parecer
status: active
---

# Redação do relatório de fatos

## Quando usar

Use depois que a estrutura do parecer está definida (skill `estrutura-parecer-tecnico-juridico`) e há um dossiê com a petição extraída + documentos relevantes. O resultado é a seção 3 do parecer.

Não use para:
- Seção de fundamentação (use `redacao-fundamentacao-juridica`) — relatório NÃO tem enquadramento legal.
- Cabeçalho ou ementa — formatos próprios.

## Critérios

A redação obedece a 6 princípios:

1. **Cronologia estrita**: do fato mais antigo ao mais recente. Datas no formato `DD/MM/AAAA` ou `mês/AAAA` quando o dia não for relevante.
2. **Neutralidade**: usar "alega", "afirma", "consta", "consigna-se" — nunca "ficou comprovado", "evidentemente", "claramente".
3. **Síntese factual**: 1 parágrafo por evento relevante, máximo de ~80 palavras cada. Manter apenas o essencial para a fundamentação subsequente.
4. **Referenciar volumes/folhas** sempre que invocar documento: `(fls. 12-17 do vol. I)` ou `(documento "Anexo III", evento 23)`.
5. **Verbos no presente do indicativo** ou pretérito perfeito — nunca futuro nem condicional.
6. **Linguagem impessoal**: nada de "nós analisamos", "entendo que" — esta seção é narrativa, opinião vem só na fundamentação.

Estrutura interna recomendada:
- Parágrafo 1: identificação sucinta do feito ("Trata-se de pedido de reequilíbrio...").
- Parágrafos 2-N: cronologia (assinatura → fato gerador → impacto → protocolo → diligências cumpridas).
- Parágrafo final: estado atual do processo ("Vieram os autos para parecer.").

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const RelatorioFatosSchema = z.object({
  paragrafos: z.array(z.object({
    ordem: z.number().int().positive(),
    texto: z.string().min(40).max(800),
    referencias_processuais: z.array(z.string()).default([]),
  })).min(3).max(15),
  cronologia_chave: z.array(z.object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    evento: z.string(),
  })),
  contagem_palavras: z.number().int().positive(),
});
```

## Exemplos

### Exemplo 1 — Relatório curto (3 parágrafos)

```json
{
  "paragrafos": [
    {
      "ordem": 1,
      "texto": "Trata-se de pedido de reequilíbrio econômico-financeiro formulado pela Construtora Alfa Ltda. (CNPJ 12.345.678/0001-90), contratada para a execução do Contrato Administrativo nº 047/2024 (fls. 03-25 do vol. I), com vigência de 12/03/2024 a 12/03/2027.",
      "referencias_processuais": ["fls. 03-25 vol. I"]
    },
    {
      "ordem": 2,
      "texto": "Em 15/03/2026, a contratada apresentou petição (fls. 145-160 do vol. II) alegando elevação extraordinária de 47% no preço do aço CA-50 entre janeiro e março/2026, com impacto estimado em R$ 580.000,00 sobre o saldo remanescente do contrato. Junta planilha analítica de custos com ART do engenheiro responsável (fls. 161-178) e índices setoriais do INPC-construção (fls. 179-185).",
      "referencias_processuais": ["fls. 145-160 vol. II", "fls. 161-178", "fls. 179-185"]
    },
    {
      "ordem": 3,
      "texto": "O fiscal do contrato emitiu nota técnica em 05/04/2026 (fls. 200-205) reconhecendo a variação alegada com base no relatório setorial do CBIC, e remeteu os autos para parecer jurídico-tributário. Vieram os autos para parecer.",
      "referencias_processuais": ["fls. 200-205"]
    }
  ],
  "cronologia_chave": [
    { "data": "2024-03-12", "evento": "Assinatura do Contrato 047/2024" },
    { "data": "2026-01-01", "evento": "Início da elevação do preço do aço" },
    { "data": "2026-03-15", "evento": "Protocolo do pedido de reequilíbrio" },
    { "data": "2026-04-05", "evento": "Nota técnica do fiscal" }
  ],
  "contagem_palavras": 187
}
```

## Erros a evitar

- **Antecipar a conclusão**: "embora insuficiente, a contratada alega..." — o "insuficiente" é juízo, vai para fundamentação.
- **Citar dispositivos legais aqui**: relatório é factual. Os dispositivos aparecem na fundamentação.
- **Inventar referências processuais**: se a folha não é conhecida, omitir — nunca chutar.
- **Usar termos avaliativos**: "elevada quantia", "fato grave", "manifesta improcedência". Substituir por descritivos neutros.
- **Repetir argumentos da petição na voz da contratada como se fossem fatos**: "ocorreu uma alta extraordinária do aço" → corrigir para "a contratada alega elevação de 47% no preço do aço CA-50, conforme planilhas em anexo".
- **Misturar fatos e direito**: "houve fato superveniente nos termos do Art. 124, II, 'd'" — fato + enquadramento juntos é erro; deixar o enquadramento para a fundamentação.
