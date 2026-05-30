/**
 * Schemas da Pesquisa Web (Tavily) — Tier 2, suplementar.
 *
 * Complementa os preços públicos quando o objeto não tem amostra pública
 * aderente suficiente. Confiança baixa: todo resultado carrega `url`
 * (proveniência obrigatória) e o conjunto é rotulado como suplementar, para o
 * Redator citar com ressalva. Ver docs/design/precos-e-pesquisa-web.md (Módulo D).
 */
import { z } from "zod";

/** Um resultado de busca web com proveniência. */
export const ResultadoWebSchema = z.object({
  titulo: z.string().min(1),
  url: z.string().url(),
  conteudo: z.string(),
  score: z.number().min(0).max(1).nullable().default(null),
  publicado_em: z.string().nullable().default(null),
});
export type ResultadoWeb = z.infer<typeof ResultadoWebSchema>;

/** Saída da tool `pesquisar_web`. `resposta_curta` = campo `answer` do Tavily. */
export const PesquisaWebResultadoSchema = z.object({
  query: z.string().min(1),
  resultados: z.array(ResultadoWebSchema),
  resposta_curta: z.string().nullable().default(null),
  tier: z.literal("suplementar").default("suplementar"),
  consultado_em: z.string().datetime(),
});
export type PesquisaWebResultado = z.infer<typeof PesquisaWebResultadoSchema>;

/** Input da tool `pesquisar_web` (Tavily search+extract). */
export const PesquisarWebInputSchema = z.object({
  query: z.string().min(3).max(400),
  max_resultados: z.number().int().min(1).max(10).default(5),
  topico: z.enum(["geral", "noticias"]).default("geral"),
});
export type PesquisarWebInput = z.infer<typeof PesquisarWebInputSchema>;
