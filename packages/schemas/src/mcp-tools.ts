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
  paragrafo: z.number().int().nullable().optional(),
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
  paragrafo: z.number().int().min(0).optional(),
  inciso: z.string().optional(),
  alinea: z.string().optional(),
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
  paragrafo: z.number().int().min(0).optional(),
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
// Catálogo agregado — útil para o handler MCP montar `tools/list`
// ============================================================================

/**
 * Lista de nomes das 9 tools registradas (snake_case conforme convenção MCP).
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
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
