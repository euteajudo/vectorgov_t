/**
 * Testes da regra determinística do mérito (`classificarMerito`) e da tool
 * MCP `classificar_merito`.
 *
 * Cobre a cascata de 6 regras (a primeira que casa decide), a unidade do
 * limiar de materialidade (PONTOS PERCENTUAIS), e a invariante "improcedente/
 * diligencia ⇒ valor_reconhecido = 0".
 */

import { describe, expect, it } from "vitest";
import {
  classificarMerito,
  type ClassificarMeritoArgs,
} from "../src/mcp/tools/fiscal/classificar-merito.js";
import { findTool } from "../src/mcp/tools/index.js";
import type { Env } from "../src/env.js";

/** Caso base ADMISSÍVEL e instruído, com desequilíbrio positivo e material. */
function base(over: Partial<ClassificarMeritoArgs> = {}): ClassificarMeritoArgs {
  return {
    delta_valor_centavos: 100_000_00,
    delta_percentual_pp: 3.0,
    valor_pleiteado_centavos: 80_000_00,
    admissibilidade: { no_escopo: true, tempestivo: true, instruido: true },
    comprovacao_suficiente: true,
    ...over,
  };
}

describe("classificarMerito — cascata determinística", () => {
  it("regra 1: fora de escopo → improcedente (art. 373)", () => {
    const r = classificarMerito(
      base({ admissibilidade: { no_escopo: false, tempestivo: true, instruido: true } }),
    );
    expect(r.veredito).toBe("improcedente");
    expect(r.motivo).toBe("fora_de_escopo");
    expect(r.valor_reconhecido_centavos).toBe(0);
  });

  it("regra 2: intempestivo → improcedente (art. 376, II)", () => {
    const r = classificarMerito(
      base({ admissibilidade: { no_escopo: true, tempestivo: false, instruido: true } }),
    );
    expect(r.veredito).toBe("improcedente");
    expect(r.motivo).toBe("intempestivo");
  });

  it("regra 3a: não instruído → diligência (art. 376, IV)", () => {
    const r = classificarMerito(
      base({ admissibilidade: { no_escopo: true, tempestivo: true, instruido: false } }),
    );
    expect(r.veredito).toBe("diligencia");
    expect(r.motivo).toBe("comprovacao_insuficiente");
    expect(r.valor_reconhecido_centavos).toBe(0);
  });

  it("regra 3b: comprovação insuficiente → diligência", () => {
    const r = classificarMerito(base({ comprovacao_suficiente: false }));
    expect(r.veredito).toBe("diligencia");
    expect(r.motivo).toBe("comprovacao_insuficiente");
  });

  it("regra 3c: valor pleiteado ausente (null) → diligência", () => {
    const r = classificarMerito(base({ valor_pleiteado_centavos: null }));
    expect(r.veredito).toBe("diligencia");
    expect(r.motivo).toBe("comprovacao_insuficiente");
  });

  it("regra 4: carga reduziu (delta < 0) → improcedente + revisão de ofício (art. 375)", () => {
    const r = classificarMerito(
      base({ delta_valor_centavos: -50_000_00, delta_percentual_pp: -2.0 }),
    );
    expect(r.veredito).toBe("improcedente");
    expect(r.motivo).toBe("carga_reduzida");
    expect(r.revisao_de_oficio).toBe(true);
  });

  it("regra 5a: delta zero → improcedente (sem desequilíbrio)", () => {
    const r = classificarMerito(
      base({ delta_valor_centavos: 0, delta_percentual_pp: 0 }),
    );
    expect(r.veredito).toBe("improcedente");
    expect(r.motivo).toBe("sem_desequilibrio");
  });

  it("regra 5b: imaterial (|delta_pp| < limiar) → improcedente", () => {
    // 0.3 p.p. < 0.5 p.p. (default). delta_valor > 0 mas imaterial.
    const r = classificarMerito(
      base({ delta_valor_centavos: 1_000, delta_percentual_pp: 0.3 }),
    );
    expect(r.veredito).toBe("improcedente");
    expect(r.motivo).toBe("imaterial");
  });

  it("limiar é em PONTOS PERCENTUAIS, não fração: 0.4 p.p. é imaterial sob default 0.5", () => {
    const r = classificarMerito(base({ delta_percentual_pp: 0.4 }));
    expect(r.motivo).toBe("imaterial");
  });

  it("limiar parametrizável: com limiar 0.2, 0.4 p.p. passa a ser material", () => {
    const r = classificarMerito(
      base({ delta_percentual_pp: 0.4, limiar_materialidade_pp: 0.2 }),
    );
    expect(r.veredito).not.toBe("improcedente");
  });

  it("regra 6a: pleito ≤ delta → procedente integral", () => {
    const r = classificarMerito(
      base({ delta_valor_centavos: 100_000_00, valor_pleiteado_centavos: 80_000_00 }),
    );
    expect(r.veredito).toBe("procedente");
    expect(r.motivo).toBe("pleito_integral");
    expect(r.valor_reconhecido_centavos).toBe(80_000_00);
  });

  it("regra 6b: pleito > delta → parcialmente procedente, limitado ao delta", () => {
    const r = classificarMerito(
      base({ delta_valor_centavos: 60_000_00, valor_pleiteado_centavos: 100_000_00 }),
    );
    expect(r.veredito).toBe("parcialmente_procedente");
    expect(r.motivo).toBe("pleito_excede_delta");
    expect(r.valor_reconhecido_centavos).toBe(60_000_00);
  });

  it("ordem: admissibilidade tem precedência sobre o número (intempestivo vence delta positivo)", () => {
    const r = classificarMerito(
      base({
        admissibilidade: { no_escopo: true, tempestivo: false, instruido: true },
        delta_valor_centavos: 100_000_00,
      }),
    );
    expect(r.motivo).toBe("intempestivo");
  });
});

describe("tool MCP classificar_merito", () => {
  it("está registrada no catálogo", () => {
    expect(findTool("classificar_merito")).toBeDefined();
  });

  it("valida e executa via handler, aplicando o default do limiar", async () => {
    const tool = findTool("classificar_merito")!;
    const out = (await tool.handler(
      {
        delta_valor_centavos: 100_000_00,
        delta_percentual_pp: 3.0,
        valor_pleiteado_centavos: 80_000_00,
        admissibilidade: { no_escopo: true, tempestivo: true, instruido: true },
        comprovacao_suficiente: true,
        // limiar omitido → default 0.5 p.p.
      },
      {} as Env,
    )) as { veredito: string; valor_reconhecido_centavos: number };
    expect(out.veredito).toBe("procedente");
    expect(out.valor_reconhecido_centavos).toBe(80_000_00);
  });

  it("rejeita input inválido (delta_percentual ausente)", async () => {
    const tool = findTool("classificar_merito")!;
    await expect(
      tool.handler(
        { delta_valor_centavos: 1, valor_pleiteado_centavos: 1, comprovacao_suficiente: true },
        {} as Env,
      ),
    ).rejects.toThrow();
  });
});
