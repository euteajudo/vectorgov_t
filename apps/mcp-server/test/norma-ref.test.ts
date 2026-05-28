/**
 * Testes dos helpers de resolução de referência normativa.
 */
import { describe, expect, it } from "vitest";
import {
  slugificarNorma,
  resolverNormaId,
  parseArtigoRef,
} from "../src/lib/norma-ref.js";

describe("slugificarNorma", () => {
  it.each([
    ["Lei nº 14.133/2021", "lei-14133-2021"],
    ["Lei 14.133/2021", "lei-14133-2021"],
    ["Lei 14.133, de 2021", "lei-14133-2021"],
    ["LC 214/2025", "lc-214-2025"],
    ["Lei Complementar nº 214/2025", "lc-214-2025"],
    ["Decreto 12.955/2026", "decreto-12955-2026"],
    ["Emenda Constitucional 132/2023", "ec-132-2023"],
    ["Instrução Normativa 58/2022", "instrucao-normativa-58-2022"],
  ])("converte %s → %s", (entrada, esperado) => {
    expect(slugificarNorma(entrada)).toBe(esperado);
  });

  it("retorna null sem número", () => {
    expect(slugificarNorma("Constituição Federal")).toBeNull();
  });

  it("retorna null sem ano", () => {
    expect(slugificarNorma("Lei 14.133")).toBeNull();
  });

  it("retorna null para tipo desconhecido", () => {
    expect(slugificarNorma("Portaria 10/2020")).toBeNull();
  });
});

describe("parseArtigoRef", () => {
  it("parseia artigo simples", () => {
    expect(parseArtigoRef("art. 124")).toEqual({ artigo: 124 });
  });

  it("parseia artigo + parágrafo + inciso", () => {
    expect(parseArtigoRef("art. 124, § 1º, II")).toEqual({
      artigo: 124,
      paragrafo: 1,
      inciso: "II",
    });
  });

  it("parseia artigo + parágrafo + inciso + alínea", () => {
    expect(parseArtigoRef("Art 5º, §3, IV, b")).toEqual({
      artigo: 5,
      paragrafo: 3,
      inciso: "IV",
      alinea: "b",
    });
  });

  it("ignora 'caput'", () => {
    expect(parseArtigoRef("caput do art. 9")).toEqual({ artigo: 9 });
  });

  it("reconhece parágrafo único", () => {
    expect(parseArtigoRef("art. 7, parágrafo único")).toEqual({
      artigo: 7,
      paragrafo: "unico",
    });
  });

  it("retorna null para jurisprudência (sem artigo)", () => {
    expect(parseArtigoRef("Acórdão 1.234/2023-Plenário")).toBeNull();
  });
});

describe("resolverNormaId", () => {
  const catalogoTool = (ids: string[]) => [
    {
      nome: "fs_listar_normas",
      executar: async () => ({ normas: ids.map((norma_id) => ({ norma_id })) }),
    },
  ];

  it("retorna id quando slug casa exato no catálogo", async () => {
    const tools = catalogoTool(["lei-14133-2021", "lc-214-2025"]);
    expect(await resolverNormaId("Lei 14.133/2021", tools)).toBe(
      "lei-14133-2021",
    );
  });

  it("casa por sufixo numero-ano quando prefixo diverge", async () => {
    // Catálogo usa "lei-complementar-214-2025"; heurística gera "lc-214-2025".
    const tools = catalogoTool(["lei-complementar-214-2025"]);
    expect(await resolverNormaId("LC 214/2025", tools)).toBe(
      "lei-complementar-214-2025",
    );
  });

  it("retorna null quando não há match no catálogo", async () => {
    const tools = catalogoTool(["lei-14133-2021"]);
    expect(await resolverNormaId("Decreto 99.999/2099", tools)).toBeNull();
  });

  it("cai para slug heurístico sem a tool fs_listar_normas", async () => {
    expect(await resolverNormaId("Lei 14.133/2021", [])).toBe("lei-14133-2021");
  });

  it("cai para slug heurístico se catálogo vazio", async () => {
    const tools = catalogoTool([]);
    expect(await resolverNormaId("Lei 14.133/2021", tools)).toBe(
      "lei-14133-2021",
    );
  });
});
