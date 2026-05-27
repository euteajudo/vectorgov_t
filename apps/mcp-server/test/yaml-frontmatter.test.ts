/**
 * Testes do parser de YAML front-matter (`src/lib/yaml-frontmatter.ts`).
 *
 * Cobre os formatos que controlamos no template das skills:
 *   - Escalares (string, number, boolean).
 *   - Listas inline e block-style.
 *   - Sub-objetos (1 nível).
 *   - Aspas duplas/simples.
 *   - Comentários `#` ignorados.
 *   - Erros: tabs proibidos, front-matter sem fechamento.
 */

import { describe, expect, it } from "vitest";
import {
  FrontmatterParseError,
  parseFrontmatter,
} from "../src/lib/yaml-frontmatter.js";

describe("parseFrontmatter — escalares simples", () => {
  it("parseia strings, números e booleans no nível raiz", () => {
    const src = [
      "---",
      "nome: minha-skill",
      "descricao: \"texto entre aspas duplas\"",
      "autor: 'aspas simples'",
      "tokens_aproximados: 1500",
      "ativa: true",
      "---",
      "Corpo da skill.",
    ].join("\n");
    const { data, body } = parseFrontmatter(src);
    expect(data.nome).toBe("minha-skill");
    expect(data.descricao).toBe("texto entre aspas duplas");
    expect(data.autor).toBe("aspas simples");
    expect(data.tokens_aproximados).toBe(1500);
    expect(data.ativa).toBe(true);
    expect(body).toContain("Corpo da skill.");
  });
});

describe("parseFrontmatter — listas", () => {
  it("parseia lista inline [a, b]", () => {
    const src = [
      "---",
      "agentes_aplicaveis: [orquestrador, analista-juridico]",
      "---",
      "",
    ].join("\n");
    const { data } = parseFrontmatter(src);
    expect(data.agentes_aplicaveis).toEqual([
      "orquestrador",
      "analista-juridico",
    ]);
  });

  it("parseia lista block-style com hífens", () => {
    const src = [
      "---",
      "agentes_aplicaveis:",
      "  - orquestrador",
      "  - redator",
      "  - auditor",
      "---",
      "",
    ].join("\n");
    const { data } = parseFrontmatter(src);
    expect(data.agentes_aplicaveis).toEqual([
      "orquestrador",
      "redator",
      "auditor",
    ]);
  });

  it("preserva strings com vírgulas dentro de aspas em listas inline", () => {
    const src = [
      "---",
      "contextos: [\"primeiro, com virgula\", segundo]",
      "---",
      "",
    ].join("\n");
    const { data } = parseFrontmatter(src);
    expect(data.contextos).toEqual(["primeiro, com virgula", "segundo"]);
  });
});

describe("parseFrontmatter — sub-objetos", () => {
  it("parseia trigger com palavras_chave e contextos", () => {
    const src = [
      "---",
      "trigger:",
      "  palavras_chave: [reequilibrio, contrato]",
      "  contextos:",
      "    - analise de petição",
      "    - revisão de cláusula",
      "---",
      "",
    ].join("\n");
    const { data } = parseFrontmatter(src);
    const trigger = data.trigger as Record<string, unknown>;
    expect(trigger.palavras_chave).toEqual(["reequilibrio", "contrato"]);
    expect(trigger.contextos).toEqual([
      "analise de petição",
      "revisão de cláusula",
    ]);
  });
});

describe("parseFrontmatter — comentários e linhas vazias", () => {
  it("ignora comentários iniciados por # e linhas em branco", () => {
    const src = [
      "---",
      "# comentário de cabeçalho",
      "nome: test",
      "",
      "# outro comentário",
      "versao: 1.0.0",
      "---",
      "",
    ].join("\n");
    const { data } = parseFrontmatter(src);
    expect(data.nome).toBe("test");
    expect(data.versao).toBe("1.0.0");
  });
});

describe("parseFrontmatter — erros", () => {
  it("lança quando o arquivo não começa com ---", () => {
    expect(() => parseFrontmatter("nome: x\n")).toThrow(FrontmatterParseError);
  });

  it("lança quando o front-matter não tem fechamento", () => {
    const src = "---\nnome: x\nsem fim aqui";
    expect(() => parseFrontmatter(src)).toThrow(/sem fechamento/);
  });

  it("lança quando há tab no início de uma linha", () => {
    const src = "---\nnome: x\n\tversao: 1.0.0\n---\n";
    expect(() => parseFrontmatter(src)).toThrow(/tabs proibidos/);
  });

  it("lança quando linha sem ':' aparece (fora de lista)", () => {
    const src = "---\nlinha solta sem colon\n---\n";
    expect(() => parseFrontmatter(src)).toThrow(/sem ':'/);
  });
});

describe("parseFrontmatter — CRLF / CR", () => {
  it("normaliza line endings Windows", () => {
    const src = "---\r\nnome: win\r\nversao: 1.0.0\r\n---\r\ncorpo";
    const { data, body } = parseFrontmatter(src);
    expect(data.nome).toBe("win");
    expect(data.versao).toBe("1.0.0");
    expect(body).toBe("corpo");
  });
});
