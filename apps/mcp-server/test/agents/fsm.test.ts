/**
 * Testes da FSM da conversa guiada (o micro-harness).
 *
 * Tudo aqui é puro: storage → estado, e estado → tools de transição. É a
 * peça que garante que o Gemini fica "na estrada".
 */
import { describe, expect, it } from "vitest";
import { PeticaoRascunhoSchema } from "@vectorgov-t/schemas";
import {
  derivarEstado,
  podeAnalisar,
  pendenciasParaAnalisar,
  toolsDeTransicaoPermitidas,
} from "../../src/agents/conversational/fsm.js";

describe("FSM — derivarEstado (storage → fase)", () => {
  it("AGUARDANDO_DOCUMENTO quando não há documento", () => {
    expect(
      derivarEstado({ temDocumento: false, temRascunho: false, analiseId: null, temParecer: false }),
    ).toBe("AGUARDANDO_DOCUMENTO");
  });
  it("DOCUMENTO_RECEBIDO com documento mas sem rascunho", () => {
    expect(
      derivarEstado({ temDocumento: true, temRascunho: false, analiseId: null, temParecer: false }),
    ).toBe("DOCUMENTO_RECEBIDO");
  });
  it("PETICAO_EXTRAIDA com rascunho mas sem análise", () => {
    expect(
      derivarEstado({ temDocumento: true, temRascunho: true, analiseId: null, temParecer: false }),
    ).toBe("PETICAO_EXTRAIDA");
  });
  it("ANALISE_PRONTA com análise mas sem parecer", () => {
    expect(
      derivarEstado({ temDocumento: true, temRascunho: true, analiseId: "a1", temParecer: false }),
    ).toBe("ANALISE_PRONTA");
  });
  it("PARECER_GERADO com parecer", () => {
    expect(
      derivarEstado({ temDocumento: true, temRascunho: true, analiseId: "a1", temParecer: true }),
    ).toBe("PARECER_GERADO");
  });
});

describe("FSM — guarda podeAnalisar", () => {
  const vazio = PeticaoRascunhoSchema.parse({});
  const completo = PeticaoRascunhoSchema.parse({
    contrato_valor_centavos: 100_000,
    resumo_pedido: "A".repeat(60),
  });

  it("bloqueia quando falta valor e fato", () => {
    expect(podeAnalisar(vazio)).toBe(false);
    expect(pendenciasParaAnalisar(vazio).length).toBeGreaterThan(0);
  });
  it("libera com valor > 0 e fato >= 50 chars", () => {
    expect(podeAnalisar(completo)).toBe(true);
    expect(pendenciasParaAnalisar(completo)).toEqual([]);
  });
});

describe("FSM — gating de tools de transição", () => {
  it("AGUARDANDO_DOCUMENTO e PARECER_GERADO não expõem transição", () => {
    expect(toolsDeTransicaoPermitidas("AGUARDANDO_DOCUMENTO")).toEqual([]);
    expect(toolsDeTransicaoPermitidas("PARECER_GERADO")).toEqual([]);
  });
  it("DOCUMENTO_RECEBIDO só expõe extrair", () => {
    expect(toolsDeTransicaoPermitidas("DOCUMENTO_RECEBIDO")).toEqual([
      "extrair_peticao_do_documento",
    ]);
  });
  it("PETICAO_EXTRAIDA expõe extrair + analisar", () => {
    expect(toolsDeTransicaoPermitidas("PETICAO_EXTRAIDA")).toContain("analisar_reequilibrio");
  });
  it("ANALISE_PRONTA só expõe gerar_parecer", () => {
    expect(toolsDeTransicaoPermitidas("ANALISE_PRONTA")).toEqual(["gerar_parecer"]);
  });
  it("gerar_parecer NUNCA aparece antes de ANALISE_PRONTA", () => {
    for (const e of ["AGUARDANDO_DOCUMENTO", "DOCUMENTO_RECEBIDO", "PETICAO_EXTRAIDA"] as const) {
      expect(toolsDeTransicaoPermitidas(e)).not.toContain("gerar_parecer");
    }
  });
});
