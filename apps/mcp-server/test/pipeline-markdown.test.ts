/**
 * Testes do gerador de markdown / paths R2 (`src/pipeline/markdown.ts`).
 */

import { describe, expect, it } from "vitest";
import {
  dispositivoR2Key,
  renderDispositivoMd,
} from "../src/pipeline/markdown.js";
import type { DispositivoChunk, NormaMetadata } from "@vectorgov-t/schemas";

const norma: NormaMetadata = {
  id: "lc-214-2025",
  tipo: "lei_complementar",
  numero: "214",
  ano: 2025,
  data_publicacao: "2025-01-16",
  ementa: "Reforma tributária — IBS e CBS",
  orgao_emissor: "Congresso Nacional",
  status: "vigente",
};

function disp(over: Partial<DispositivoChunk>): DispositivoChunk {
  return {
    id: "lc-214-2025-art-001",
    norma_id: "lc-214-2025",
    tipo_dispositivo: "artigo",
    artigo: 1,
    paragrafo: null,
    inciso: null,
    alinea: null,
    hierarquia_path: "Livro I -> Título I -> Art. 1º",
    texto: "Art. 1º — Esta Lei Complementar institui...",
    canonical_start: 0,
    canonical_end: 100,
    page_number: 1,
    citations: [],
    ...over,
  };
}

describe("dispositivoR2Key", () => {
  it("monta path com livro/título slugificados", () => {
    const key = dispositivoR2Key("lc-214-2025", disp({}));
    expect(key).toBe("lc-214-2025/dispositivos/livro-i/titulo-i/art-001.md");
  });

  it("adiciona sufixos de paragrafo/inciso/alinea", () => {
    const key = dispositivoR2Key(
      "lc-214-2025",
      disp({
        id: "lc-214-2025-art-473-p-1-i-ii-a-a",
        artigo: 473,
        paragrafo: "1",
        inciso: "II",
        alinea: "a",
        hierarquia_path: "Livro II -> Capítulo III -> Art. 473 § 1º II a",
        tipo_dispositivo: "alinea",
      }),
    );
    expect(key).toBe(
      "lc-214-2025/dispositivos/livro-ii/capitulo-iii/art-473-p-1-i-ii-a-a.md",
    );
  });

  it("cai em sem-hierarquia quando hierarquia_path vazia", () => {
    const key = dispositivoR2Key(
      "lei-14133-2021",
      disp({ artigo: 9, hierarquia_path: "" }),
    );
    expect(key).toBe("lei-14133-2021/dispositivos/sem-hierarquia/art-009.md");
  });

  it("usa id sanitizado quando não há artigo", () => {
    const key = dispositivoR2Key(
      "lc-214-2025",
      disp({
        id: "lc-214-2025-anexo-i",
        artigo: null,
        tipo_dispositivo: "anexo",
        hierarquia_path: "Anexo I",
      }),
    );
    expect(key).toBe(
      "lc-214-2025/dispositivos/sem-hierarquia/lc-214-2025-anexo-i.md",
    );
  });
});

describe("renderDispositivoMd", () => {
  it("gera YAML front-matter + corpo", () => {
    const md = renderDispositivoMd(norma, disp({}));
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('id: "lc-214-2025-art-001"');
    expect(md).toContain('norma_id: "lc-214-2025"');
    expect(md).toContain('norma_tipo: "lei_complementar"');
    expect(md).toContain("norma_ano: 2025");
    expect(md).toContain('tipo_dispositivo: "artigo"');
    expect(md).toContain("artigo: 1");
    expect(md).toContain("canonical_start: 0");
    expect(md).toContain("canonical_end: 100");
    expect(md).toContain("Art. 1º — Esta Lei Complementar institui");
  });

  it("inclui citations quando presentes", () => {
    const md = renderDispositivoMd(
      norma,
      disp({ citations: ["LEI-14.133-2021 ART-009", "CF ART-150"] }),
    );
    expect(md).toContain("citations:");
    expect(md).toContain('- "LEI-14.133-2021 ART-009"');
    expect(md).toContain('- "CF ART-150"');
  });

  it("omite campos opcionais vazios", () => {
    const md = renderDispositivoMd(norma, disp({}));
    expect(md).not.toContain("paragrafo:");
    expect(md).not.toContain("inciso:");
    expect(md).not.toContain("alinea:");
    expect(md).not.toContain("citations:");
  });
});
