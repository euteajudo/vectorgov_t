// ETL parse — CATMAT + CATSER (XLSX) -> itens.ndjson + catalogo-d1.sql
//
// Offline, não-gated: não embeda nem sobe nada. Roda em ~10s sobre ~165k itens.
//
// Uso:
//   CATMAT_XLSX="D:/2026/catmat"  (arquivo .xlsx ou diretório que o contenha)
//   CATSER_XLSX="D:/2026/catser"
//   OUT_DIR="./out"
//   node --max-old-space-size=4096 parse.mjs
//
// Layout das planilhas (validado em 2026-05):
//   CATMAT (sheet "Materiais", header linha 0): G=Código Item, H=Descrição,
//     B=Nome Grupo, D=Nome Classe, F=Nome PDM. Sem coluna de status (só ativos).
//   CATSER (sheet "Lista CATSER", dados a partir da linha 3): F=Código,
//     G=Descrição, C=Nome Grupo, E=Nome Classe, H=Situação ("Ativo").
import XLSX from "xlsx";
import {
  readFileSync,
  createWriteStream,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";

const SRC = {
  material: process.env.CATMAT_XLSX || "D:/2026/catmat",
  servico: process.env.CATSER_XLSX || "D:/2026/catser",
};
const OUT = process.env.OUT_DIR || "./out";
mkdirSync(OUT, { recursive: true });

function resolverXlsx(p) {
  if (statSync(p).isDirectory()) {
    const f = readdirSync(p).find((x) => x.toLowerCase().endsWith(".xlsx"));
    if (!f) throw new Error(`Nenhum .xlsx em ${p}`);
    return `${p}/${f}`;
  }
  return p;
}

function limpar(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/^'/, "").replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}

function lerMatriz(path) {
  const wb = XLSX.read(readFileSync(path), { dense: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true });
}

function extrair(tipo, linhas) {
  const itens = [];
  let pulados = 0;
  const inicio = tipo === "material" ? 1 : 3;
  for (let i = inicio; i < linhas.length; i++) {
    const r = linhas[i];
    if (!r) continue;
    const codRaw = tipo === "material" ? r[6] : r[5];
    const codigo = parseInt(String(codRaw ?? "").replace(/[^0-9]/g, ""), 10);
    if (!Number.isInteger(codigo) || codigo <= 0) {
      pulados++;
      continue;
    }
    const descricao = limpar(tipo === "material" ? r[7] : r[6]);
    if (!descricao) {
      pulados++;
      continue;
    }
    const grupo = limpar(tipo === "material" ? r[1] : r[2]);
    const classe = limpar(tipo === "material" ? r[3] : r[4]);
    const pdm = tipo === "material" ? limpar(r[5]) : null;
    const ativo = tipo === "material" ? 1 : limpar(r[7]) === "Ativo" ? 1 : 0;
    const texto_embed = [descricao, pdm ? `(${pdm})` : "", classe ? `[${classe}]` : ""]
      .filter(Boolean)
      .join(" ");
    itens.push({ id: `cat-${tipo}-${codigo}`, codigo, tipo, descricao, grupo, classe, pdm, ativo, texto_embed });
  }
  return { itens, pulados };
}

const sqlStr = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const ndjson = createWriteStream(`${OUT}/itens.ndjson`, { encoding: "utf8" });
const sql = createWriteStream(`${OUT}/catalogo-d1.sql`, { encoding: "utf8" });
sql.write("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n");

const CHUNK = 400;
let total = 0;
const resumo = {};
const vistos = new Set();

for (const tipo of ["material", "servico"]) {
  const { itens, pulados } = extrair(tipo, lerMatriz(resolverXlsx(SRC[tipo])));
  let dupes = 0;
  for (let i = 0; i < itens.length; i += CHUNK) {
    const lote = itens.slice(i, i + CHUNK).filter((it) => {
      if (vistos.has(it.id)) {
        dupes++;
        return false;
      }
      vistos.add(it.id);
      return true;
    });
    if (lote.length === 0) continue;
    for (const it of lote) ndjson.write(JSON.stringify(it) + "\n");
    const values = lote
      .map(
        (it) =>
          `(${sqlStr(it.id)},${it.codigo},${sqlStr(it.tipo)},${sqlStr(it.descricao)},${sqlStr(it.grupo)},${sqlStr(it.classe)},${sqlStr(it.pdm)},${it.ativo})`,
      )
      .join(",");
    sql.write(
      `INSERT INTO catalogo_itens (id,codigo,tipo,descricao,grupo,classe,pdm,ativo) VALUES ${values};\n`,
    );
    total += lote.length;
  }
  resumo[tipo] = { lidos: itens.length, pulados, dupes };
}

sql.write(
  "INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,descricao) " +
    "SELECT id,codigo,tipo,grupo,classe,descricao FROM catalogo_itens;\n",
);
sql.write("COMMIT;\n");
ndjson.end();
sql.end();

console.log("RESUMO:", JSON.stringify(resumo, null, 2));
console.log("TOTAL gravado:", total);
