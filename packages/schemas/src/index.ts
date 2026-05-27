/**
 * @vectorgov-t/schemas
 *
 * Zod schemas compartilhados entre os apps do monorepo.
 *
 * Expõe:
 *   - `pipeline`: schemas do output do parser (ParseResult, DispositivoChunk,
 *     NormaMetadata) — espelham os modelos Pydantic do Container.
 *   - `ingestion`: schemas dos endpoints do orchestrator (IngestaoIniciarInput,
 *     IngestaoStatus, IngestaoFase).
 *   - `mcp-tools`: schemas das 9 tools do MCP server (busca, consulta, filesystem).
 *   - `peticao`: input do Feature 1 (análise de pedido de reequilíbrio).
 *   - `analise`: output do Feature 1, assinada pelo Auditor.
 *   - `parecer`: output do Feature 2, produzido pelo Redator.
 *   - `citacao`: citação após auditoria (com hash SHA-256).
 *   - `calculo`: resultado do Calculista (placeholder Fase 2).
 *
 * Convenções dos schemas agênticos:
 *   - Todos usam `.refine` para invariantes cruzados não expressáveis pela
 *     tipagem básica.
 *   - Valores monetários em **centavos** (BRL int) para evitar erro de
 *     ponto flutuante.
 *   - Datas: `YYYY-MM-DD` (calendário) ou ISO 8601 datetime (timestamps).
 *   - IDs: UUID v4 sempre.
 */

export const VERSION = "0.1.0";

// Pipeline + ingestão (Tracks D + G)
export * from "./pipeline.js";
export * from "./ingestion.js";
export * from "./mcp-tools.js";

// Sistema agêntico (Track F)
export * from "./peticao.js";
export * from "./analise.js";
export * from "./parecer.js";
export * from "./citacao.js";
export * from "./calculo.js";
