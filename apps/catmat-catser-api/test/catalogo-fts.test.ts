/**
 * Testes do FTS AND-first: sanitização, fallback automático AND→OR (com
 * sinônimos no passe OR) e o payload novo do grep (ativo real, sem
 * unidade_medida).
 */
import { describe, expect, it } from "vitest";
import { grepCatalogo, sanitizeFts5 } from "../src/lib/catalogo-search.js";
import { createFakeD1, createTestEnv, type RegraD1 } from "./_fakes.js";

const LINHA = {
  catalogo_id: "cat-material-269894",
  codigo: 269894,
  tipo: "material",
  descricao: "LUVA PARA PROCEDIMENTO NAO CIRURGICO",
  grupo: "MATERIAL HOSPITALAR",
  classe: "VESTUARIO HOSPITALAR",
  pdm: "LUVA PROCEDIMENTO",
  ncm: "40151200",
  ativo: 1,
  rank: -1.2,
};

describe("sanitizeFts5", () => {
  it("AND: tokens justapostos entre aspas (AND implícito do FTS5)", () => {
    expect(sanitizeFts5("luva procedimento", "and")).toBe(
      '"luva" "procedimento"',
    );
  });

  it("OR: tokens unidos por OR explícito", () => {
    expect(sanitizeFts5("luva procedimento", "or")).toBe(
      '"luva" OR "procedimento"',
    );
  });

  it("descarta tokens com menos de 3 caracteres", () => {
    expect(sanitizeFts5("tv de 50 polegadas", "and")).toBe('"polegadas"');
  });

  it("query sem token útil vira string vazia segura", () => {
    expect(sanitizeFts5("de a e", "and")).toBe('""');
  });

  it("remove metacaracteres do MATCH", () => {
    expect(sanitizeFts5('luva* (nitrilica) "caixa"', "and")).toBe(
      '"luva" "nitrilica" "caixa"',
    );
  });
});

describe("queryFtsCatalogo via grepCatalogo (AND-first + fallback OR)", () => {
  /** D1 que responde por inspeção da expressão MATCH bindada. */
  function d1PorMatch(resolver: (matchExpr: string) => unknown[]) {
    const chamadas: string[] = [];
    const regra: RegraD1 = {
      match: "catalogo_fts",
      resolver: (_sql, binds) => {
        const expr = String(binds[0]);
        chamadas.push(expr);
        return resolver(expr);
      },
    };
    return { db: createFakeD1({ regras: [regra] }), chamadas };
  }

  it("serve pelo AND quando o AND encontra", async () => {
    const { db, chamadas } = d1PorMatch(() => [LINHA]);
    const env = createTestEnv({ DB: db });
    const r = await grepCatalogo(env, { padrao: "luva procedimento", max: 20 });
    expect(r.total).toBe(1);
    // pdm/ncm chegam ao payload (P2 do review: eram descartados no construtor).
    expect(r.itens[0]!.pdm).toBe("LUVA PROCEDIMENTO");
    expect(r.itens[0]!.ncm).toBe("40151200");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toBe('"luva" "procedimento"');
  });

  it("refaz com OR quando o AND retorna 0", async () => {
    const { db, chamadas } = d1PorMatch((expr) =>
      expr.includes(" OR ") ? [LINHA] : [],
    );
    const env = createTestEnv({ DB: db });
    const r = await grepCatalogo(env, {
      padrao: "luva cirurgica nitrilica",
      max: 20,
    });
    expect(r.total).toBe(1);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]).toBe('"luva" "cirurgica" "nitrilica"');
    expect(chamadas[1]).toContain(" OR ");
  });

  it("o passe OR usa a query expandida por sinônimos", async () => {
    const { db, chamadas } = d1PorMatch((expr) =>
      expr.includes(" OR ") ? [LINHA] : [],
    );
    const env = createTestEnv({ DB: db });
    await grepCatalogo(env, { padrao: "notebook resistente", max: 20 });
    expect(chamadas[1]).toContain('"laptop"');
    expect(chamadas[1]).toContain('"portátil"');
  });

  it("payload: ativo vem da coluna e unidade_medida não existe mais", async () => {
    const { db } = d1PorMatch(() => [{ ...LINHA, ativo: 0 }]);
    const env = createTestEnv({ DB: db });
    const r = await grepCatalogo(env, { padrao: "luva procedimento", max: 20 });
    expect(r.itens[0]!.ativo).toBe(false);
    expect("unidade_medida" in r.itens[0]!).toBe(false);
  });
});
