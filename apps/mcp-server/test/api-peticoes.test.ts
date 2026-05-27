import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AnaliseReequilibrioSchema } from "@vectorgov-t/schemas";
import { __internal } from "../src/api/peticoes.js";

describe("api/peticoes mock de analise", () => {
  const goldenSetEnv = { ENABLE_GOLDEN_SET_MOCKS: "true" };
  const casos = [
    ["012/2024", "procedente", 0.75, null],
    ["045/2023", "improcedente", 0.7, null],
    ["007/2024", "inconclusiva", 0, 0.5],
    ["089/2024", "parcialmente_procedente", 0.65, null],
    ["156/2025", "inconclusiva", 0.4, 0.7],
  ] as const;

  it.each(casos)(
    "gera veredito compativel com golden set para contrato %s",
    (contrato, veredito, scoreMin, scoreMax) => {
      const analise = __internal.gerarAnaliseMock(
        randomUUID(),
        {
          contrato_numero: contrato,
        },
        goldenSetEnv,
      ) as Record<string, unknown>;

      const parsed = AnaliseReequilibrioSchema.safeParse(analise);
      expect(parsed.success).toBe(true);
      expect(analise.veredito).toBe(veredito);
      expect(analise.score_confianca as number).toBeGreaterThanOrEqual(scoreMin);
      if (scoreMax !== null) {
        expect(analise.score_confianca as number).toBeLessThanOrEqual(scoreMax);
        expect(analise.pontos_a_complementar).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ severidade: "bloqueante" }),
          ]),
        );
      }
    },
  );

  it("inclui citacoes obrigatorias do caso IBS/CBS", () => {
    const analise = __internal.gerarAnaliseMock(
      randomUUID(),
      {
        contrato_numero: "012/2024",
      },
      goldenSetEnv,
    ) as { citacoes: Array<{ norma: string; artigo: string }> };

    expect(analise.citacoes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          norma: "Lei nº 14.133/2021",
          artigo: "art. 124, II, d",
        }),
        expect.objectContaining({
          norma: "Lei Complementar 214/2025",
          artigo: "Disposições gerais IBS/CBS",
        }),
        expect.objectContaining({
          norma: "Constituição Federal",
          artigo: "art. 195, V (EC 132/2023)",
        }),
      ]),
    );
  });

  it("nao ativa respostas fixas do golden set sem flag explicita", () => {
    const analise = __internal.gerarAnaliseMock(randomUUID(), {
      contrato_numero: "012/2024",
    }) as Record<string, unknown>;

    expect(analise.veredito).toBe("parcialmente_procedente");
    expect(analise.score_confianca).toBe(0.82);
  });
});
