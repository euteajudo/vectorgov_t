/**
 * Validação automática de todas as skills em `packages/skills/active/*.md`.
 *
 * Lê cada arquivo, faz parse do front-matter pela mesma rotina que o
 * Worker usa em produção e valida via `SkillMetadata` (Zod). Garante:
 *
 *   - YAML do front-matter é parseável.
 *   - Metadata atende a todos os requisitos (kebab-case, versão SemVer,
 *     data ISO 8601, categoria válida, etc.).
 *   - Nome do arquivo (basename) == campo `nome` do front-matter.
 *   - Cada skill tem as seções obrigatórias no corpo: "Quando usar",
 *     "Critérios", "Schema de saída esperado", "Exemplos", "Erros a evitar".
 *   - Tamanho total < 3.000 tokens (~12.000 bytes ASCII).
 *
 * Esse teste roda no CI e impede merge de skill malformada.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SkillMetadata } from "@vectorgov-t/schemas";
import { parseFrontmatter } from "../src/lib/yaml-frontmatter.js";

const ACTIVE_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "skills",
  "active",
);

function listSkillFiles(): string[] {
  return readdirSync(ACTIVE_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(ACTIVE_DIR, f));
}

const SECTIONS_OBRIGATORIAS = [
  "Quando usar",
  "Critérios",
  "Schema de saída esperado",
  "Exemplos",
  "Erros a evitar",
];

// Limite aproximado: 1 token ≈ 4 chars em texto PT-BR técnico.
const MAX_BYTES = 3000 * 4;

describe("packages/skills/active — validação real", () => {
  const arquivos = listSkillFiles();

  it("contém exatamente 10 skills (5 Feature 1 + 5 Feature 2)", () => {
    expect(arquivos).toHaveLength(10);
  });

  for (const arquivo of arquivos) {
    const nomeArquivo = arquivo.split(/[/\\]/).pop()!;
    describe(`${nomeArquivo}`, () => {
      const raw = readFileSync(arquivo, "utf-8");
      const parsed = parseFrontmatter(raw);

      it("front-matter passa SkillMetadata.parse", () => {
        const result = SkillMetadata.safeParse(parsed.data);
        if (!result.success) {
          throw new Error(
            `Falhou validação Zod:\n${JSON.stringify(result.error.issues, null, 2)}`,
          );
        }
      });

      it("nome do arquivo == campo nome do front-matter", () => {
        const basename = nomeArquivo.replace(/\.md$/, "");
        const meta = SkillMetadata.parse(parsed.data);
        expect(meta.nome).toBe(basename);
      });

      it("corpo contém todas as seções obrigatórias", () => {
        for (const secao of SECTIONS_OBRIGATORIAS) {
          expect(parsed.body).toContain(secao);
        }
      });

      it("tamanho < 3.000 tokens (12k bytes)", () => {
        const bytes = new TextEncoder().encode(raw).byteLength;
        expect(bytes).toBeLessThan(MAX_BYTES);
      });

      it("data_atualizacao não pode estar no futuro distante", () => {
        const meta = SkillMetadata.parse(parsed.data);
        const data = new Date(meta.data_atualizacao);
        const limite = new Date();
        limite.setFullYear(limite.getFullYear() + 1);
        expect(data.getTime()).toBeLessThan(limite.getTime());
      });
    });
  }

  it("cada categoria está representada conforme planejamento", () => {
    const metas = arquivos.map((arq) => {
      const raw = readFileSync(arq, "utf-8");
      return SkillMetadata.parse(parseFrontmatter(raw).data);
    });
    const porCategoria = metas.reduce<Record<string, number>>((acc, m) => {
      acc[m.categoria] = (acc[m.categoria] ?? 0) + 1;
      return acc;
    }, {});
    // 5 de Feature 1 (analise-peticao) + 5 de Feature 2 (geracao-parecer)
    expect(porCategoria["analise-peticao"]).toBe(5);
    expect(porCategoria["geracao-parecer"]).toBe(5);
  });
});
