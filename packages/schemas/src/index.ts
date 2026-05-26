/**
 * @vectorgov-t/schemas
 *
 * Zod schemas compartilhados entre os apps do monorepo.
 *
 * Atualmente expõe:
 *   - `pipeline`: schemas do output do parser (ParseResult, DispositivoChunk,
 *     NormaMetadata) — espelham os modelos Pydantic do Container.
 *   - `ingestion`: schemas dos endpoints do orchestrator (IngestaoIniciarInput,
 *     IngestaoStatus, IngestaoFase).
 *
 * Schemas a serem implementados na task F2.F.4:
 *   - PeticaoSchema
 *   - AnaliseReequilibrioSchema
 *   - ParecerSchema
 *   - CitacaoVerificadaSchema
 *   - CalculoTributarioSchema
 */

export const VERSION = "0.1.0";

export * from "./pipeline.js";
export * from "./ingestion.js";
