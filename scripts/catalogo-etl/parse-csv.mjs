// ETL parse — CATMAT (CSV oficial dadosabertos) -> itens.ndjson + catalogo-d1.sql
//
// Substitui o caminho XLSX do parse.mjs para materiais: a fonte nova é o CSV
// do dadosabertos.compras.gov.br (UTF-8 com BOM, separador ';', 343.352 linhas,
// codigoItem único). Serviços (CATSER) vêm da API — ver fetch-catser.mjs.
//
// Offline, não-gated: não embeda nem sobe nada.
//
// Uso:
//   node parse-csv.mjs --input D:/2026/catmat.csv [--out ./out] [--sample 2000]
//   (ou CATMAT_CSV=... OUT_DIR=... node parse-csv.mjs)
//
// Saída no mesmo shape consumido por embed.mjs (texto_embed pronto), mais os
// campos novos da migration 0007: ncm, ativo, atualizado_em.
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import readline from "node:readline";
import { sanearGrupo } from "./sane-grupos.mjs";

const args = process.argv.slice(2);
function flag(nome) {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : null;
}

const INPUT = flag("--input") || process.env.CATMAT_CSV;
const OUT = flag("--out") || process.env.OUT_DIR || "./out";
const SAMPLE = flag("--sample") ? parseInt(flag("--sample"), 10) : Infinity;

if (!INPUT) {
  console.error("Informe o CSV: --input <arquivo> ou CATMAT_CSV=...");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// Header oficial validado em 2026-07 (11 colunas).
const HEADER = [
  "codigoGrupo",
  "nomeGrupo",
  "codigoClasse",
  "nomeClasse",
  "codigoPdm",
  "nomePdm",
  "codigoItem",
  "descricaoItem",
  "codigoNcm",
  "aplicaMargemPreferencia",
  "dataHoraAtualizacao",
];

// Parser CSV de verdade (state machine): a fonte tem aspas escapadas ("")
// DENTRO de campos em ~30k linhas — ex.: o PDM ""MICROCOMPUTADOR PESSOAL
// NOTEBOOK"" — então split ingênuo corromperia exatamente os itens que a
// investigação mostrou estarem mal ranqueados.
function parseRegistro(registro, sep) {
  const campos = [];
  let atual = "";
  let emAspas = false;
  for (let i = 0; i < registro.length; i++) {
    const ch = registro[i];
    if (emAspas) {
      if (ch === '"') {
        if (registro[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          emAspas = false;
        }
      } else {
        atual += ch;
      }
    } else if (ch === '"') {
      emAspas = true;
    } else if (ch === sep) {
      campos.push(atual);
      atual = "";
    } else {
      atual += ch;
    }
  }
  campos.push(atual);
  return campos;
}

function limpar(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}

// Classe entra no texto de embed SÓ se válida: os marcadores INVALIDO/INVALIDA
// da fonte antiga poluíam o vetor ("[INVALIDO]" virava sinal semântico).
function classeValida(classe) {
  if (!classe) return false;
  const norm = classe
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  return norm !== "INVALIDO" && norm !== "INVALIDA";
}

function montarTextoEmbed(descricao, pdm, classe) {
  return [descricao, pdm ? `(${pdm})` : null, classeValida(classe) ? `[${classe}]` : null]
    .filter(Boolean)
    .join(" ");
}

const sqlStr = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const ndjson = createWriteStream(`${OUT}/itens.ndjson`, { encoding: "utf8" });
const sql = createWriteStream(`${OUT}/catalogo-d1.sql`, { encoding: "utf8" });
// Sem BEGIN/COMMIT explícito: o `wrangler d1 execute --file` envolve o arquivo
// na própria transação e rejeita BEGIN TRANSACTION/SAVEPOINT no SQL.

// 50 linhas por INSERT: acima disso o D1 estoura "statement too long" (SQLITE_TOOBIG).
const CHUNK = 50;

const rl = readline.createInterface({
  input: createReadStream(INPUT, "utf8"),
  crlfDelay: Infinity,
});

let numLinha = 0;
let lidos = 0;
let pulados = 0;
let dupes = 0;
let gravados = 0;
const vistos = new Set();
let pendente = ""; // acumulador para registro com quebra de linha dentro de campo
let lote = [];

function contarAspas(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '"') n++;
  return n;
}

function flushLote() {
  if (lote.length === 0) return;
  for (const it of lote) ndjson.write(JSON.stringify(it) + "\n");
  const values = lote
    .map(
      (it) =>
        `(${sqlStr(it.id)},${it.codigo},${sqlStr(it.tipo)},${sqlStr(it.descricao)},${sqlStr(it.grupo)},${sqlStr(it.classe)},${sqlStr(it.pdm)},${sqlStr(it.ncm)},${it.ativo},${sqlStr(it.atualizado_em)})`,
    )
    .join(",");
  sql.write(
    `INSERT INTO catalogo_itens (id,codigo,tipo,descricao,grupo,classe,pdm,ncm,ativo,atualizado_em) VALUES ${values};\n`,
  );
  gravados += lote.length;
  lote = [];
}

for await (let linha of rl) {
  // O registro só fecha com número par de aspas (aspas escapadas contam 2);
  // ímpar significa quebra de linha dentro de campo — acumula.
  pendente = pendente ? pendente + "\n" + linha : linha;
  if (contarAspas(pendente) % 2 !== 0) continue;
  const registro = pendente;
  pendente = "";

  numLinha++;
  if (numLinha === 1) {
    const header = parseRegistro(registro.replace(/^﻿/, ""), ";");
    if (header.join(";") !== HEADER.join(";")) {
      console.error("Header inesperado no CSV:", header.join(";"));
      process.exit(1);
    }
    continue;
  }
  if (lidos >= SAMPLE) break;
  lidos++;

  const campos = parseRegistro(registro, ";");
  if (campos.length !== HEADER.length) {
    pulados++;
    continue;
  }
  const [, nomeGrupo, , nomeClasse, , nomePdm, codigoItem, descricaoItem, codigoNcm, , dataHora] =
    campos;

  const codigo = parseInt(String(codigoItem).replace(/[^0-9]/g, ""), 10);
  const descricao = limpar(descricaoItem);
  if (!Number.isInteger(codigo) || codigo <= 0 || !descricao) {
    pulados++;
    continue;
  }
  const id = `cat-material-${codigo}`;
  if (vistos.has(id)) {
    dupes++;
    continue;
  }
  vistos.add(id);

  const grupo = sanearGrupo(limpar(nomeGrupo));
  const classe = limpar(nomeClasse);
  const pdm = limpar(nomePdm);
  const ncm = limpar(codigoNcm);
  // Normaliza "2021-10-16 09:43:08.030221" para ISO 8601 (mesmo formato da API CATSER).
  const atualizado_em = limpar(dataHora)?.replace(" ", "T") ?? null;

  lote.push({
    id,
    codigo,
    tipo: "material",
    descricao,
    grupo,
    classe,
    pdm,
    ncm,
    // A fonte CSV só traz itens ativos; a coluna real permite desativação futura.
    ativo: 1,
    atualizado_em,
    texto_embed: montarTextoEmbed(descricao, pdm, classe),
  });
  if (lote.length >= CHUNK) flushLote();
}
flushLote();

// O SQL gerado carrega SÓ catalogo_itens. A FTS e a trigram são
// reconstruídas UMA vez por sql/rebuild-pos-carga.sql (em fatias que cabem no
// limite de 30s do D1) — repopular aqui, além de redundante, arriscava
// estourar o limite com um INSERT..SELECT único de ~346k linhas na FTS5.
ndjson.end();
sql.end();

console.log(
  "RESUMO:",
  JSON.stringify({ lidos, gravados, pulados, dupes, saida: OUT }, null, 2),
);
