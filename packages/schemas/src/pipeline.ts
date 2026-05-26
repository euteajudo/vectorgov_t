/**
 * Schemas Zod do pipeline de ingestão — espelham o output do Container Python
 * (`apps/ingestion-api/legisparser/models/parse_result.py`) e estendem com
 * variantes específicas do Worker (chunks intermediários, metadados de norma).
 *
 * IMPORTANTE: o Container Python é a fonte da verdade do contrato. Sempre que
 * o `ParseResult` Pydantic mudar, esses schemas precisam ser atualizados em
 * conjunto e os testes do orchestrator reexecutados.
 */

import { z } from "zod";

/**
 * Tipos válidos de norma reconhecidos pelo parser.
 *
 * Lista derivada do `NormaMetadata.tipo` (Pydantic). Mantemos como enum aberto
 * via `.or(z.string())` em alguns pontos para não quebrar a ingestão se o
 * parser começar a emitir um tipo novo antes de bumparmos o schema — o tipo
 * desconhecido apenas viaja sem validação extra.
 */
export const NormaTipoSchema = z.enum([
  "lei_complementar",
  "decreto",
  "emenda_constitucional",
  "instrucao_normativa",
  "lei",
]);
export type NormaTipo = z.infer<typeof NormaTipoSchema>;

/**
 * Tipos válidos de dispositivo na hierarquia legal brasileira.
 */
export const TipoDispositivoSchema = z.enum([
  "artigo",
  "paragrafo",
  "inciso",
  "alinea",
  "anexo",
]);
export type TipoDispositivo = z.infer<typeof TipoDispositivoSchema>;

/**
 * Metadados de uma norma — espelha `NormaMetadata` do Pydantic.
 *
 * `ano` é número inteiro positivo; `data_publicacao` segue ISO-8601 (YYYY-MM-DD).
 * Validamos o formato sem usar `z.iso.date()` para manter compatibilidade
 * com Zod 4 sem depender de helpers que mudaram entre versões.
 */
export const NormaMetadataSchema = z.object({
  id: z.string().min(1),
  tipo: NormaTipoSchema.or(z.string().min(1)),
  numero: z.string().min(1),
  ano: z.number().int().positive(),
  data_publicacao: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "data_publicacao deve ser ISO YYYY-MM-DD"),
  ementa: z.string().default(""),
  orgao_emissor: z.string().nullable().optional(),
  status: z.string().default("vigente"),
});
export type NormaMetadata = z.infer<typeof NormaMetadataSchema>;

/**
 * Chunk de dispositivo individual — espelha `DispositivoChunk` do Pydantic.
 *
 * - `artigo` é número (1, 2, 473…). `paragrafo`, `inciso`, `alinea` são
 *   identificadores textuais (`'unico'`, `'I'`, `'a'`).
 * - `canonical_start/end` são offsets no texto canônico (não no PDF original).
 * - `citations` lista referências externas em formato `ID-NORMA ART-NNN`
 *   úteis para construir grafo de relações.
 */
export const DispositivoChunkSchema = z.object({
  id: z.string().min(1),
  norma_id: z.string().min(1),
  tipo_dispositivo: TipoDispositivoSchema.or(z.string().min(1)),
  artigo: z.number().int().nullable().optional(),
  paragrafo: z.string().nullable().optional(),
  inciso: z.string().nullable().optional(),
  alinea: z.string().nullable().optional(),
  hierarquia_path: z.string(),
  texto: z.string().min(1),
  canonical_start: z.number().int().nonnegative(),
  canonical_end: z.number().int().nonnegative(),
  page_number: z.number().int().positive().nullable().optional(),
  citations: z.array(z.string()).default([]),
});
export type DispositivoChunk = z.infer<typeof DispositivoChunkSchema>;

/**
 * Sumário hierárquico — estrutura recursiva navegável.
 *
 * O Container Python emite um `dict` arbitrário com chaves "tipo", "titulo",
 * "filhos" etc. Aceitamos `z.record(z.unknown())` em primeiro nível e
 * confiamos no consumidor (`fs_listar_estrutura`) para tipar mais a fundo.
 */
export const SumarioSchema = z.record(z.string(), z.unknown());
export type Sumario = z.infer<typeof SumarioSchema>;

/**
 * Resposta completa do parser — espelha `ParseResult` do Pydantic.
 *
 * `total_dispositivos` é redundante com `dispositivos.length` mas mantemos
 * para validar consistência (o teste do orchestrator compara os dois).
 */
export const ParseResultSchema = z.object({
  norma: NormaMetadataSchema,
  dispositivos: z.array(DispositivoChunkSchema).default([]),
  canonical_text: z.string(),
  canonical_hash: z.string().regex(/^[a-f0-9]{64}$/, "canonical_hash deve ser SHA256 hex"),
  sumario: SumarioSchema.default({}),
  total_dispositivos: z.number().int().nonnegative().default(0),
  tokens_aproximados: z.number().int().nonnegative().default(0),
  pdf_hash: z.string().regex(/^[a-f0-9]{64}$/, "pdf_hash deve ser SHA256 hex"),
});
export type ParseResult = z.infer<typeof ParseResultSchema>;
