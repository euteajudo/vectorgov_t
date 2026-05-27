/**
 * Testes do diff palavra-a-palavra usado por `comparar_redacoes`.
 */

import { describe, expect, it } from "vitest";
import { wordDiff, countWords } from "../src/lib/diff.js";

describe("wordDiff", () => {
  it("retorna 100% iguais quando textos são idênticos", () => {
    const segs = wordDiff("hello world", "hello world");
    expect(segs.every((s) => s.tipo === "igual")).toBe(true);
  });

  it("identifica palavra adicionada", () => {
    const segs = wordDiff("hello world", "hello big world");
    const adicionados = segs.filter((s) => s.tipo === "adicionado");
    expect(adicionados.length).toBeGreaterThan(0);
    expect(adicionados.map((s) => s.texto).join("")).toContain("big");
  });

  it("identifica palavra removida", () => {
    const segs = wordDiff("hello big world", "hello world");
    const removidos = segs.filter((s) => s.tipo === "removido");
    expect(removidos.length).toBeGreaterThan(0);
  });
});

describe("countWords", () => {
  it("conta apenas tokens não-whitespace", () => {
    const segs = [
      { tipo: "igual" as const, texto: "uma duas " },
      { tipo: "adicionado" as const, texto: "tres " },
      { tipo: "removido" as const, texto: "quatro" },
    ];
    const r = countWords(segs);
    expect(r.iguais).toBe(2);
    expect(r.adicionadas).toBe(1);
    expect(r.removidas).toBe(1);
  });
});
