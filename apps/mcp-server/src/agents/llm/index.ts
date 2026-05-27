/**
 * Barrel do submódulo de LLM client.
 */
export type {
  LLMClient,
  ModeloLLM,
  MensagemLLM,
  OpcoesGeracaoEstruturada,
  OpcoesStreamText,
  ResultadoGeracaoEstruturada,
  StreamEvent,
  ToolForLLM,
} from "./types.js";
export { MockLLMClient, criarMockLLM } from "./mock.js";
export type { MockLLMConfig, MockHandler, RegistroChamada } from "./mock.js";
export { GoogleLLMClient, criarGoogleLLM } from "./google.js";
