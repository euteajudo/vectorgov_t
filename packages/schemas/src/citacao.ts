/**
 * Schema de citação verificada.
 *
 * Uma citação é qualquer referência textual a um dispositivo normativo
 * (artigo de lei, súmula, acórdão TCU, IN, decreto) usada para fundamentar
 * uma análise ou parecer. Toda citação produzida pelos agentes precisa
 * passar pelo Auditor, que:
 *
 *  1. Carrega o texto literal do dispositivo via `fs_ler_dispositivo`
 *     (tool MCP do Track D).
 *  2. Compara o `texto_literal` reportado pelo agente com o que está
 *     no filesystem; se diferir, marca como REJEITADA.
 *  3. Calcula `sha256` do texto literal (hash determinístico para
 *     reproducibilidade — mesma fonte sempre gera mesmo hash).
 *
 * Citações REJEITADAS bloqueiam a síntese final (Redator não pode
 * publicar parecer com citação inventada). O motor PEVS aciona retry
 * do Pesquisador com feedback do Auditor.
 */
import { z } from "zod";

/**
 * Tipo de fonte da citação.
 *
 * Determina qual tool MCP o Auditor deve usar para verificar:
 *  - `lei` / `decreto` / `lc` (lei complementar) → `fs_ler_dispositivo`.
 *  - `acordao_tcu` → tool de jurisprudência (futura).
 *  - `sumula` → tool de jurisprudência (futura).
 *  - `in` (instrução normativa) → `fs_ler_dispositivo`.
 */
export const TipoFonteSchema = z.enum([
  "lei",
  "lei_complementar",
  "decreto",
  "instrucao_normativa",
  "acordao_tcu",
  "sumula",
  "constituicao",
  "outro",
]);

export type TipoFonte = z.infer<typeof TipoFonteSchema>;

/**
 * Status do veredito do Auditor sobre a citação.
 *
 *  - `APROVADA`: texto bate com o filesystem; pode ser usada no parecer.
 *  - `REJEITADA`: texto não confere ou dispositivo inexistente; bloqueia
 *    a síntese e dispara retry.
 *  - `PENDENTE`: ainda não passou pelo Auditor (estado intermediário,
 *    nunca deve aparecer na saída final).
 */
export const StatusCitacaoSchema = z.enum(["APROVADA", "REJEITADA", "PENDENTE"]);

export type StatusCitacao = z.infer<typeof StatusCitacaoSchema>;

/**
 * Citação verificada — output do Auditor para uma única referência.
 *
 * Invariantes garantidos por `.refine`:
 *  - Se `status` = APROVADA, `motivo_rejeicao` deve ser nulo/ausente.
 *  - Se `status` = REJEITADA, `motivo_rejeicao` é obrigatório.
 *  - `hash` precisa ser hex de 64 chars (SHA-256).
 */
export const CitacaoVerificadaSchema = z
  .object({
    /** Identificador único da citação dentro de uma análise. */
    id: z.string().min(1, "id da citação não pode ser vazio"),

    /** Tipo do dispositivo / fonte normativa. */
    tipo_fonte: TipoFonteSchema,

    /** Nome legível da norma (ex.: "Lei nº 14.133/2021"). */
    norma: z.string().min(1, "norma é obrigatória"),

    /**
     * Identificador estruturado do dispositivo
     * (ex.: "art. 124, § 1º, II" ou "Acórdão 1.234/2023-Plenário").
     */
    artigo: z.string().min(1, "artigo / identificador é obrigatório"),

    /**
     * Slug canônico da norma (ex.: "lei-14133-2021"), quando conhecido.
     *
     * Preenchido pelo Pesquisador a partir dos resultados das tools de
     * busca (que já trazem o `norma_id` do filesystem). Quando presente,
     * o Auditor usa-o direto para verificar via `fs_ler_dispositivo`,
     * dispensando o resolvedor heurístico.
     */
    norma_id: z.string().min(1).optional(),

    /**
     * Referência estruturada do dispositivo para chamada de tool.
     *
     * Preenchido pelo Pesquisador a partir das tools (artigo numérico do
     * filesystem). Quando presente, o Auditor o usa direto em vez de
     * parsear o campo `artigo` (string legível).
     */
    dispositivo: z
      .object({
        artigo: z.number().int().min(1),
        paragrafo: z.union([z.number().int().min(0), z.string()]).optional(),
        inciso: z.string().optional(),
        alinea: z.string().optional(),
      })
      .optional(),

    /**
     * Texto literal do dispositivo conforme aparece na fonte oficial.
     *
     * NÃO é resumo nem paráfrase — é a transcrição que o Auditor
     * vai comparar byte-a-byte (após normalização de whitespace)
     * contra o filesystem.
     */
    texto_literal: z.string().min(1, "texto_literal é obrigatório"),

    /**
     * Hash SHA-256 (hex, 64 chars) do `texto_literal` normalizado.
     *
     * Permite detecção rápida de divergência sem comparar strings
     * longas e identifica unicamente a "versão" do dispositivo
     * que sustenta o parecer.
     */
    hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, "hash deve ser SHA-256 em hex (64 chars)"),

    /** Veredito do Auditor. */
    status: StatusCitacaoSchema,

    /**
     * URL ou path para a fonte canônica (R2 ou Planalto).
     * Pode ser nulo quando a fonte ainda não foi resolvida.
     */
    fonte_url: z.string().url().nullable().optional(),

    /**
     * Motivo da rejeição (obrigatório quando `status` = REJEITADA).
     *
     * Exemplos comuns:
     *  - "Dispositivo inexistente na Lei 14.133/2021"
     *  - "Texto literal diverge do filesystem em 17 caracteres"
     *  - "Norma revogada — vigência encerrada em 2021-04-01"
     */
    motivo_rejeicao: z.string().min(1).nullable().optional(),
  })
  .refine(
    (c) => c.status !== "APROVADA" || !c.motivo_rejeicao,
    {
      message:
        "Citação APROVADA não pode ter motivo_rejeicao",
      path: ["motivo_rejeicao"],
    },
  )
  .refine(
    (c) =>
      c.status !== "REJEITADA" ||
      (typeof c.motivo_rejeicao === "string" && c.motivo_rejeicao.length > 0),
    {
      message: "Citação REJEITADA precisa informar motivo_rejeicao",
      path: ["motivo_rejeicao"],
    },
  );

export type CitacaoVerificada = z.infer<typeof CitacaoVerificadaSchema>;
