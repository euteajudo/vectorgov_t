/**
 * Testes do núcleo determinístico de preços: aderência, percentis e
 * normalização de unidade de fornecimento. Fixtures espelham o CATMAT 269894
 * (luva de procedimento) e a poluição que o portão precisa barrar.
 */
import { describe, expect, it } from "vitest";
import type { AmostraPreco } from "@vectorgov-t/schemas";
import {
  agregarEstatisticas,
  avaliarAderencia,
  percentil,
} from "../src/lib/preco-stats.js";

function amostra(over: Partial<AmostraPreco>): AmostraPreco {
  return {
    codigo_item: 269894,
    descricao: "LUVA PARA PROCEDIMENTO NÃO CIRÚRGICO",
    descricao_detalhada: null,
    objeto_compra: null,
    valor_unitario_centavos: 2250,
    unidade_fornecimento: "CX",
    capacidade_fornecimento: 100,
    unidade_medida: "UN",
    quantidade: 360,
    marca: "INOVEN",
    fornecedor: "CIRURGICA BIOMEDICA LTDA",
    ni_fornecedor: "11215901000117",
    uasg: "160103",
    orgao: "COMANDO DO EXERCITO",
    uf: "MA",
    municipio: "IMPERATRIZ",
    poder: "E",
    esfera: "F",
    data_compra: "2024-12-27",
    forma: "SISRP",
    id_compra: "16010305900212024",
    fonte_url: null,
    aderente: true,
    aderencia_score: 1,
    aderencia_motivo: "",
    ...over,
  };
}

describe("avaliarAderencia", () => {
  it("aprova amostra do mesmo objeto (luva procedimento)", () => {
    const r = avaliarAderencia("luva para procedimento não cirúrgico", {
      descricao: "LUVA PARA PROCEDIMENTO NÃO CIRÚRGICO, LÁTEX",
      descricao_detalhada: null,
      objeto_compra: null,
    });
    expect(r.aderente).toBe(true);
    expect(r.aderencia_score).toBeGreaterThanOrEqual(0.5);
  });

  it("rejeita poluidor (seringa cadastrada sob o mesmo CATMAT)", () => {
    const r = avaliarAderencia("luva para procedimento não cirúrgico", {
      descricao: "SERINGA DESCARTÁVEL 10ML COM AGULHA",
      descricao_detalhada: null,
      objeto_compra: null,
    });
    expect(r.aderente).toBe(false);
  });

  it("ignora acentos e stopwords no casamento", () => {
    const r = avaliarAderencia("LUVA PROCEDIMENTO", {
      descricao: "luva para procedimento nao cirurgico",
      descricao_detalhada: null,
      objeto_compra: null,
    });
    expect(r.aderente).toBe(true);
  });
});

describe("percentil", () => {
  it("mediana e quartis por interpolação", () => {
    const vals = [1900, 2000, 2250, 2500, 3000];
    expect(percentil(vals, 50)).toBe(2250);
    expect(percentil(vals, 25)).toBe(2000);
    expect(percentil(vals, 75)).toBe(2500);
  });
  it("borda: lista vazia e unitária", () => {
    expect(percentil([], 50)).toBe(0);
    expect(percentil([4200], 50)).toBe(4200);
  });
});

describe("agregarEstatisticas", () => {
  it("usa a unidade de fornecimento predominante e descarta as demais", () => {
    const amostras: AmostraPreco[] = [
      amostra({ valor_unitario_centavos: 2000, unidade_fornecimento: "CX" }),
      amostra({ valor_unitario_centavos: 2250, unidade_fornecimento: "CX" }),
      amostra({ valor_unitario_centavos: 2500, unidade_fornecimento: "CX" }),
      // fora-de-unidade: R$/UNIDADE não pode entrar na mediana de R$/CAIXA
      amostra({ valor_unitario_centavos: 19, unidade_fornecimento: "UN" }),
    ];
    const e = agregarEstatisticas(amostras);
    expect(e.unidade_fornecimento_base).toBe("CX");
    expect(e.n).toBe(3);
    expect(e.n_descartadas_unidade).toBe(1);
    expect(e.mediana_centavos).toBe(2250);
  });

  it("conta as descartadas por aderência", () => {
    const amostras: AmostraPreco[] = [
      amostra({ valor_unitario_centavos: 2250 }),
      amostra({ aderente: false, valor_unitario_centavos: 99999 }),
    ];
    const e = agregarEstatisticas(amostras);
    expect(e.n).toBe(1);
    expect(e.n_descartadas_aderencia).toBe(1);
    expect(e.mediana_centavos).toBe(2250);
  });

  it("conjunto vazio não quebra (estatística nula)", () => {
    const e = agregarEstatisticas([]);
    expect(e.n).toBe(0);
    expect(e.mediana_centavos).toBeNull();
    expect(e.janela_inicio).toBeNull();
  });
});
