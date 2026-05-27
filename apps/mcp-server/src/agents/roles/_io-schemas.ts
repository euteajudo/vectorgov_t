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
  /** Veredito preliminar (antes do Auditor). */
  veredito_preliminar: z.enum([
    "procedente",
    "parcialmente_procedente",
    "improcedente",
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
