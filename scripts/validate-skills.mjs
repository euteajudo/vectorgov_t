#!/usr/bin/env node
/**
 * Valida os arquivos markdown de skills locais.
 *
 * A checagem e intencionalmente leve: garante front-matter valido o bastante
 * para os scripts de sync e para as tools do Worker consumirem o catalogo.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_ROOT = join(REPO_ROOT, "packages", "skills");
const DIRS = ["active", "candidate", "archive"];

const REQUIRED = [
  "nome",
  "descricao",
  "trigger",
  "agentes_aplicaveis",
  "modelo_recomendado",
  "versao",
  "data_atualizacao",
  "autor",
  "tokens_aproximados",
  "categoria",
];

function coerceScalar(raw) {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(source) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") throw new Error("front-matter ausente");

  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) throw new Error("front-matter sem delimitador final");

  const data = {};
  let currentList = null;
  for (const raw of lines.slice(1, end)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const trimmed = raw.trim();
    if (trimmed.startsWith("- ")) {
      if (!currentList) throw new Error(`item de lista sem chave: ${raw}`);
      currentList.push(coerceScalar(trimmed.slice(2)));
      continue;
    }

    currentList = null;
    const colon = raw.indexOf(":");
    if (colon === -1) throw new Error(`linha sem chave: ${raw}`);
    const key = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (value === "") {
      data[key] = [];
      currentList = data[key];
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => coerceScalar(item))
        .filter((item) => String(item).length > 0);
      continue;
    }
    data[key] = coerceScalar(value);
  }
  return data;
}

function validateFile(dir, file) {
  const fullPath = join(SKILLS_ROOT, dir, file);
  const source = readFileSync(fullPath, "utf-8");
  const meta = parseFrontmatter(source);
  const errors = [];

  for (const field of REQUIRED) {
    if (meta[field] === undefined || meta[field] === null || meta[field] === "") {
      errors.push(`campo obrigatorio ausente: ${field}`);
    }
  }
  if (typeof meta.nome === "string" && !/^[a-z0-9-]+$/.test(meta.nome)) {
    errors.push("nome deve estar em kebab-case");
  }
  if (typeof meta.nome === "string" && meta.nome !== file.replace(/\.md$/, "")) {
    errors.push(`nome (${meta.nome}) diferente do arquivo (${file})`);
  }
  if (typeof meta.versao === "string" && !/^\d+\.\d+\.\d+$/.test(meta.versao)) {
    errors.push("versao deve usar SemVer");
  }
  if (!Array.isArray(meta.agentes_aplicaveis) || meta.agentes_aplicaveis.length === 0) {
    errors.push("agentes_aplicaveis precisa ter pelo menos um item");
  }
  if (
    typeof meta.tokens_aproximados !== "number" ||
    !Number.isInteger(meta.tokens_aproximados) ||
    meta.tokens_aproximados <= 0
  ) {
    errors.push("tokens_aproximados deve ser inteiro positivo");
  }

  return errors;
}

const failures = [];
let checked = 0;

for (const dir of DIRS) {
  const fullDir = join(SKILLS_ROOT, dir);
  for (const file of readdirSync(fullDir).filter((name) => name.endsWith(".md")).sort()) {
    checked += 1;
    try {
      const errors = validateFile(dir, file);
      for (const error of errors) failures.push(`${dir}/${file}: ${error}`);
    } catch (err) {
      failures.push(`${dir}/${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`[skills-validate] ${failures.length} erro(s) em ${checked} arquivo(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`[skills-validate] OK: ${checked} arquivo(s) validado(s).`);
