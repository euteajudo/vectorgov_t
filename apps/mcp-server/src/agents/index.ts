/**
 * Barrel do módulo `agents/` — entry point único do sistema multi-agente.
 */
export * from "./types.js";
export * from "./llm/index.js";
export * from "./session-agent.js";
export * from "./notebook-agent.js";
export * from "./roles/index.js";
export {
  PEVSEngine,
  type PEVSConfig,
  type DecisaoFeature2,
  type ResultadoFeature1,
  type ResultadoFeature2,
} from "./pevs-engine.js";
export {
  TrackedLLMClient,
  estimateCostUsd,
  PRECOS_POR_MILHAO_USD,
  type SnapshotUso,
  type UsoPorModelo,
} from "./cost-tracker.js";
