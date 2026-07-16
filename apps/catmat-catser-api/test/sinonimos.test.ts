/**
 * Testes da expansão de query por sinônimos de domínio (compras públicas).
 */
import { describe, expect, it } from "vitest";
import { expandirQuery, GRUPOS_SINONIMOS } from "../src/lib/sinonimos.js";

describe("expandirQuery", () => {
  it("concatena os termos canônicos do grupo acionado", () => {
    const out = expandirQuery("notebook dell 16gb");
    expect(out.startsWith("notebook dell 16gb")).toBe(true);
    expect(out).toContain("laptop");
    expect(out).toContain("computador portátil");
  });

  it("devolve a query intacta quando nenhum grupo é acionado", () => {
    expect(expandirQuery("parafuso sextavado aço inox")).toBe(
      "parafuso sextavado aço inox",
    );
  });

  it("não repete termo que já está na query", () => {
    const out = expandirQuery("notebook laptop");
    expect(out).toContain("computador portátil");
    // "laptop" aparece só a vez original
    expect(out.match(/laptop/g)?.length).toBe(1);
  });

  it("casa sem diacríticos (usuário digita 'televisao')", () => {
    const out = expandirQuery("televisao 50 polegadas");
    expect(out).toContain("televisor");
  });

  it("respeita fronteira de palavra ('atv' não aciona o grupo de tv)", () => {
    expect(expandirQuery("quadriciclo atv 4x4")).toBe("quadriciclo atv 4x4");
  });

  it("casa termo multi-palavra e hifenizado", () => {
    expect(expandirQuery("manutenção de ar-condicionado split")).toContain(
      "condicionador de ar",
    );
    expect(expandirQuery("limpeza predial mensal")).toContain(
      "limpeza e conservação",
    );
  });

  it("seed não tem termo vazio nem grupo unitário", () => {
    for (const grupo of GRUPOS_SINONIMOS) {
      expect(grupo.length).toBeGreaterThanOrEqual(2);
      for (const termo of grupo) expect(termo.trim().length).toBeGreaterThan(0);
    }
  });
});
