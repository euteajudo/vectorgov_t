---
nome: extracao-estruturada-peticao
descricao: "Extrai dados estruturados (objeto, partes, fundamentos, pedido, anexos) de uma petição de reequilíbrio econômico-financeiro, gerando JSON normalizado para os demais agentes."
trigger:
  palavras_chave:
    - peticao
    - peticionar
    - reequilibrio
    - reajuste
    - revisao
    - extrair
    - estruturar
    - parsing
    - upload
  contextos:
    - usuário acabou de fazer upload de petição em PDF/DOCX
    - orquestrador precisa abrir a análise de uma nova petição
    - agente recebeu texto bruto de petição e precisa normalizar
agentes_aplicaveis:
  - orquestrador
  - analista-juridico
  - pesquisador
modelo_recomendado: gemini-3.5-flash
versao: 1.0.0
data_atualizacao: 2026-05-26
autor: "Vectorgov_t Core Team"
tokens_aproximados: 1400
categoria: analise-peticao
status: active
---

# Extração estruturada de petição

## Quando usar

Use esta skill no primeiro passo da Feature 1 (Análise de petição) — assim que a petição é convertida de PDF/DOCX para texto. O objetivo é transformar texto livre num JSON estável que os demais agentes (especialista de reequilíbrio, calculista, redator) consumam sem precisar reabrir o documento.

Não use para:
- Documentos administrativos comuns (ofícios, despachos) — esta skill é específica para petições com pedido econômico.
- Petições iniciais de processos judiciais — use a skill `extracao-peticao-judicial` (não implementada no MVP).

## Critérios

1. **Identificar o tipo de pleito** entre: reajuste contratual (Art. 134 da Lei 14.133/2021), revisão (Art. 124, II, "d"), repactuação (Art. 135), reequilíbrio por fato superveniente (Art. 124, II, "d").
2. **Extrair as partes** (contratada, contratante/órgão) com CNPJ/CPF quando presentes.
3. **Localizar o número do contrato administrativo** e a vigência declarada.
4. **Extrair os fundamentos invocados** — separar entre: dispositivos legais, cláusulas contratuais, jurisprudência (TCU, STJ, STF), doutrina.
5. **Detectar o fato gerador alegado** (data + descrição sucinta) e o impacto econômico (valor estimado).
6. **Listar anexos** com identificação ("Anexo I — planilha de custos", etc.).
7. **Rejeitar** texto que não contém pedido econômico explícito (devolver erro estruturado).

## Schema de saída esperado (Zod TypeScript)

```typescript
import { z } from "zod";

export const PeticaoExtraidaSchema = z.object({
  tipo_pleito: z.enum([
    "reajuste",
    "revisao",
    "repactuacao",
    "reequilibrio_fato_superveniente",
    "indeterminado",
  ]),
  partes: z.object({
    contratada: z.object({
      nome: z.string(),
      cnpj: z.string().regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/).optional(),
    }),
    contratante: z.object({
      orgao: z.string(),
      cnpj: z.string().optional(),
    }),
  }),
  contrato: z.object({
    numero: z.string().optional(),
    vigencia_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    vigencia_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  fundamentos: z.object({
    dispositivos_legais: z.array(z.string()),
    clausulas_contratuais: z.array(z.string()),
    jurisprudencia: z.array(z.string()),
  }),
  fato_gerador: z.object({
    data_alegada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    descricao: z.string().min(20),
  }),
  impacto_economico: z.object({
    valor_estimado_reais: z.number().nonnegative().optional(),
    metodologia: z.string().optional(),
  }),
  anexos: z.array(z.object({
    titulo: z.string(),
    referencia: z.string().optional(),
  })),
  data_protocolo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rejeitada: z.boolean().default(false),
  motivo_rejeicao: z.string().optional(),
});

export type PeticaoExtraida = z.infer<typeof PeticaoExtraidaSchema>;
```

## Exemplos

### Exemplo 1 — Reajuste com IPCA

Trecho da petição:
> "Requer-se o reajuste contratual nos termos da Cláusula 8.2 do Contrato nº 047/2024, aplicando-se o IPCA acumulado nos últimos 12 meses (5,12%) sobre o saldo remanescente, conforme Art. 134 da Lei 14.133/2021."

Saída esperada (parcial):
```json
{
  "tipo_pleito": "reajuste",
  "fundamentos": {
    "dispositivos_legais": ["Art. 134 da Lei 14.133/2021"],
    "clausulas_contratuais": ["Cláusula 8.2 do Contrato nº 047/2024"],
    "jurisprudencia": []
  }
}
```

### Exemplo 2 — Reequilíbrio por alta súbita de insumo

Trecho:
> "Em razão da elevação extraordinária de 47% do preço do aço CA-50 entre janeiro e março/2026, conforme INPC setorial em anexo, postula-se o restabelecimento do equilíbrio econômico-financeiro original do contrato (Art. 124, II, 'd' da Lei 14.133/2021)."

Saída esperada (parcial):
```json
{
  "tipo_pleito": "reequilibrio_fato_superveniente",
  "fato_gerador": {
    "descricao": "Elevação extraordinária de 47% do preço do aço CA-50 entre jan/2026 e mar/2026"
  }
}
```

## Erros a evitar

- **Confundir reajuste com revisão**: reajuste é automático por índice; revisão exige álea extraordinária. Ler a Cláusula contratual antes de classificar.
- **Inventar números de contrato**: se o documento não trouxer, deixar `numero: undefined` — nunca extrapolar a partir do nome do órgão.
- **Marcar `rejeitada=true` sem motivo**: o `motivo_rejeicao` é obrigatório quando `rejeitada=true`.
- **Misturar fundamentos**: separar dispositivos legais (Art. X), cláusulas contratuais e jurisprudência em arrays distintos.
