/**
 * @vectorgov-t/schemas
 *
 * Zod schemas compartilhados entre os apps do monorepo.
 *
 * Schemas implementados na task F2.F.4:
 *   - PeticaoSchema           — input do Feature 1 (análise).
 *   - AnaliseReequilibrioSchema — output do Feature 1, assinada pelo Auditor.
 *   - ParecerSchema           — output do Feature 2, produzido pelo Redator.
 *   - CitacaoVerificadaSchema — citação após auditoria.
 *   - CalculoTributarioSchema — resultado do Calculista (placeholder Fase 2).
 *
 * Convenções:
 *   - Todos os schemas usam `.refine` para invariantes cruzados não
 *     expressáveis pela tipagem básica.
 *   - Valores monetários em **centavos** (BRL int) para evitar erro de
 *     ponto flutuante.
 *   - Datas: `YYYY-MM-DD` (calendário) ou ISO 8601 datetime (timestamps).
 *   - IDs: UUID v4 sempre.
 */

export * from "./peticao.js";
export * from "./analise.js";
export * from "./parecer.js";
export * from "./citacao.js";
export * from "./calculo.js";

export const VERSION = "0.1.0";
