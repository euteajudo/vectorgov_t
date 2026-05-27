/**
 * @vectorgov-t/schemas
 *
 * Zod schemas compartilhados entre os apps do monorepo.
 *
 * Re-exporta o módulo `mcp-tools` (F2.D) — schemas das 9 tools do MCP server.
 *
 * Futuro (F2.F.4):
 *   - PeticaoSchema
 *   - AnaliseReequilibrioSchema
 *   - ParecerSchema
 *   - CitacaoVerificadaSchema
 *   - CalculoTributarioSchema
 */

export const VERSION = "0.1.0";

export * from "./mcp-tools.js";
