/**
 * Schema da petição de reequilíbrio econômico-financeiro.
 *
 * Estrutura de entrada principal do Feature 1 (Análise): o usuário fornece
 * os dados do contrato administrativo e o fato superveniente que justifica
 * o pedido. O motor PEVS usa este objeto como input do Orquestrador.
 *
 * Premissas:
 *  - Pessoas jurídicas (contratante / contratado) podem ter CNPJ vazio
 *    temporariamente (algumas petições só citam razão social), mas a
 *    validação `.refine` exige pelo menos um identificador (CNPJ ou nome).
 *  - `valor_contrato` é em centavos para evitar erro de ponto flutuante
 *    (BRL int em centavos é o padrão do projeto, conforme dados oficiais
 *    do TCE/TCU).
 *  - `base_legal` é livre — pode ser "Art. 124 da Lei 14.133/2021" ou
 *    "Súmula 222 do TCU". O Analista Jurídico vai resolver isso.
 */
import { z } from "zod";

/**
 * Pessoa jurídica envolvida no contrato (contratante OU contratado).
 *
 * `cnpj` aceita formato 00.000.000/0000-00 ou só dígitos (14). A validação
 * estrutural (DV) será feita no Track G (ingestão).
 */
export const PessoaJuridicaSchema = z
  .object({
    razao_social: z.string().min(1, "razão social não pode ser vazia"),
    cnpj: z
      .string()
      .regex(
        /^(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})?$/,
        "CNPJ inválido (use 00.000.000/0000-00 ou 14 dígitos)",
      )
      .optional()
      .default(""),
    ente_federativo: z
      .enum(["uniao", "estado", "municipio", "df", "autarquia", "empresa_publica", "privada"])
      .optional(),
  })
  .refine(
    (p) =>
      p.razao_social.trim().length > 0 ||
      (typeof p.cnpj === "string" && p.cnpj.length > 0),
    {
      message: "Pessoa jurídica precisa de razão social OU CNPJ",
      path: ["cnpj"],
    },
  );

export type PessoaJuridica = z.infer<typeof PessoaJuridicaSchema>;

/**
 * Dados do contrato administrativo.
 *
 *  - `numero`: número do contrato (livre).
 *  - `modalidade`: pregão / concorrência / dispensa etc.
 *  - `data_assinatura` / `data_inicio_vigencia`: ISO YYYY-MM-DD.
 *  - `valor_centavos`: valor total em centavos.
 *  - `objeto`: objeto contratual (resumo).
 */
export const ContratoSchema = z
  .object({
    numero: z.string().min(1, "número do contrato é obrigatório"),
    modalidade: z.enum([
      "pregao_eletronico",
      "pregao_presencial",
      "concorrencia",
      "dispensa",
      "inexigibilidade",
      "concurso",
      "leilao",
      "dialogo_competitivo",
      "outro",
    ]),
    data_assinatura: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "data_assinatura deve ser YYYY-MM-DD"),
    data_inicio_vigencia: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "data_inicio_vigencia deve ser YYYY-MM-DD"),
    valor_centavos: z
      .number()
      .int("valor_centavos deve ser inteiro (em centavos)")
      .nonnegative("valor_centavos não pode ser negativo"),
    objeto: z.string().min(1, "objeto do contrato é obrigatório"),
  })
  .refine(
    (c) =>
      Date.parse(c.data_inicio_vigencia) >= Date.parse(c.data_assinatura),
    {
      message: "data_inicio_vigencia não pode ser anterior a data_assinatura",
      path: ["data_inicio_vigencia"],
    },
  );

export type Contrato = z.infer<typeof ContratoSchema>;

/**
 * Cálculo apresentado pelo contratado na petição (opcional).
 *
 * Importante: este é o cálculo que o requerente apresentou, NÃO o cálculo
 * verificado pelo Calculista. O Auditor compara um contra o outro.
 */
export const CalculoApresentadoSchema = z.object({
  descricao: z.string().min(1, "descrição do cálculo apresentado"),
  valor_pretendido_centavos: z
    .number()
    .int("valor_pretendido_centavos deve ser inteiro")
    .nonnegative(),
  metodologia: z.string().min(1, "metodologia do cálculo"),
  indices_utilizados: z.array(z.string().min(1)).default([]),
});

export type CalculoApresentado = z.infer<typeof CalculoApresentadoSchema>;

/**
 * Petição de reequilíbrio — input do Feature 1.
 *
 * `id` é gerado pelo SessionAgent (UUID v4) — opcional aqui para permitir
 * que petições "in-flight" sejam criadas sem ID antes da persistência.
 */
export const PeticaoSchema = z
  .object({
    id: z.string().uuid("id deve ser UUID v4").optional(),

    /** Quem assinou a petição (advogado / preposto). */
    requerente: z.string().min(1, "requerente é obrigatório"),

    /** Pessoa jurídica contratante (administração pública, em regra). */
    contratante: PessoaJuridicaSchema,

    /** Pessoa jurídica contratada (empresa privada, em regra). */
    contratado: PessoaJuridicaSchema,

    /** Dados estruturados do contrato. */
    contrato: ContratoSchema,

    /**
     * Fato superveniente alegado pelo contratado (núcleo da petição).
     * Texto livre, no mínimo 50 chars para evitar pedidos sem fundamentação.
     */
    fato_alegado: z
      .string()
      .min(50, "fato_alegado precisa de pelo menos 50 caracteres"),

    /**
     * Base legal invocada pelo requerente (livre).
     * O Analista Jurídico resolve para citações estruturadas.
     */
    base_legal_invocada: z.array(z.string().min(1)).default([]),

    /** Cálculos apresentados pelo requerente (opcional). */
    calculos_apresentados: z.array(CalculoApresentadoSchema).default([]),

    /** Documentos anexos (URLs / paths no R2). */
    anexos_urls: z.array(z.string().min(1)).default([]),

    /**
     * Data da protocolização (ISO).
     * Default: data atual em UTC, no formato YYYY-MM-DD.
     */
    data_protocolo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "data_protocolo deve ser YYYY-MM-DD")
      .default(() => new Date().toISOString().slice(0, 10)),
  })
  .refine(
    (p) =>
      p.contratante.razao_social !== p.contratado.razao_social ||
      (p.contratante.cnpj ?? "") !== (p.contratado.cnpj ?? ""),
    {
      message: "contratante e contratado não podem ser a mesma pessoa jurídica",
      path: ["contratado"],
    },
  );

export type Peticao = z.infer<typeof PeticaoSchema>;
