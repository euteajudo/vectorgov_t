/**
 * Testa o fallback anti-resposta-vazia do `conversar()`: quando o condutor
 * termina sem emitir texto, a resposta nunca fica em branco.
 */
import { describe, it, expect } from "vitest";
import { conversar } from "../../src/agents/conversational/engine.js";
import { criarMockLLM } from "../../src/agents/llm/mock.js";
import { createTestEnv } from "../_fakes.js";
import type { NotebookAgent } from "../../src/agents/notebook-agent.js";
import type { ChatEvent } from "@vectorgov-t/schemas";

const notebookMock = {
  state: { id: { toString: () => "nb" } },
  getMeta: async () => ({
    documento_nome: "doc.pdf",
    documento_total_paginas: 1,
    documento_total_chars: 100,
  }),
  listarMensagens: async () => [],
  lerRascunho: async () => null,
} as unknown as NotebookAgent;

describe("conversar — fallback de resposta vazia", () => {
  it("texto vazio sem tool de transição → mensagem amigável + finish error", async () => {
    const env = createTestEnv();
    // streamText do mock devolve texto VAZIO (respostaPadrao "").
    const llm = criarMockLLM({}, () => "");
    const eventos: ChatEvent[] = [];
    const r = await conversar({
      env,
      llm,
      notebook: notebookMock,
      userText: "olá",
      onEvent: (e) => {
        eventos.push(e);
      },
      estado: "PETICAO_EXTRAIDA",
      apiKey: "via-ai-gateway",
    });
    // Nunca em branco.
    expect(r.texto.trim().length).toBeGreaterThan(0);
    expect(r.texto).toMatch(/tentar de novo|não consegui/i);
    expect(r.finish_reason).toBe("error");
    // O texto de fallback foi emitido como token (o cliente mostra algo).
    expect(
      eventos.some((e) => e.type === "token" && /tentar de novo/i.test(e.text)),
    ).toBe(true);
  });
});
