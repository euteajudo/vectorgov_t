/**
 * Schemas Zod para os I/O internos dos papéis.
 *
 * Estes schemas NÃO são domínio de negócio (que fica em `@vectorgov-t/schemas`)
 * — são estruturas usadas SÓ entre os papéis e o motor PEVS. Mantê-los
 * locais a `agents/roles/` evita poluir o pacote compartilhado com
 * detalhes da máquina de orquestração.
 */
import { z } from "zod";
import {
  CitacaoVerificadaSchema,
  CalculoTributarioSchema,
  AnaliseReequilibrioSchema,
  PeticaoSchema,
  ParecerSchema,
} from "@vectorgov-t/schemas";

/* ---------- Orquestrador ---------- */

/**
 * Plano produzido pelo Orquestrador (FASE 1 — PLAN).
 *
 * Cada subtarefa é executada por um agente especialista. A ordem em
 * `subtarefas` indica precedência (paralelismo é permitido entre tarefas
 * adjacentes do mesmo bloco — controlado pelo PEVS engine).
 */
export const SubtarefaSchema = z.object({
  id: z.string().min(1),
  agente: z.enum([
    "pesquisador",
    "analista",
    "esp_licitacoes",
    "esp_reequilibrio",
    "calculista",
    "auditor",
    "redator",
  ]),
  descricao: z.string().min(1),
  pode_paralelizar: z.boolean().default(false),
});
export type Subtarefa = z.infer<typeof SubtarefaSchema>;

export const PlanoOrquestradorSchema = z.object({
  resumo_problema: z.string().min(10),
  subtarefas: z.array(SubtarefaSchema).min(1),
  estrategia: z.string().min(1),
});
export type PlanoOrquestrador = z.infer<typeof PlanoOrquestradorSchema>;

/* ---------- Pesquisador ---------- */

/**
 * Passo 1 do Pesquisador — o LLM transforma a pergunta focal em um plano
 * de busca (queries semânticas + alvos diretos opcionais). Quem executa as
 * buscas é o código, não o LLM.
 */
export const PlanoBuscaPesquisadorSchema = z.object({
  queries: z
    .array(z.string().min(3))
    .min(1, "ao menos 1 query")
    .max(5, "no máximo 5 queries"),
  /** Alvos diretos (quando a pergunta já cita norma+artigo explícito). */
  normas_alvo: z
    .array(
      z.object({
        norma: z.string().min(1),
        artigo: z.number().int().min(1),
      }),
    )
    .default([]),
});
export type PlanoBuscaPesquisador = z.infer<typeof PlanoBuscaPesquisadorSchema>;

/**
 * Passo 3 do Pesquisador — o LLM recebe os snippets REAIS recuperados pelas
 * tools (numerados) e apenas seleciona quais são pertinentes. NÃO produz
 * texto de citação (isso vem dos snippets, evitando alucinação).
 */
export const SelecaoCitacoesSchema = z.object({
  indices_relevantes: z
    .array(z.number().int().min(0))
    .default([])
    .describe("Índices (0-based) dos snippets pertinentes à pergunta focal"),
  justificativa: z.string().min(1).default("(sem justificativa)"),
});
export type SelecaoCitacoes = z.infer<typeof SelecaoCitacoesSchema>;

export const ResultadoPesquisaSchema = z.object({
  /** Resumos textuais de cada trecho relevante encontrado. */
  achados: z
    .array(
      z.object({
        fonte: z.string().min(1),
        trecho: z.string().min(1),
        relevancia: z.number().min(0).max(1),
      }),
    )
    .default([]),
  /**
   * Citações candidatas — ainda não verificadas pelo Auditor.
   *
   * Convencionalmente vêm com `status: "PENDENTE"` (não restringimos
   * via Zod literal porque `CitacaoVerificadaSchema` tem `.refine` e
   * o Zod 4 bloqueia `.extend` nesse caso). O Auditor reescreve o
   * status durante a verificação determinística — a invariante real
   * que importa é "Pesquisador NÃO marca APROVADA".
   */
  citacoes_candidatas: z
    .array(CitacaoVerificadaSchema)
    .default([])
    .refine((arr) => arr.every((c) => c.status !== "APROVADA"), {
      message: "Pesquisador não pode marcar citação como APROVADA — só Auditor pode",
    }),
  /** Lista de tools MCP efetivamente chamadas (para auditoria). */
  tools_chamadas: z.array(z.string()).default([]),
});
export type ResultadoPesquisa = z.infer<typeof ResultadoPesquisaSchema>;

/* ---------- Analista Jurídico ---------- */

export const AnaliseJuridicaSchema = z.object({
  interpretacao: z.string().min(50),
  riscos_juridicos: z.array(z.string().min(1)).default([]),
  citacoes_aplicaveis: z.array(z.string()).default([]),
  /**
   * Juízo de ADMISSIBILIDADE do pedido — é JUÍZO do LLM sobre a prosa da
   * petição (inevitável: "está comprovado?" não é determinístico), mas o
   * OUTPUT vira flags booleanas + justificativa, para que a regra
   * determinística do mérito (`classificarMerito`) o consuma SEM
   * reinterpretar texto. Assim "dado isso, qual o veredito?" fica
   * determinístico, ainda que o input ("é admissível?") seja juízo.
   */
  admissibilidade: z.object({
    /** Pedido está no escopo do reequilíbrio por IBS/CBS (LC 214/2025, art. 373). */
    no_escopo: z.boolean(),
    /** Pedido tempestivo (LC 214/2025, art. 376, II). */
    tempestivo: z.boolean(),
    /** Petição instruída com os documentos mínimos (LC 214/2025, art. 376, IV). */
    instruido: z.boolean(),
    /** Desequilíbrio efetivamente comprovado (LC 214/2025, art. 374 caput + 376, IV). */
    comprovacao_suficiente: z.boolean(),
    /** Como o Analista chegou a cada flag (rastreabilidade). */
    justificativa: z.string().min(20),
  }),
});
export type AnaliseJuridica = z.infer<typeof AnaliseJuridicaSchema>;

/* ---------- Especialista em Licitações ---------- */

export const ParecerLicitacaoSchema = z.object({
  enquadramento_lei_14133: z.string().min(20),
  jurisprudencia_tcu_aplicavel: z.array(z.string()).default([]),
  pontos_de_atencao: z.array(z.string()).default([]),
});
export type ParecerLicitacao = z.infer<typeof ParecerLicitacaoSchema>;

/* ---------- Especialista em Reequilíbrio ---------- */

export const SinteseReequilibrioSchema = z.object({
  /** Sumário integrado das descobertas dos especialistas. */
  sintese: z.string().min(50),
  /**
   * Veredito SUGERIDO pelo LLM — ADVISORY, não vinculante. O veredito final
   * é DETERMINÍSTICO, produzido por `classificarMerito` sobre o número da
   * tool #10 + as flags de admissibilidade do Analista. Mantido apenas como
   * sinal/telemetria e para enriquecer a fundamentação textual.
   */
  veredito_sugerido: z.enum([
    "procedente",
    "parcialmente_procedente",
    "improcedente",
    "diligencia",
    "inconclusiva",
  ]),
  /** Pontos a complementar identificados. */
  pontos_a_complementar: z
    .array(
      z.object({
        descricao: z.string().min(1),
        severidade: z.enum(["baixa", "media", "alta", "bloqueante"]),
        responsavel: z.enum(["requerente", "orgao", "perito", "indefinido"]),
      }),
    )
    .default([]),
});
export type SinteseReequilibrio = z.infer<typeof SinteseReequilibrioSchema>;

/* ---------- Calculista ---------- */

export const ResultadoCalculistaSchema = z.object({
  calculos: z.array(CalculoTributarioSchema).default([]),
});
export type ResultadoCalculista = z.infer<typeof ResultadoCalculistaSchema>;

/**
 * Inputs estruturados que o LLM extrai da petição para alimentar a tool
 * `calcular_reequilibrio_tributario`.
 *
 * O LLM faz inferências razoáveis a partir de:
 *  - `peticao.contrato.*` (valor, datas, modalidade)
 *  - `peticao.contratante.ente_federativo` (deriva is_compra_governamental
 *     + ente_contratante)
 *  - `peticao.fato_alegado` (contexto da Reforma Tributária)
 *  - `peticao.calculos_apresentados` (referência se houver)
 *
 * Para campos que dependem de fontes externas (alíquotas de referência CBS/IBS
 * fixadas pelo Senado, redutor anual de compras governamentais), o LLM
 * preenche `null` e o Calculista marca alertas.
 *
 * NÃO repete validações da tool (a tool valida via Zod). Aqui só
 * estruturamos o que o LLM precisa decidir.
 */
export const InputsCalculoReequilibrioLLMSchema = z.object({
  regime_tributario_pre: z.enum([
    "lucro_real",
    "lucro_presumido",
    "simples_nacional",
    "imune",
  ]),
  aliquotas_pre: z.object({
    pis_pct: z.number().min(0).max(100),
    cofins_pct: z.number().min(0).max(100),
    icms_pct: z.number().min(0).max(100),
    iss_pct: z.number().min(0).max(100),
    irpj_csll_pct: z.number().min(0).max(100),
  }),
  is_compra_governamental: z.boolean(),
  ente_contratante: z.enum([
    "uniao",
    "estado",
    "municipio",
    "df",
    "autarquia",
    "fundacao_publica",
    "nao_se_aplica",
  ]),
  /**
   * Data fim de vigência. Como a Petição só tem data_inicio_vigencia, o
   * LLM estima com base no objeto contratual ou usa o último dia do ano
   * seguinte ao início como heurística conservadora.
   */
  vigencia_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  aliquotas_referencia_publicadas: z.object({
    cbs_pct: z.number().min(0).max(100).nullable(),
    ibs_pct: z.number().min(0).max(100).nullable(),
  }),
  redutor_compras_govern_pct: z.number().min(0).max(100).nullable(),
  creditos_estimados_pct: z.number().min(0).max(100),
  justificativa: z
    .string()
    .min(20, "justificativa precisa explicar como o LLM chegou nesses inputs"),
});
export type InputsCalculoReequilibrioLLM = z.infer<
  typeof InputsCalculoReequilibrioLLMSchema
>;

/* ---------- Auditor ---------- */

export const RelatorioAuditorSchema = z.object({
  citacoes_verificadas: z.array(CitacaoVerificadaSchema).default([]),
  score_confianca: z.number().min(0).max(1),
  observacoes: z.string().min(1).default(""),
  /** True se ao menos uma citação foi REJEITADA — motiva retry no PEVS. */
  exige_retry: z.boolean(),
});
export type RelatorioAuditor = z.infer<typeof RelatorioAuditorSchema>;

/* ---------- Redator ---------- */

/**
 * Tipo de output que o Redator deve produzir. O Orquestrador escolhe
 * com base na "decisão" do usuário no Feature 2 (parecer formal vs
 * análise interna vs memorando).
 */
export const TipoDocumentoRedatorSchema = z.enum([
  "parecer_formal",
  "analise_tecnica",
  "memorando",
]);
export type TipoDocumentoRedator = z.infer<typeof TipoDocumentoRedatorSchema>;

/* Re-exporta para conveniência (alguns testes importam daqui). */
export { PeticaoSchema, AnaliseReequilibrioSchema, ParecerSchema };
