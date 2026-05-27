---
nome: estrutura-parecer-tecnico-juridico
descricao: "Define a estrutura formal padrão de um parecer técnico-jurídico em processo de reequilíbrio econômico-financeiro: ementa, relatório, fundamentação, conclusão e recomendações."
trigger:
  palavras_chave:
    - parecer
    - estrutura
    - secoes
    - template
    - formato
    - ementa
    - relatorio
    - dispositivo
  contextos:
    - iniciar a montagem de um parecer formal
    - planejar quais seções o parecer terá antes de redigir
    - garantir conformidade com padrão de parecer técnico-jurídico em compras públicas
agentes_aplicaveis:
  - orquestrador
  - redator
  - analista-juridico
modelo_recomendado: gemini-3.5-flash
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1200
categoria: geracao-parecer
status: active
---

# Estrutura do parecer técnico-jurídico

## Quando usar

Use no início da Feature 2 (Geração de parecer) — antes de redigir qualquer seção, o orquestrador define o esqueleto do documento. Esta skill descreve o formato; as skills de redação específica (`redacao-relatorio-fatos`, `redacao-fundamentacao-juridica`, `redacao-conclusao-recomendacoes`) preenchem cada seção.

Não use para:
- Pareceres de outra natureza (de auditoria, de mérito de licitação) — usar `estrutura-parecer-auditoria` (não no MVP).
- Despachos saneadores — não exigem todas as seções.

## Critérios

O parecer padrão tem 7 seções, na ordem:

1. **Cabeçalho** — Órgão, processo administrativo, número do parecer/ano, interessado, assunto.
2. **Ementa** — síntese em 3-5 linhas (verbete temático + verbo principal + conclusão).
3. **Relatório dos fatos** — narrativa cronológica neutra dos eventos relevantes, com referências aos volumes/folhas do processo.
4. **Análise preliminar (admissibilidade)** — verificação dos requisitos formais (legitimidade, interesse, tempestividade) antes do mérito.
5. **Fundamentação jurídica** — dispositivos legais aplicáveis (sempre Lei 14.133/2021 por padrão; LC 214/2025 e EC 132/2023 quando houver dimensão tributária), enquadramento dos fatos, análise da imprevisibilidade, do nexo causal e do impacto.
6. **Conclusão** — manifestação favorável, desfavorável ou parcialmente favorável; identificação clara do que se recomenda.
7. **Recomendações operacionais** — diligências, atos a praticar (termo aditivo, glosa, etc.), comunicações.

Cada seção precisa de:
- Numeração própria (1, 2, 3...).
- Citações literais entre aspas, sempre acompanhadas de referência rastreável.
- Linguagem impessoal ("opina-se", "observa-se"), nunca primeira pessoa.

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const EstruturaParecerSchema = z.object({
  cabecalho: z.object({
    orgao: z.string(),
    processo_administrativo: z.string(),
    numero_parecer: z.string(), // ex: "PJ-2026/047"
    interessado: z.string(),
    assunto: z.string().max(200),
  }),
  secoes: z.array(z.object({
    numero: z.number().int().positive(),
    titulo: z.string(),
    obrigatoria: z.boolean(),
    descricao_curta: z.string(),
    skill_redacao_recomendada: z.string().optional(),
  })).length(7),
  metadados: z.object({
    versao_estrutura: z.literal("padrao-vectorgov-t-1.0"),
    base_legal_referencia: z.array(z.string()),
  }),
});
```

## Exemplos

### Exemplo 1 — Saída padrão para parecer de reequilíbrio

```json
{
  "cabecalho": {
    "orgao": "Secretaria de Infraestrutura — DF",
    "processo_administrativo": "00400-001234/2026-77",
    "numero_parecer": "PJ-2026/047",
    "interessado": "Construtora Alfa Ltda",
    "assunto": "Pedido de reequilíbrio econômico-financeiro — Contrato 047/2024"
  },
  "secoes": [
    { "numero": 1, "titulo": "Cabeçalho", "obrigatoria": true, "descricao_curta": "Identificação do feito" },
    { "numero": 2, "titulo": "Ementa", "obrigatoria": true, "descricao_curta": "Síntese normativa" },
    { "numero": 3, "titulo": "Relatório dos fatos", "obrigatoria": true, "descricao_curta": "Narrativa cronológica neutra", "skill_redacao_recomendada": "redacao-relatorio-fatos" },
    { "numero": 4, "titulo": "Análise preliminar", "obrigatoria": true, "descricao_curta": "Admissibilidade e tempestividade" },
    { "numero": 5, "titulo": "Fundamentação jurídica", "obrigatoria": true, "descricao_curta": "Dispositivos e enquadramento", "skill_redacao_recomendada": "redacao-fundamentacao-juridica" },
    { "numero": 6, "titulo": "Conclusão", "obrigatoria": true, "descricao_curta": "Manifestação final", "skill_redacao_recomendada": "redacao-conclusao-recomendacoes" },
    { "numero": 7, "titulo": "Recomendações operacionais", "obrigatoria": true, "descricao_curta": "Diligências e providências" }
  ],
  "metadados": {
    "versao_estrutura": "padrao-vectorgov-t-1.0",
    "base_legal_referencia": ["Lei 14.133/2021", "Decreto 11.246/2022", "LC 214/2025 (quando aplicável)"]
  }
}
```

## Erros a evitar

- **Pular a ementa**: sem ementa, o parecer não é indexável nem citável de forma sucinta.
- **Misturar relatório com fundamentação**: o relatório é narrativa neutra; opiniões e enquadramentos vão para a fundamentação.
- **Conclusão genérica ("opina-se pela legalidade")**: a conclusão precisa indicar o ato concreto recomendado (aprovar, rejeitar, recomendar diligência, fixar valor, etc.).
- **Citar a Lei 8.666/93 como fundamento primário**: contratos sob a Lei 14.133/2021 têm regime próprio; só citar a Lei 8.666 para contratos remanescentes do regime anterior.
- **Esquecer rastreabilidade**: cada fato no relatório deve ter referência ao volume/folha; cada citação literal deve estar entre aspas com nota.
