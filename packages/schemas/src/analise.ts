/**
 * Schema da análise de reequilíbrio — output do Feature 1.
 *
 * Diferente do parecer formal (Feature 2), a análise é um documento
 * técnico-interno que apresenta:
 *  - Veredito objetivo (procedente / improcedente / parcialmente procedente).
 *  - Fundamentação detalhada (texto + citações verificadas).
 *  - Cálculos realizados (verificados pelo Calculista).
 *  - Score de confiança agregado.
 *  - Pontos a complementar antes do parecer final.
 *
 * O Auditor é quem assina a análise — ele decide o `score_confianca` e
 * lista pontos pendentes. O Redator usa esta análise para gerar o
 * parecer formal apenas se `score_confianca >= 0.80` e nenhuma citação
 * estiver REJEITADA.
 */
import { z } from "zod";
import { CitacaoVerificadaSchema } from "./citacao.js";
import { CalculoTributarioSchema } from "./calculo.js";

/**
 * Veredito macro da análise.
 *
 *  - `procedente`: pedido deve ser deferido integralmente.
 *  - `parcialmente_procedente`: deferimento com ajustes (valor / prazo).
 *  - `improcedente`: indeferimento total.
 *  - `inconclusiva`: análise não terminou — faltam dados ou houve
 *    rejeição irrecuperável do Auditor.
 */
export const VereditoSchema = z.enum([
  "procedente",
  "parcialmente_procedente",
  "improcedente",
  "inconclusiva",
]);

export type Veredito = z.infer<typeof VereditoSchema>;

/**
 * Ponto pendente — coisa que o Analista detectou mas não conseguiu
 * resolver com a informação disponível na petição.
 */
export const PontoPendenteSchema = z.object({
  descricao: z.string().min(1, "descrição do ponto pendente"),
  severidade: z.enum(["baixa", "media", "alta", "bloqueante"]),
  /** Quem precisa fornecer o dado (requerente / órgão / perito). */
  responsavel: z.enum(["requerente", "orgao", "perito", "indefinido"]),
});

export type PontoPendente = z.infer<typeof PontoPendenteSchema>;

/**
 * Análise de reequilíbrio — output do Feature 1, assinada pelo Auditor.
 *
 * Invariantes garantidos por `.refine`:
 *  - Se houver citação REJEITADA, `score_confianca` deve ser <= 0.50.
 *  - Veredito `inconclusiva` exige pelo menos 1 ponto pendente bloqueante.
 *  - Veredito `procedente`/`parcialmente_procedente` exige pelo menos
 *    1 cálculo com sucesso=true.
 */
export const AnaliseReequilibrioSchema = z
  .object({
    /** Identificador único da análise (UUID v4). */
    id: z.string().uuid("id deve ser UUID v4"),

    /** Referência à petição analisada. */
    peticao_id: z.string().uuid("peticao_id deve ser UUID v4"),

    /** Veredito objetivo. */
    veredito: VereditoSchema,

    /**
     * Fundamentação em texto livre — produzida pelo Especialista de
     * Reequilíbrio com input do Analista Jurídico e do Especialista
     * em Licitações. Deve ter ao menos 200 chars (evita pareceres
     * lacônicos).
     */
    fundamentacao: z.string().min(200, "fundamentação muito curta (mín 200 chars)"),

    /** Citações verificadas pelo Auditor. */
    citacoes: z.array(CitacaoVerificadaSchema).default([]),

    /** Cálculos executados pelo Calculista (placeholders na Fase 2). */
    calculos: z.array(CalculoTributarioSchema).default([]),

    /**
     * Score agregado de confiança (0.0 a 1.0). Calculado pelo Auditor com
     * base em:
     *  - Cobertura de citações verificadas (peso 0.4).
     *  - Cálculos com sucesso (peso 0.3).
     *  - Ausência de pontos pendentes bloqueantes (peso 0.3).
     */
    score_confianca: z
      .number()
      .min(0, "score_confianca >= 0")
      .max(1, "score_confianca <= 1"),

    /** Pontos que precisam ser complementados antes do parecer final. */
    pontos_a_complementar: z.array(PontoPendenteSchema).default([]),

    /** Timestamp ISO 8601 da geração da análise. */
    gerado_em: z
      .string()
      .datetime("gerado_em deve ser ISO 8601 (datetime)"),

    /**
     * Modelo LLM usado pelo Auditor para a verificação final.
     * Default: "gemini-3-pro" (Auditor exige modelo Pro, não Flash).
     */
    modelo_auditor: z.string().min(1).default("gemini-3-pro"),
  })
  .refine(
    (a) =>
      !a.citacoes.some((c) => c.status === "REJEITADA") ||
      a.score_confianca <= 0.5,
    {
      message:
        "Análise com citação REJEITADA deve ter score_confianca <= 0.50",
      path: ["score_confianca"],
    },
  )
  .refine(
    (a) =>
      a.veredito !== "inconclusiva" ||
      a.pontos_a_complementar.some((p) => p.severidade === "bloqueante"),
    {
      message:
        "Veredito 'inconclusiva' exige ao menos 1 ponto_a_complementar bloqueante",
      path: ["pontos_a_complementar"],
    },
  )
  .refine(
    (a) =>
      (a.veredito !== "procedente" && a.veredito !== "parcialmente_procedente") ||
      a.calculos.some((c) => c.sucesso === true),
    {
      message:
        "Veredito procedente/parcialmente_procedente exige ao menos 1 cálculo bem-sucedido",
      path: ["calculos"],
    },
  );

export type AnaliseReequilibrio = z.infer<typeof AnaliseReequilibrioSchema>;
