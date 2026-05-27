/**
 * Barrel do módulo `roles/` — exporta as 8 factory functions
 * e os schemas / tipos de I/O internos.
 */
export { criarOrquestrador, type OrquestradorInput } from "./orchestrator.js";
export { criarPesquisador, type PesquisadorInput } from "./pesquisador.js";
export { criarAnalistaJuridico, type AnalistaInput } from "./analista.js";
export { criarEspLicitacoes, type EspLicitacoesInput } from "./esp-licitacoes.js";
export {
  criarEspReequilibrio,
  type EspReequilibrioInput,
} from "./esp-reequilibrio.js";
export { criarCalculista, type CalculistaInput } from "./calculista.js";
export { criarAuditor, type AuditorInput } from "./auditor.js";
export { criarRedator, type RedatorInput } from "./redator.js";

export {
  PlanoOrquestradorSchema,
  type PlanoOrquestrador,
  type Subtarefa,
  ResultadoPesquisaSchema,
  type ResultadoPesquisa,
  AnaliseJuridicaSchema,
  type AnaliseJuridica,
  ParecerLicitacaoSchema,
  type ParecerLicitacao,
  SinteseReequilibrioSchema,
  type SinteseReequilibrio,
  ResultadoCalculistaSchema,
  type ResultadoCalculista,
  RelatorioAuditorSchema,
  type RelatorioAuditor,
  TipoDocumentoRedatorSchema,
  type TipoDocumentoRedator,
} from "./_io-schemas.js";
