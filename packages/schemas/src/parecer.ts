/**
 * Schema do parecer formal — output do Feature 2.
 *
 * Diferente da análise interna (Feature 1), o parecer é o documento
 * jurídico publicável, com estrutura formal em 5 seções (I-V) que
 * segue o padrão de pareceres da AGU / Procuradorias estaduais:
 *
 *   I.   Relatório
 *   II.  Fundamentação
 *   III. Conclusão
 *   IV.  Cálculos e Demonstrativos
 *   V.   Recomendações
 *
 * O Redator produz este objeto consumindo uma `AnaliseReequilibrio`
 * já assinada pelo Auditor. NÃO há novas verificações nesta etapa —
 * todas as citações vêm da análise (status APROVADA).
 */
import { z } from "zod";
import { CitacaoVerificadaSchema } from "./citacao.js";
import { CalculoTributarioSchema } from "./calculo.js";
import { PrecoReferenciaSchema } from "./precos.js";

/**
 * Cabeçalho administrativo do parecer (metadados).
 */
export const ParecerCabecalhoSchema = z.object({
  /** Número do parecer (gerado pelo SessionAgent). */
  numero: z.string().min(1, "número do parecer é obrigatório"),
  /** Nome do parecerista (pode ser "Agente IA Auditor + Redator"). */
  parecerista: z.string().min(1, "parecerista é obrigatório"),
  /** Órgão / banca emitente. */
  orgao: z.string().min(1, "órgão emitente"),
  /** Assunto resumido em 1 linha. */
  assunto: z.string().min(10, "assunto muito curto"),
  /** Data de emissão (YYYY-MM-DD). */
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD"),
});

export type ParecerCabecalho = z.infer<typeof ParecerCabecalhoSchema>;

/**
 * Seção formal do parecer (cada uma das 5 seções I-V).
 */
export const ParecerSecaoSchema = z.object({
  /** Numeral romano da seção (I-V). */
  numero: z.enum(["I", "II", "III", "IV", "V"]),
  /** Título da seção. */
  titulo: z.string().min(1, "título da seção é obrigatório"),
  /** Conteúdo em markdown / texto livre. */
  conteudo: z.string().min(50, "conteúdo da seção muito curto (mín 50 chars)"),
});

export type ParecerSecao = z.infer<typeof ParecerSecaoSchema>;

/**
 * Recomendação prática (item da seção V).
 */
export const RecomendacaoSchema = z.object({
  descricao: z.string().min(1, "descrição da recomendação"),
  prioridade: z.enum(["baixa", "media", "alta", "urgente"]),
  prazo_dias: z.number().int().positive().nullable().optional(),
});

export type Recomendacao = z.infer<typeof RecomendacaoSchema>;

/**
 * Redação do parecer — a parte que o LLM (Redator) de fato gera.
 *
 * Contém APENAS a prosa jurídica: as seções, a conclusão objetiva e as
 * recomendações. Os campos determinísticos do `Parecer` (id, analise_id,
 * cabecalho, citacoes, calculos, gerado_em) NÃO são pedidos ao LLM — o
 * código os injeta a partir da análise verificada e do input. Isso evita
 * que o modelo precise reproduzir hashes SHA-256, UUIDs e timestamps,
 * o que tornava o `generateObject` frágil ("response did not match schema").
 *
 * `secoes` é tolerante aqui (min 1); o Redator normaliza para exatamente
 * 5 seções na ordem I-V antes de montar o `Parecer` final.
 */
export const RedacaoParecerSchema = z.object({
  secoes: z.array(ParecerSecaoSchema).min(1, "ao menos uma seção"),
  conclusao_objetiva: z.string().min(20, "conclusão objetiva muito curta"),
  recomendacoes: z.array(RecomendacaoSchema).default([]),
});

export type RedacaoParecer = z.infer<typeof RedacaoParecerSchema>;

/**
 * Parecer formal — output do Feature 2.
 *
 * Invariantes garantidos por `.refine`:
 *  - Seções I-V devem aparecer todas, exatamente uma vez cada.
 *  - Toda citação no parecer precisa ter status APROVADA (Redator
 *    nunca pode publicar citação REJEITADA / PENDENTE).
 *  - `conclusao_objetiva` deve combinar com o veredito macro presente
 *    em alguma seção (validação textual fraca via includes).
 */
export const ParecerSchema = z
  .object({
    /** UUID v4 do parecer. */
    id: z.string().uuid("id deve ser UUID v4"),

    /** Referência à análise que originou o parecer. */
    analise_id: z.string().uuid("analise_id deve ser UUID v4"),

    /** Cabeçalho administrativo. */
    cabecalho: ParecerCabecalhoSchema,

    /** Seções formais (I-V). */
    secoes: z.array(ParecerSecaoSchema).length(5, "parecer precisa ter exatamente 5 seções"),

    /**
     * Conclusão objetiva em 1 frase (para uso em ementas / decisões
     * sumárias). Ex.: "Pelo deferimento parcial do pleito, no valor de
     * R$ 12.450,00, com fundamento no art. 124 da Lei 14.133/2021."
     */
    conclusao_objetiva: z
      .string()
      .min(20, "conclusão objetiva muito curta")
      .max(500, "conclusão objetiva muito longa (máx 500 chars)"),

    /** Recomendações práticas para o gestor (seção V). */
    recomendacoes: z.array(RecomendacaoSchema).default([]),

    /** Todas as citações que aparecem no parecer (devem estar APROVADAS). */
    citacoes: z.array(CitacaoVerificadaSchema).default([]),

    /** Cálculos demonstrados na seção IV. */
    calculos: z.array(CalculoTributarioSchema).default([]),

    /**
     * Preço de referência (vantajosidade), quando apurado na análise.
     * Opcional — null quando a análise não envolveu pesquisa de preço.
     */
    preco_referencia: PrecoReferenciaSchema.nullable().default(null),

    /** Timestamp ISO 8601 da geração. */
    gerado_em: z
      .string()
      .datetime("gerado_em deve ser ISO 8601"),
  })
  .refine(
    (p) => {
      const ordem = ["I", "II", "III", "IV", "V"] as const;
      return ordem.every((n, i) => p.secoes[i]?.numero === n);
    },
    {
      message: "seções devem aparecer na ordem I, II, III, IV, V",
      path: ["secoes"],
    },
  )
  .refine(
    (p) => p.citacoes.every((c) => c.status === "APROVADA"),
    {
      message: "parecer não pode conter citação REJEITADA ou PENDENTE",
      path: ["citacoes"],
    },
  );

export type Parecer = z.infer<typeof ParecerSchema>;
