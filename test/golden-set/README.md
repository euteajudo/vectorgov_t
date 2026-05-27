# Golden Set — Vectorgov_t

Conjunto de **5 petições de teste** com gabaritos para validar regressões na qualidade da análise jurídica (Feature 1) e geração de parecer (Feature 2).

## Estrutura

Cada caso vive em `caso-NN-<slug>/` com:

```
caso-NN-<slug>/
├── peticao.json            ← input estruturado (formato igual ao /api/peticoes/upload)
├── gabarito-analise.json   ← análise esperada (veredito, citações-chave, score mínimo)
└── notas.md                ← contexto humano: o que o caso testa
```

## Os 5 casos

| # | Caso | Veredito esperado | Testa |
|---|---|---|---|
| 01 | Reequilíbrio puro IBS/CBS (LC 214) | `procedente` | Detecção de mudança tributária pós-reforma |
| 02 | Petição claramente improcedente | `improcedente` | Filtro de pedidos sem mérito |
| 03 | Falta documento obrigatório | `inconclusiva` | Verificação de admissibilidade formal (memória de cálculo ausente) |
| 04 | Procedência parcial — cálculo errado | `parcialmente_procedente` | Auditor identifica erro no cálculo apresentado |
| 05 | Caso ambíguo (decisão divergente) | `inconclusiva` | Limites do sistema; quando deve devolver ao humano |

## Como rodar

```bash
# Pré-requisitos: Worker MCP deployado, GOOGLE_API_KEY configurado
cd test/golden-set
NODE_OPTIONS=--use-system-ca node run-golden-set.mjs
```

O script:
1. Para cada caso, POST `/api/peticoes/upload` com `peticao.json`
2. Aguarda análise concluir (polling)
3. Compara veredito + citações + score contra `gabarito-analise.json`
4. Imprime tabela de aprovação (com diferenças destacadas)
5. Exit code 0 se 5/5 passarem, 1 caso contrário

## Critérios de aprovação

Uma análise é considerada **APROVADA** quando:
- `veredito` exato igual ao gabarito
- `score_confianca` ≥ `score_minimo_esperado` do gabarito
- Todas as `citacoes_obrigatorias` do gabarito aparecem em `analise.citacoes`
- Nenhuma citação fica com `status: REJEITADA` no resultado

## Observações

- Os PDFs reais das petições NÃO estão neste repo (LGPD). Em vez disso, o `peticao.json` traz os dados estruturados que o frontend extrai do PDF.
- Para gerar PDFs sintéticos a partir destes JSONs (caso a equipe precise testar a extração também), use `scripts/peticao-json-para-pdf.mjs` (TODO Fase 5).
