/**
 * Schemas Zod para as 9 tools MCP da Fase 2 / Track D.
 *
 * Organização:
 *   - 4 tools semânticas: `buscar_legislacao`, `consultar_artigo`,
 *     `listar_artigos_por_tema`, `comparar_redacoes`.
 *   - 5 tools filesystem: `fs_listar_normas`, `fs_listar_estrutura`,
 *     `fs_ler_dispositivo`, `fs_ler_intervalo`, `fs_grep`.
 *
 * Cada par Input/Output usa Zod v4 e exporta também o tipo TypeScript
 * inferido. Schemas mantêm validação estrita (tipos primitivos exatos +
 * defaults explícitos) para que a serialização para JSON Schema (consumida
 * pelo MCP Inspector e pelos agentes) seja determinística.
 */

import { z } from "zod";

const ParagrafoRefSchema = z.union([
  z.number().int().min(0),
  z.string().trim().min(1),
]);

// ============================================================================
// Tipos auxiliares — referenciados por várias tools
// ============================================================================

/**
 * Citação canônica de um dispositivo (norma + hierarquia).
 *
 * Usado em respostas de busca e leitura para o agente sempre poder
 * voltar à fonte exata.
 */
export const CitacaoSchema = z.object({
  norma_id: z.string(),
  norma_label: z.string(),
  artigo: z.number().int().nullable().optional(),
  paragrafo: ParagrafoRefSchema.nullable().optional(),
  inciso: z.string().nullable().optional(),
  alinea: z.string().nullable().optional(),
  hierarquia_path: z.string(),
});
export type Citacao = z.infer<typeof CitacaoSchema>;

/**
 * Snippet textual com metadados — bloco base devolvido por buscas.
 */
export const SnippetSchema = z.object({
  citacao: CitacaoSchema,
  texto: z.string(),
  score: z.number().optional(),
  tipo_dispositivo: z.string().optional(),
});
export type Snippet = z.infer<typeof SnippetSchema>;

// ============================================================================
// Tool 1: buscar_legislacao — busca híbrida (semantic + BM25 + RRF + rerank)
// ============================================================================

export const BuscarLegislacaoInput = z.object({
  query: z.string().min(3, "query deve ter ao menos 3 caracteres"),
  top_k: z.number().int().min(1).max(20).default(5),
  filtros: z
    .object({
      lei: z.string().optional(),
      tema: z.string().optional(),
      tipo_dispositivo: z.string().optional(),
    })
    .optional(),
});
export type BuscarLegislacaoInputT = z.infer<typeof BuscarLegislacaoInput>;

export const BuscarLegislacaoOutput = z.object({
  resultados: z.array(SnippetSchema),
  total: z.number().int(),
  query_normalizada: z.string(),
  metodo: z.literal("hybrid_rrf_rerank"),
});
export type BuscarLegislacaoOutputT = z.infer<typeof BuscarLegislacaoOutput>;

// ============================================================================
// Tool 2: consultar_artigo — lookup direto via D1 (sem embedding)
// ============================================================================

export const ConsultarArtigoInput = z.object({
  norma_id: z.string().min(1),
  artigo: z.number().int().min(1),
  paragrafo: ParagrafoRefSchema.optional(),
  inciso: z.string().optional(),
  alinea: z.string().optional(),
  /**
   * Data de referência (YYYY-MM-DD) para resolver a VIGÊNCIA por competência.
   * Quando informada, devolve a redação em vigor NAQUELA data (norma é alvo
   * móvel — LC 214 já alterada pela LC 227/2026); quando omitida, devolve a
   * redação vigente ATUAL (compatibilidade com o comportamento anterior).
   */
  data_referencia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "data_referencia deve ser YYYY-MM-DD")
    .optional(),
});
export type ConsultarArtigoInputT = z.infer<typeof ConsultarArtigoInput>;

export const ConsultarArtigoOutput = z.object({
  encontrado: z.boolean(),
  citacao: CitacaoSchema.optional(),
  texto: z.string().optional(),
  versao_vigente: z
    .object({
      data_inicio: z.string(),
      data_fim: z.string().nullable(),
      norma_que_alterou: z.string().nullable(),
    })
    .optional(),
});
export type ConsultarArtigoOutputT = z.infer<typeof ConsultarArtigoOutput>;

// ============================================================================
// Tool 3: listar_artigos_por_tema — Vectorize com filtro metadata
// ============================================================================

export const ListarArtigosPorTemaInput = z.object({
  tema: z.string().min(1),
  lei: z.string().optional(),
  top_k: z.number().int().min(1).max(50).default(20),
});
export type ListarArtigosPorTemaInputT = z.infer<typeof ListarArtigosPorTemaInput>;

export const ListarArtigosPorTemaOutput = z.object({
  tema: z.string(),
  artigos: z.array(
    z.object({
      citacao: CitacaoSchema,
      score: z.number(),
      preview: z.string(),
    }),
  ),
  total: z.number().int(),
});
export type ListarArtigosPorTemaOutputT = z.infer<typeof ListarArtigosPorTemaOutput>;

// ============================================================================
// Tool 4: comparar_redacoes — diff entre versões de um dispositivo
// ============================================================================

export const CompararRedacoesInput = z.object({
  dispositivo_id: z.string().min(1),
  data_a: z.string().optional(),
  data_b: z.string().optional(),
});
export type CompararRedacoesInputT = z.infer<typeof CompararRedacoesInput>;

export const VersaoSchema = z.object({
  data_inicio: z.string(),
  data_fim: z.string().nullable(),
  texto: z.string(),
  norma_que_alterou: z.string().nullable(),
});
export type Versao = z.infer<typeof VersaoSchema>;

export const DiffSegmentSchema = z.object({
  tipo: z.enum(["igual", "adicionado", "removido"]),
  texto: z.string(),
});
export type DiffSegment = z.infer<typeof DiffSegmentSchema>;

export const CompararRedacoesOutput = z.object({
  dispositivo_id: z.string(),
  versao_a: VersaoSchema,
  versao_b: VersaoSchema,
  diff: z.array(DiffSegmentSchema),
  resumo: z.object({
    palavras_iguais: z.number().int(),
    palavras_adicionadas: z.number().int(),
    palavras_removidas: z.number().int(),
  }),
});
export type CompararRedacoesOutputT = z.infer<typeof CompararRedacoesOutput>;

// ============================================================================
// Tool 5: fs_listar_normas — índice de normas via R2 + KV cache
// ============================================================================

export const FsListarNormasInput = z.object({
  tipo: z.string().optional(),
});
export type FsListarNormasInputT = z.infer<typeof FsListarNormasInput>;

export const FsListarNormasOutput = z.object({
  normas: z.array(
    z.object({
      norma_id: z.string(),
      tipo: z.string(),
      numero: z.string(),
      ano: z.number().int(),
      ementa: z.string().nullable(),
      r2_path: z.string(),
    }),
  ),
  total: z.number().int(),
  fonte: z.enum(["cache", "r2"]),
});
export type FsListarNormasOutputT = z.infer<typeof FsListarNormasOutput>;

// ============================================================================
// Tool 6: fs_listar_estrutura — sumário hierárquico de uma norma
// ============================================================================

export const FsListarEstruturaInput = z.object({
  norma_id: z.string().min(1),
});
export type FsListarEstruturaInputT = z.infer<typeof FsListarEstruturaInput>;

export const NoEstruturaSchema: z.ZodType<{
  tipo: string;
  numero: string | null;
  titulo: string | null;
  caminho: string;
  filhos: Array<{
    tipo: string;
    numero: string | null;
    titulo: string | null;
    caminho: string;
    filhos: unknown[];
  }>;
}> = z.lazy(() =>
  z.object({
    tipo: z.string(),
    numero: z.string().nullable(),
    titulo: z.string().nullable(),
    caminho: z.string(),
    filhos: z.array(NoEstruturaSchema),
  }),
);

export const FsListarEstruturaOutput = z.object({
  norma_id: z.string(),
  estrutura: z.array(NoEstruturaSchema),
  total_dispositivos: z.number().int(),
});
export type FsListarEstruturaOutputT = z.infer<typeof FsListarEstruturaOutput>;

// ============================================================================
// Tool 7: fs_ler_dispositivo — R2 first, fallback D1, com paginação
// ============================================================================

export const FsLerDispositivoInput = z.object({
  norma_id: z.string().min(1),
  artigo: z.number().int().min(1),
  paragrafo: ParagrafoRefSchema.optional(),
  inciso: z.string().optional(),
  alinea: z.string().optional(),
  max_tokens: z.number().int().min(100).max(8000).default(4000),
  cursor: z.number().int().min(0).default(0),
});
export type FsLerDispositivoInputT = z.infer<typeof FsLerDispositivoInput>;

export const FsLerDispositivoOutput = z.object({
  citacao: CitacaoSchema,
  texto: z.string(),
  tokens_aprox: z.number().int(),
  proximo_cursor: z.number().int().nullable(),
  truncado: z.boolean(),
  fonte: z.enum(["r2", "d1"]),
});
export type FsLerDispositivoOutputT = z.infer<typeof FsLerDispositivoOutput>;

// ============================================================================
// Tool 8: fs_ler_intervalo — múltiplos dispositivos em paralelo
// ============================================================================

export const FsLerIntervaloInput = z.object({
  norma_id: z.string().min(1),
  artigo_inicio: z.number().int().min(1),
  artigo_fim: z.number().int().min(1),
});
export type FsLerIntervaloInputT = z.infer<typeof FsLerIntervaloInput>;

export const FsLerIntervaloOutput = z.object({
  norma_id: z.string(),
  dispositivos: z.array(
    z.object({
      citacao: CitacaoSchema,
      texto: z.string(),
      fonte: z.enum(["r2", "d1"]),
    }),
  ),
  total: z.number().int(),
  truncado: z.boolean(),
});
export type FsLerIntervaloOutputT = z.infer<typeof FsLerIntervaloOutput>;

// ============================================================================
// Tool 9: fs_grep — D1 FTS5 default, RE2-WASM se regex=true
// ============================================================================

export const FsGrepInput = z.object({
  padrao: z.string().min(1),
  regex: z.boolean().default(false),
  norma_id: z.string().optional(),
  max_resultados: z.number().int().min(1).max(100).default(20),
});
export type FsGrepInputT = z.infer<typeof FsGrepInput>;

export const FsGrepOutput = z.object({
  padrao: z.string(),
  modo: z.enum(["fts5", "regex"]),
  resultados: z.array(
    z.object({
      citacao: CitacaoSchema,
      texto: z.string(),
      score: z.number().optional(),
    }),
  ),
  total: z.number().int(),
  fonte: z.enum(["cache", "live"]),
});
export type FsGrepOutputT = z.infer<typeof FsGrepOutput>;

// ============================================================================
// Tool 10: calcular_reequilibrio_tributario — engine determinística pós-Reforma
// ============================================================================

/**
 * Cálculo do diferencial de carga tributária entre o regime pré-Reforma
 * (PIS/Cofins/ICMS/ISS) e o regime pós-Reforma (CBS + IBS) ao longo do
 * período de transição (2026-2033+), com aplicação opcional do redutor
 * de compras governamentais (LC 214/2025, Arts. 472-473 e 601 do Decreto
 * 12955/2026).
 */

export const RegimeTributarioPreSchema = z.enum([
  "lucro_real",
  "lucro_presumido",
  "simples_nacional",
  "imune",
]);
export type RegimeTributarioPre = z.infer<typeof RegimeTributarioPreSchema>;

export const EnteContratanteSchema = z.enum([
  "uniao",
  "estado",
  "municipio",
  "df",
  "autarquia",
  "fundacao_publica",
  "nao_se_aplica",
]);
export type EnteContratante = z.infer<typeof EnteContratanteSchema>;

export const CalcularReequilibrioInput = z
  .object({
    contrato: z.object({
      numero: z.string().min(1),
      valor_centavos: z.number().int().positive(),
      data_assinatura: z.string().min(10),
      vigencia_inicio: z.string().min(10),
      vigencia_fim: z.string().min(10),
      regime_tributario_pre: RegimeTributarioPreSchema,
      is_compra_governamental: z.boolean(),
      ente_contratante: EnteContratanteSchema,
    }),
    aliquotas_pre: z.object({
      pis_pct: z.number().min(0).max(100).default(1.65),
      cofins_pct: z.number().min(0).max(100).default(7.6),
      icms_pct: z.number().min(0).max(100).default(0),
      iss_pct: z.number().min(0).max(100).default(0),
      irpj_csll_pct: z.number().min(0).max(100).default(0),
    }),
    parametros_calculo: z.object({
      aliquotas_referencia_publicadas: z.object({
        cbs_pct: z.number().min(0).max(100).nullable(),
        ibs_pct: z.number().min(0).max(100).nullable(),
      }),
      redutor_compras_govern_pct: z.number().min(0).max(100).nullable(),
      creditos_estimados_pct: z.number().min(0).max(100).default(0),
    }),
  })
  .refine(
    (i) => i.contrato.vigencia_fim >= i.contrato.vigencia_inicio,
    {
      message: "vigencia_fim deve ser >= vigencia_inicio",
      path: ["contrato", "vigencia_fim"],
    },
  )
  .refine(
    (i) =>
      !i.contrato.is_compra_governamental ||
      i.contrato.ente_contratante !== "nao_se_aplica",
    {
      message:
        "Compra governamental requer ente_contratante diferente de 'nao_se_aplica'",
      path: ["contrato", "ente_contratante"],
    },
  );
export type CalcularReequilibrioInputT = z.infer<
  typeof CalcularReequilibrioInput
>;

export const CargaPosAnoSchema = z.object({
  ano: z.number().int().min(2026).max(2050),
  cbs_pct: z.number().min(0).max(100),
  ibs_pct: z.number().min(0).max(100),
  redutor_aplicado_pct: z.number().min(0).max(100).nullable(),
  carga_bruta_pct: z.number().min(0).max(100),
  carga_efetiva_pct: z.number().min(0).max(100),
  compensacao_pis_cofins: z.boolean(),
  fundamento: z.string().min(1),
});
export type CargaPosAno = z.infer<typeof CargaPosAnoSchema>;

export const PassoMemoriaSchema = z.object({
  passo: z.number().int().min(1),
  descricao: z.string().min(1),
  formula: z.string().min(1),
  inputs: z.record(z.string(), z.number().finite()),
  resultado: z.number().finite(),
  unidade: z.string().min(1),
});
export type PassoMemoria = z.infer<typeof PassoMemoriaSchema>;

export const BaseLegalItemSchema = z.object({
  norma: z.string().min(1),
  artigo: z.string().min(1),
  resumo: z.string().min(1),
});
export type BaseLegalItem = z.infer<typeof BaseLegalItemSchema>;

export const CalcularReequilibrioOutput = z.object({
  sucesso: z.boolean(),
  placeholder: z.literal(false),
  carga_pre: z.object({
    pct_total: z.number().min(0).max(100),
    composicao: z.object({
      pis_pct: z.number(),
      cofins_pct: z.number(),
      icms_pct: z.number(),
      iss_pct: z.number(),
      irpj_csll_pct: z.number(),
    }),
    base_legal: z.array(z.string()),
  }),
  carga_pos_por_ano: z.array(CargaPosAnoSchema),
  diferencial: z.object({
    pct_medio_ponderado: z.number(),
    valor_anual_centavos: z.number().int(),
    valor_remanescente_contrato_centavos: z.number().int(),
    meses_remanescentes: z.number().int().min(0),
  }),
  memoria_calculo: z.array(PassoMemoriaSchema),
  base_legal: z.array(BaseLegalItemSchema),
  alertas: z.array(z.string()),
  erro: z.string().nullable(),
});
export type CalcularReequilibrioOutputT = z.infer<
  typeof CalcularReequilibrioOutput
>;

// ============================================================================
// classificar_merito — regra DETERMINÍSTICA do veredito ("LLM propõe, regra decide")
// ============================================================================

export const VereditoMeritoSchema = z.enum([
  "procedente",
  "parcialmente_procedente",
  "improcedente",
  "diligencia",
]);
export type VereditoMerito = z.infer<typeof VereditoMeritoSchema>;

export const MotivoMeritoSchema = z.enum([
  "fora_de_escopo",
  "intempestivo",
  "comprovacao_insuficiente",
  "carga_reduzida",
  "sem_desequilibrio",
  "imaterial",
  "pleito_integral",
  "pleito_excede_delta",
]);
export type MotivoMerito = z.infer<typeof MotivoMeritoSchema>;

export const ClassificarMeritoInput = z.object({
  /**
   * Diferencial de carga em VALOR, em CENTAVOS. Vem da tool #10
   * (`diferencial.valor_remanescente_contrato_centavos`). Pode ser NEGATIVO
   * (Reforma reduziu a carga → reequilíbrio em favor da Administração).
   */
  delta_valor_centavos: z.number().int(),
  /**
   * Diferencial de carga em PONTOS PERCENTUAIS (NÃO é fração!). Vem da tool
   * #10 (`diferencial.pct_medio_ponderado`). Ex.: 2.5 = 2,5 p.p.
   */
  delta_percentual_pp: z.number(),
  /**
   * Valor pleiteado pelo requerente, em CENTAVOS. `null` quando a petição NÃO
   * quantificou o pedido — tratado como falta de instrução (art. 376, IV),
   * não como zero.
   */
  valor_pleiteado_centavos: z.number().int().nonnegative().nullable(),
  /** Flags de admissibilidade (juízo do Analista, já estruturado em booleanos). */
  admissibilidade: z.object({
    no_escopo: z.boolean(), // art. 373
    tempestivo: z.boolean(), // art. 376, II
    instruido: z.boolean(), // art. 376, IV
  }),
  /** Desequilíbrio efetivamente comprovado (art. 374 caput + 376, IV). */
  comprovacao_suficiente: z.boolean(),
  /**
   * Limiar de materialidade em PONTOS PERCENTUAIS (metodologia do órgão,
   * art. 376, §3º — parametrizável). Default 0.5 p.p. ATENÇÃO: é p.p., NÃO
   * fração — 0,5% aqui é `0.5`, não `0.005`.
   */
  limiar_materialidade_pp: z.number().min(0).default(0.5),
});
export type ClassificarMeritoInputT = z.infer<typeof ClassificarMeritoInput>;

export const ClassificarMeritoOutput = z.object({
  veredito: VereditoMeritoSchema,
  /** Valor reconhecido, em CENTAVOS. 0 quando improcedente/diligencia. */
  valor_reconhecido_centavos: z.number().int().nonnegative(),
  motivo: MotivoMeritoSchema,
  /**
   * True quando a Administração deve rever DE OFÍCIO para REDUZIR a
   * remuneração (art. 375 — carga tributária caiu). Só ocorre em
   * `carga_reduzida`.
   */
  revisao_de_oficio: z.boolean(),
  /** Regra aplicada + dispositivo legal, para rastreabilidade. */
  fundamento: z.string().min(1),
});
export type ClassificarMeritoOutputT = z.infer<typeof ClassificarMeritoOutput>;

// ============================================================================
// Catálogo agregado — útil para o handler MCP montar `tools/list`
// ============================================================================

/**
 * Lista de nomes das 11 tools registradas (snake_case conforme convenção MCP).
 * Em sync com o registry em `apps/mcp-server/src/mcp/tools/registry.ts`.
 */
export const MCP_TOOL_NAMES = [
  "buscar_legislacao",
  "consultar_artigo",
  "listar_artigos_por_tema",
  "comparar_redacoes",
  "fs_listar_normas",
  "fs_listar_estrutura",
  "fs_ler_dispositivo",
  "fs_ler_intervalo",
  "fs_grep",
  "calcular_reequilibrio_tributario",
  "classificar_merito",
  "consultar_precos_praticados",
  "pesquisar_web",
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
