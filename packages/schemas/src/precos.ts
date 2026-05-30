/**
 * Schemas de Preços Públicos + aderência + documentos de suporte (Tier 1).
 *
 * Insumo determinístico da análise de **vantajosidade**. Os campos espelham a
 * resposta real do módulo "Preços Praticados" do Compras.gov.br (validada
 * contra o CATMAT 269894 — luva de procedimento). Ver
 * docs/design/precos-e-pesquisa-web.md (Módulos B e C).
 *
 * Dois cuidados que a resposta real impõe:
 *  1. `precoUnitario` vem em REAIS com decimais → convertemos para **centavos**
 *     (BRL int) com `Math.round(precoUnitario * 100)`.
 *  2. O preço é por **unidade de fornecimento** (ex.: R$ 22,50 / CAIXA de 100),
 *     não por unidade de medida. Misturar unidades distintas na mediana produz
 *     lixo — por isso a amostra carrega a unidade de fornecimento e a agregação
 *     trabalha sobre a unidade predominante (as fora-de-unidade são descartadas
 *     e contadas, igual ao portão de aderência).
 */
import { z } from "zod";
import { TipoCatalogoSchema } from "./catalogo.js";

const DATA_YMD = /^\d{4}-\d{2}-\d{2}$/;

/** De onde a amostra de preço veio. */
export const FontePrecoSchema = z.enum([
  "compras_gov_precos_praticados",
  "pncp_14133_homologado",
]);
export type FontePreco = z.infer<typeof FontePrecoSchema>;

/**
 * Uma amostra de preço praticado. `descricao`/`descricao_detalhada` são o que
 * o portão de aderência avalia; `unidade_fornecimento`/`capacidade_fornecimento`
 * o que a normalização de unidade considera. `id_compra` é a chave de
 * proveniência verificável.
 */
export const AmostraPrecoSchema = z.object({
  codigo_item: z.number().int().positive(),
  descricao: z.string().min(1),
  descricao_detalhada: z.string().nullable().default(null),
  objeto_compra: z.string().nullable().default(null),
  valor_unitario_centavos: z.number().int().nonnegative(),
  // Unidade de fornecimento (ex.: "CX" capacidade 100) — base da normalização.
  unidade_fornecimento: z.string().nullable().default(null),
  capacidade_fornecimento: z.number().positive().nullable().default(null),
  unidade_medida: z.string().nullable().default(null),
  quantidade: z.number().nonnegative().nullable().default(null),
  marca: z.string().nullable().default(null),
  fornecedor: z.string().nullable().default(null),
  ni_fornecedor: z.string().nullable().default(null),
  uasg: z.string().nullable().default(null),
  orgao: z.string().nullable().default(null),
  uf: z.string().length(2).nullable().default(null),
  municipio: z.string().nullable().default(null),
  poder: z.string().nullable().default(null),
  esfera: z.string().nullable().default(null),
  data_compra: z.string().regex(DATA_YMD).nullable().default(null),
  forma: z.string().nullable().default(null),
  id_compra: z.string().min(1),
  fonte_url: z.string().url().nullable().default(null),
  // Portão de aderência (médio): descrição do item + corroboração da ata.
  aderente: z.boolean(),
  aderencia_score: z.number().min(0).max(1).nullable().default(null),
  aderencia_motivo: z.string().nullable().default(null),
});
export type AmostraPreco = z.infer<typeof AmostraPrecoSchema>;

/**
 * Estatística agregada das amostras **aderentes e na unidade predominante**.
 * Mediana = preço de referência (recomendação TCU / IN 65/2021).
 * `n_descartadas_aderencia` + `n_descartadas_unidade` dão transparência
 * anti-lixo (quantas amostras saíram e por quê).
 */
export const EstatisticasPrecoSchema = z.object({
  n: z.number().int().nonnegative(),
  n_descartadas_aderencia: z.number().int().nonnegative().default(0),
  n_descartadas_unidade: z.number().int().nonnegative().default(0),
  unidade_fornecimento_base: z.string().nullable(),
  mediana_centavos: z.number().int().nonnegative().nullable(),
  media_centavos: z.number().int().nonnegative().nullable(),
  p25_centavos: z.number().int().nonnegative().nullable(),
  p75_centavos: z.number().int().nonnegative().nullable(),
  min_centavos: z.number().int().nonnegative().nullable(),
  max_centavos: z.number().int().nonnegative().nullable(),
  janela_inicio: z.string().regex(DATA_YMD).nullable(),
  janela_fim: z.string().regex(DATA_YMD).nullable(),
});
export type EstatisticasPreco = z.infer<typeof EstatisticasPrecoSchema>;

/** Documento de suporte da pesquisa de preços (exigência legal). */
export const DocumentoSuporteSchema = z.object({
  tipo: z.enum([
    "ata_registro_preco",
    "contratacao",
    "termo_referencia",
    "edital",
    "outro",
  ]),
  titulo: z.string().min(1),
  id_pncp: z.string().nullable().default(null),
  url: z.string().url(),
  orgao: z.string().nullable().default(null),
  data: z.string().regex(DATA_YMD).nullable().default(null),
});
export type DocumentoSuporte = z.infer<typeof DocumentoSuporteSchema>;

/**
 * Preço de referência consolidado para um objeto — saída da tool
 * `consultar_precos_praticados`. Reúne estatística, amostras (com aderência e
 * unidade) e documentos de suporte; alimenta o juízo de vantajosidade.
 */
export const PrecoReferenciaSchema = z.object({
  codigo_item: z.number().int().positive(),
  descricao_objeto: z.string().min(1),
  tipo: TipoCatalogoSchema,
  fonte: FontePrecoSchema,
  estatisticas: EstatisticasPrecoSchema,
  amostras: z.array(AmostraPrecoSchema),
  documentos_suporte: z.array(DocumentoSuporteSchema).default([]),
  consultado_em: z.string().datetime(),
});
export type PrecoReferencia = z.infer<typeof PrecoReferenciaSchema>;

/**
 * Input da tool `consultar_precos_praticados`. `codigo_item` é o CATMAT/CATSER
 * (resolvido antes via catálogo); `descricao_objeto` alimenta o portão de
 * aderência. Janela e UF são filtros opcionais.
 */
export const ConsultarPrecosInputSchema = z.object({
  codigo_item: z.number().int().positive(),
  descricao_objeto: z.string().min(3),
  tipo: TipoCatalogoSchema.default("material"),
  uf: z.string().length(2).optional(),
  data_inicio: z.string().regex(DATA_YMD).optional(),
  data_fim: z.string().regex(DATA_YMD).optional(),
});
export type ConsultarPrecosInput = z.infer<typeof ConsultarPrecosInputSchema>;
