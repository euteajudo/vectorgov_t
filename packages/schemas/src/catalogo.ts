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
  unidade_medida: z.string().nullable().default(null),
  ativo: z.boolean().default(true),
});
export type ItemCatalogo = z.infer<typeof ItemCatalogoSchema>;

/** Resultado de uma busca no catálogo (semântica ou grep). */
export const CatalogoBuscaResultadoSchema = z.object({
  modo: z.enum(["semantico", "grep"]),
  total: z.number().int().nonnegative(),
  itens: z.array(ItemCatalogoSchema),
});
export type CatalogoBuscaResultado = z.infer<typeof CatalogoBuscaResultadoSchema>;
