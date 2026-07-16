/**
 * Schemas do Repositório de Catálogo (CATMAT/CATSER).
 *
 * O catálogo de itens do governo (~166k linhas) é indexado em dois modos —
 * semântico (Vectorize) e grep (D1 FTS5) — espelhando o módulo de leis. Serve
 * para resolver "descrição do objeto → código de catálogo", pré-requisito da
 * pesquisa de preço. Ver docs/design/precos-e-pesquisa-web.md (Módulo A).
 *
 * Motivo de existir: o código de catálogo é um *join key sujo* (cadastro
 * relapso na origem); achar o código aderente ao objeto é difícil até para
 * especialista, e exige busca semântica + varredura textual.
 */
import { z } from "zod";

/** Material (CATMAT) ou Serviço (CATSER). */
export const TipoCatalogoSchema = z.enum(["material", "servico"]);
export type TipoCatalogo = z.infer<typeof TipoCatalogoSchema>;

/**
 * Uma linha do catálogo. `codigo` é o `codigoItemCatalogo` aceito pelas APIs
 * de preço (Compras.gov.br). A hierarquia (grupo/classe) é opcional — nem todo
 * registro vem completo.
 */
export const ItemCatalogoSchema = z.object({
  codigo: z.number().int().positive(),
  tipo: TipoCatalogoSchema,
  descricao: z.string().min(1),
  grupo: z.string().nullable().default(null),
  classe: z.string().nullable().default(null),
  /**
   * @deprecated O catálogo-fonte não traz unidade de medida por item — o campo
   * era sempre `null` hardcoded. O worker do catálogo não o envia mais; fica
   * opcional (sem default) só para não quebrar consumidores antigos.
   */
  unidade_medida: z.string().nullable().optional(),
  /** Situação real do item na fonte (coluna `ativo` do D1), não mais hardcoded. */
  ativo: z.boolean().default(true),
  /**
   * Relevância do item para a query (opcional, retrocompatível): score do
   * rerank (0-1) quando houve rerank, ou score RRF no modo degradado.
   */
  score: z.number().optional(),
});
export type ItemCatalogo = z.infer<typeof ItemCatalogoSchema>;

/** Resultado de uma busca no catálogo (híbrida ou lexical). */
export const CatalogoBuscaResultadoSchema = z.object({
  // "semantico" permanece por retrocompat (consumidores antigos do mcp-server);
  // o worker dedicado responde "hibrido" para o modo 3-way + rerank.
  modo: z.enum(["semantico", "hibrido", "grep", "fuzzy"]),
  total: z.number().int().nonnegative(),
  itens: z.array(ItemCatalogoSchema),
});
export type CatalogoBuscaResultado = z.infer<typeof CatalogoBuscaResultadoSchema>;

/** Input da tool `buscar_catalogo_semantico` (descrição → código aderente). */
export const BuscarCatalogoInputSchema = z.object({
  descricao: z.string().min(3),
  tipo: TipoCatalogoSchema.optional(),
  top_k: z.number().int().min(1).max(20).default(8),
});
export type BuscarCatalogoInput = z.infer<typeof BuscarCatalogoInputSchema>;

/** Input da tool `grep_catalogo` (varredura textual exata, FTS5/BM25). */
export const GrepCatalogoInputSchema = z.object({
  padrao: z.string().min(2),
  tipo: TipoCatalogoSchema.optional(),
  max: z.number().int().min(1).max(50).default(20),
});
export type GrepCatalogoInput = z.infer<typeof GrepCatalogoInputSchema>;
