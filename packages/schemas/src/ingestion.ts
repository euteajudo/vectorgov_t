/**
 * Schemas Zod dos endpoints do orchestrator de ingestão.
 *
 * - `IngestaoIniciarInput`: payload aceito em `POST /ingestao/iniciar`.
 * - `IngestaoStatusSchema`: registro persistido em KV e devolvido em
 *   `GET /ingestao/status/:id`.
 *
 * O input chega como `multipart/form-data` (PDF + metadata). Esse schema
 * descreve a parte de metadata APÓS extração do FormData — o PDF é tratado
 * separadamente como `File`/`Blob`. Não tentamos validar o blob aqui porque
 * Zod não tem helper estável para `File` no runtime do Workers.
 */

import { z } from "zod";
import { NormaTipoSchema } from "./pipeline.js";

/**
 * Metadata textual aceita no `POST /ingestao/iniciar`.
 *
 * - `lei_id` deve ser slug normalizado (`lc-214-2025`), usado como prefixo R2.
 * - `lei_tipo` reusa `NormaTipoSchema` com fallback string aberto.
 * - `numero`/`ano`/`data_publicacao` repassados ao Container.
 */
export const IngestaoIniciarInputSchema = z.object({
  lei_id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "lei_id deve ser slug minúsculo (a-z, 0-9, -)"),
  lei_tipo: NormaTipoSchema.or(z.string().min(1)),
  numero: z.string().min(1),
  ano: z.number().int().positive(),
  data_publicacao: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "data_publicacao deve ser ISO YYYY-MM-DD"),
  // Quando `true`, força re-ingestão limpando tudo antes do upsert.
  // Default `false` deixa a re-ingestão como "substituição idempotente"
  // (limpa antes do upsert mesmo assim), mas o flag fica disponível para
  // futuras variações onde só queremos detectar conflito.
  reingestao: z.boolean().default(true),
});
export type IngestaoIniciarInput = z.infer<typeof IngestaoIniciarInputSchema>;

/**
 * Fases que o orchestrator percorre. Ordem reflete o fluxo real.
 *
 * - `pending`: registro criado, ainda não começou.
 * - `parsing`: chamando Container Python.
 * - `markdown`: gerando .md por dispositivo + upload R2.
 * - `embedding`: chamando bge-m3 em batches.
 * - `vectorize`: upsert no índice Vectorize.
 * - `d1`: insert em normas/dispositivos/versoes_dispositivos/FTS5.
 * - `indices`: atualizando _index.json e _sumario.json.
 * - `done`: tudo concluído com sucesso.
 * - `failed`: erro fatal em alguma fase (ver `erros[]`).
 */
export const IngestaoFaseSchema = z.enum([
  "pending",
  "parsing",
  "markdown",
  "embedding",
  "vectorize",
  "d1",
  "indices",
  "done",
  "failed",
]);
export type IngestaoFase = z.infer<typeof IngestaoFaseSchema>;

/**
 * Registro de progresso de uma ingestão — persistido em KV (`CACHE`) sob
 * a chave `ingestao:status:<id>` com TTL de 24h.
 *
 * - `progresso_pct` é inteiro 0..100, monotônico crescente.
 * - `total_dispositivos` é preenchido após o parse.
 * - `processados` cresce conforme o batch embedding/upsert avança.
 * - `erros[]` acumula warnings não fatais; em `fase = failed` o último item
 *   é a causa raiz.
 */
export const IngestaoStatusSchema = z.object({
  id: z.string().min(1),
  lei_id: z.string().min(1),
  fase: IngestaoFaseSchema,
  progresso_pct: z.number().int().min(0).max(100),
  total_dispositivos: z.number().int().nonnegative().default(0),
  processados: z.number().int().nonnegative().default(0),
  tokens_consumidos: z.number().int().nonnegative().default(0),
  erros: z
    .array(
      z.object({
        fase: IngestaoFaseSchema,
        mensagem: z.string(),
        timestamp: z.string(),
      }),
    )
    .default([]),
  iniciado_em: z.string(),
  atualizado_em: z.string(),
  finalizado_em: z.string().nullable().optional(),
});
export type IngestaoStatus = z.infer<typeof IngestaoStatusSchema>;
