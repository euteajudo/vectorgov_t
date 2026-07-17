// Testes do planner delta (node --test delta.test.mjs) — sem rede, sem disco.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planejarDelta,
  avaliarGates,
  gerarDeltaSql,
  estimarCustoEmbed,
  confirmarExclusoes,
  lerLinhasD1,
  itemDiferente,
  CAMPOS_VETOR,
} from "./delta.mjs";

const item = (codigo, extra = {}) => ({
  id: `cat-material-${codigo}`,
  codigo,
  tipo: "material",
  descricao: `ITEM ${codigo}`,
  grupo: "GRUPO",
  classe: "CLASSE",
  pdm: "PDM",
  ncm: null,
  ativo: 1,
  atualizado_em: "2026-01-01T00:00:00",
  texto_embed: `ITEM ${codigo} (PDM) [CLASSE]`,
  ...extra,
});

// Linha como sai do D1 (sem texto_embed; nulls do SQLite).
const linhaD1 = (codigo, extra = {}) => {
  const { texto_embed, ...resto } = item(codigo, extra);
  return resto;
};

test("classifica novo / alterado_vetor / alterado_data / excluido / inalterado", () => {
  const fonte = [
    item(1), // inalterado
    item(2, { descricao: "MUDOU", texto_embed: "MUDOU (PDM) [CLASSE]" }), // vetor
    item(3, { atualizado_em: "2026-02-02T00:00:00" }), // só data
    item(5), // novo (não está no D1)
    item(6, { ativo: 0 }), // vetor: flip de status muda metadata
  ];
  const d1 = [linhaD1(1), linhaD1(2), linhaD1(3), linhaD1(4), linhaD1(6)];
  const plano = planejarDelta(fonte, d1);
  assert.deepEqual(plano.novos.map((i) => i.codigo), [5]);
  assert.deepEqual(plano.alteradosVetor.map((i) => i.codigo), [2, 6]);
  assert.deepEqual(plano.alteradosData.map((i) => i.codigo), [3]);
  assert.deepEqual(plano.excluidos, ["cat-material-4"]);
  assert.equal(plano.totalD1, 5);
});

test("null, undefined e string vazia comparam como iguais", () => {
  assert.equal(itemDiferente({ ncm: null }, { ncm: "" }, ["ncm"]), false);
  assert.equal(itemDiferente({ ncm: undefined }, { ncm: null }, ["ncm"]), false);
  assert.equal(itemDiferente({ ncm: "1234" }, { ncm: null }, ["ncm"]), true);
});

test("id duplicado na fonte explode (fetch corrompido)", () => {
  assert.throws(() => planejarDelta([item(1), item(1)], []), /duplicado/);
});

test("campos que exigem re-embed são exatamente os do vetor", () => {
  assert.deepEqual(CAMPOS_VETOR, ["descricao", "grupo", "classe", "pdm", "ncm", "ativo"]);
});

test("gates: fonte insana, D1 vazio, tetos e overrides", () => {
  const base = {
    minMateriais: 10,
    minServicos: 1,
    minD1: 5,
    maxEmbed: 2,
    maxExclusoes: 1,
    overrideEmbed: false,
    overrideExclusoes: false,
    nMateriais: 10,
    nServicos: 1,
  };
  const plano = planejarDelta(
    [item(1), item(2), item(3)],
    [linhaD1(4), linhaD1(5), linhaD1(6), linhaD1(7), linhaD1(8)],
  );
  // 3 novos (> maxEmbed 2) e 5 excluídos (> maxExclusoes 1)
  let falhas = avaliarGates(plano, base);
  assert.deepEqual(falhas.map((f) => f.gate).sort(), ["teto_embed", "teto_exclusoes"]);

  falhas = avaliarGates(plano, { ...base, overrideEmbed: true, overrideExclusoes: true });
  assert.equal(falhas.length, 0);

  falhas = avaliarGates(plano, { ...base, nMateriais: 3, overrideEmbed: true, overrideExclusoes: true });
  assert.deepEqual(falhas.map((f) => f.gate), ["fonte_insana"]);

  const planoD1Vazio = planejarDelta([item(1)], []);
  falhas = avaliarGates(planoD1Vazio, { ...base, maxEmbed: 10, maxExclusoes: 10 });
  assert.ok(falhas.some((f) => f.gate === "estado_invalido"));
});

test("delta-d1.sql: triggers, lotes e conteúdo", () => {
  const novos = Array.from({ length: 60 }, (_, i) => item(1000 + i));
  const alterado = item(1, { descricao: "COM 'ASPAS'", texto_embed: "x" });
  const soData = item(2, { atualizado_em: "2026-03-03T00:00:00" });
  const plano = planejarDelta(
    [...novos, alterado, soData],
    [linhaD1(1), linhaD1(2), linhaD1(3)],
  );
  const sql = gerarDeltaSql(plano);

  assert.equal((sql.match(/DROP TRIGGER IF EXISTS/g) || []).length, 3);
  assert.equal((sql.match(/CREATE TRIGGER/g) || []).length, 3);
  // Aspas simples escapadas no INSERT
  assert.match(sql, /COM ''ASPAS''/);
  // Excluído sai das 3 tabelas e não volta em INSERT de dados
  assert.match(sql, /DELETE FROM catalogo_itens WHERE id IN \('cat-material-1','cat-material-2','cat-material-3'\);/);
  assert.doesNotMatch(sql, /VALUES \('cat-material-3'/);
  // Alterados são removidos e reinseridos; novos só inseridos
  assert.match(sql, /VALUES \('cat-material-1'/);
  assert.match(sql, /'cat-material-1000'/);
  // 62 upserts → 2 statements de INSERT (50 + 12)
  assert.equal((sql.match(/INSERT INTO catalogo_itens /g) || []).length, 2);
  // FTS/trgm repostas via SELECT dos ids tocados
  assert.match(sql, /INSERT INTO catalogo_fts .* SELECT .* WHERE id IN/);
  assert.match(sql, /INSERT INTO catalogo_trgm .* SELECT .* WHERE id IN/);
  // Triggers recriados DEPOIS da reposição de FTS/trgm (não disparam duplicado).
  // Âncora no INSERT..SELECT (o corpo dos triggers também contém INSERT na FTS).
  assert.ok(sql.indexOf("CREATE TRIGGER") > sql.lastIndexOf("FROM catalogo_itens WHERE id IN"));
});

test("lotes IN de no máximo 200 ids", () => {
  const excluidos = Array.from({ length: 450 }, (_, i) => linhaD1(9000 + i));
  const plano = planejarDelta([], excluidos);
  const sql = gerarDeltaSql(plano);
  const dels = sql.match(/DELETE FROM catalogo_itens WHERE id IN \(([^)]+)\);/g) || [];
  assert.equal(dels.length, 3); // 200 + 200 + 50
  for (const d of dels) {
    assert.ok((d.match(/cat-material-/g) || []).length <= 200);
  }
});

test("estimativa de custo: chars/3 tokens na tarifa vigente", () => {
  const { chars, tokens, usd } = estimarCustoEmbed([
    { texto_embed: "a".repeat(300) },
    { texto_embed: "b".repeat(299) },
  ]);
  assert.equal(chars, 599);
  assert.equal(tokens, 200);
  assert.ok(Math.abs(usd - (200 / 1_000_000) * 0.012) < 1e-12);
});

test("confirmarExclusoes: detecta exclusão fantasma", async () => {
  const respostas = {
    "codigoItem=111": { resultado: [{ codigoItem: 111 }] }, // ainda existe!
    "codigoServico=22": { resultado: [] }, // sumiu de verdade
  };
  const fetchImpl = async (url) => {
    const chave = Object.keys(respostas).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => respostas[chave] ?? { resultado: [] } };
  };
  const { conferidos, aindaExistem } = await confirmarExclusoes(
    ["cat-material-111", "cat-servico-22"],
    { fetchImpl, pausaMs: 0 },
  );
  assert.equal(conferidos, 2);
  assert.deepEqual(aindaExistem, ["cat-material-111"]);
});

test("lerLinhasD1: formato do wrangler --json e success=false", () => {
  const raw = JSON.stringify([
    { results: [{ id: "cat-material-1" }, { id: "cat-material-2" }], success: true },
  ]);
  assert.equal(lerLinhasD1(raw).length, 2);
  assert.throws(
    () => lerLinhasD1(JSON.stringify([{ results: [], success: false }])),
    /success=false/,
  );
});
