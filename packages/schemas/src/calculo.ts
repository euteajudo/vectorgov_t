/**
 * Schema de cálculo tributário — PLACEHOLDER (Fase 2).
 *
 * O Calculista (agente determinístico) consome este schema para devolver
 * resultados de cálculo de reequilíbrio. Na Fase 4 será integrado com
 * engine real (planilhas oficiais TCU + tributos pós-reforma).
 *
 * Por enquanto, é uma estrutura genérica suficiente para que o motor
 * PEVS aceite "qualquer" cálculo e o Auditor verifique seus metadados
 * (memória de cálculo, fórmula descrita, valores de entrada/saída).
 */
import { z } from "zod";

/**
 * Linha individual da memória de cálculo.
 *
 * Em pareceres reais, cada linha corresponde a um passo intermediário:
 *   "Custo unitário base ……………………… R$ 1.234,56"
 *   "× variação acumulada do INCC …… 1,0875"
 *   "= Custo unitário reequilibrado …… R$ 1.342,57"
 */
export const LinhaMemoriaCalculoSchema = z.object({
  /** Descrição da operação (livre, em português). */
  descricao: z.string().min(1, "descrição da linha não pode ser vazia"),

  /**
   * Valor resultante da linha. Pode ser nulo quando a linha for
   * meramente descritiva (ex.: cabeçalho de seção).
   */
  valor: z.number().finite().nullable().optional(),

  /** Unidade do valor (ex.: "BRL", "%", "und"). */
  unidade: z.string().min(1).nullable().optional(),

  /** Fórmula textual (opcional, ajuda o Auditor a verificar). */
  formula: z.string().nullable().optional(),
});

export type LinhaMemoriaCalculo = z.infer<typeof LinhaMemoriaCalculoSchema>;

/**
 * Tipo de cálculo executado.
 *
 * Determina qual rotina determinística (na Fase 4) será aplicada.
 */
export const TipoCalculoSchema = z.enum([
  "reequilibrio_economico",
  "reajuste_contratual",
  "atualizacao_monetaria",
  "tributario_pre_reforma",
  "tributario_pos_reforma",
  "comparativo_regimes",
]);

export type TipoCalculo = z.infer<typeof TipoCalculoSchema>;

/**
 * Resultado de um cálculo executado pelo Calculista.
 *
 * Invariantes garantidos por `.refine`:
 *  - Se `sucesso` = false, `erro` é obrigatório e `valor_final` deve ser nulo.
 *  - Se `sucesso` = true, `valor_final` é obrigatório.
 *  - `memoria` precisa ter pelo menos 1 linha quando `sucesso` = true.
 */
export const CalculoTributarioSchema = z
  .object({
    /** Identificador único dentro do parecer. */
    id: z.string().min(1, "id do cálculo é obrigatório"),

    /** Tipo do cálculo. */
    tipo: TipoCalculoSchema,

    /** Descrição em prosa do objetivo do cálculo. */
    descricao: z.string().min(1, "descrição é obrigatória"),

    /** Inputs nomeados — espelhados na memória de cálculo. */
    inputs: z.record(z.string(), z.number().finite()),

    /** Memória de cálculo passo-a-passo. */
    memoria: z.array(LinhaMemoriaCalculoSchema),

    /** Valor final do cálculo (BRL por padrão). */
    valor_final: z.number().finite().nullable(),

    /** Unidade do valor final. */
    unidade_final: z.string().min(1).default("BRL"),

    /** Flag de sucesso. */
    sucesso: z.boolean(),

    /** Mensagem de erro (quando `sucesso` = false). */
    erro: z.string().min(1).nullable().optional(),

    /**
     * Flag indicando se este resultado veio de um stub/placeholder
     * (Fase 2) ou de engine real (Fase 4).
     */
    placeholder: z.boolean().default(true),
  })
  .refine(
    (c) => c.sucesso || (typeof c.erro === "string" && c.erro.length > 0),
    {
      message: "Cálculo com sucesso=false precisa informar erro",
      path: ["erro"],
    },
  )
  .refine(
    (c) => !c.sucesso || c.valor_final !== null,
    {
      message: "Cálculo com sucesso=true precisa ter valor_final",
      path: ["valor_final"],
    },
  )
  .refine(
    (c) => !c.sucesso || c.memoria.length > 0,
    {
      message: "Cálculo com sucesso=true precisa ter pelo menos 1 linha de memória",
      path: ["memoria"],
    },
  );

export type CalculoTributario = z.infer<typeof CalculoTributarioSchema>;
