/**
 * Testes do conteúdo das fases do workflow (módulo puro, sem React).
 */
import { describe, it, expect } from "vitest";
import { FASES_ORDEM, FASE_INFO, oQuePedirAgora } from "./workflow-fases";

describe("workflow-fases", () => {
  it("cobre as 5 fases do FSM na ordem do funil", () => {
    expect(FASES_ORDEM).toEqual([
      "AGUARDANDO_DOCUMENTO",
      "DOCUMENTO_RECEBIDO",
      "PETICAO_EXTRAIDA",
      "ANALISE_PRONTA",
      "PARECER_GERADO",
    ]);
    // Toda fase tem conteúdo não-vazio + numeração 1..5.
    FASES_ORDEM.forEach((f, i) => {
      const info = FASE_INFO[f];
      expect(info.n).toBe(i + 1);
      expect(info.titulo.length).toBeGreaterThan(0);
      expect(info.oQuePedir.length).toBeGreaterThan(0);
    });
    // Só a última fase não tem "próxima".
    expect(FASE_INFO.PARECER_GERADO.proxima).toBeNull();
    expect(FASE_INFO.AGUARDANDO_DOCUMENTO.proxima).not.toBeNull();
  });

  it("oQuePedirAgora: caso normal usa o texto da fase", () => {
    expect(oQuePedirAgora("DOCUMENTO_RECEBIDO")).toBe(
      FASE_INFO.DOCUMENTO_RECEBIDO.oQuePedir,
    );
  });

  it("oQuePedirAgora: análise INCONCLUSIVA orienta complementar, não gerar", () => {
    const txt = oQuePedirAgora("ANALISE_PRONTA", "inconclusiva");
    expect(txt).toMatch(/inconclusiva/i);
    expect(txt).toMatch(/reanalisar/i);
    expect(txt).not.toBe(FASE_INFO.ANALISE_PRONTA.oQuePedir);
  });

  it("oQuePedirAgora: análise com veredito normal usa o texto padrão", () => {
    expect(oQuePedirAgora("ANALISE_PRONTA", "procedente")).toBe(
      FASE_INFO.ANALISE_PRONTA.oQuePedir,
    );
  });
});
