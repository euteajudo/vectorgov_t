#!/usr/bin/env node
/**
 * Runner do golden set de petições de teste.
 *
 * Para cada caso em `test/golden-set/caso-NN-*`:
 *   1. POST /api/peticoes/upload com `peticao.json`
 *   2. Aguarda análise concluir (polling do /api/peticoes/:id)
 *   3. Compara veredito + citações + score contra `gabarito-analise.json`
 *   4. Imprime resultado por caso
 *
 * Exit code 0 se 5/5 passarem, 1 caso contrário.
 *
 * Uso:
 *   NODE_OPTIONS=--use-system-ca node run-golden-set.mjs
 *
 * Variáveis de ambiente:
 *   WORKER_URL  — default https://vectorgov-t-mcp.souzat19.workers.dev
 *   TIMEOUT_MS  — tempo máximo de polling por caso (default 180000)
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_URL = process.env.WORKER_URL ?? "https://vectorgov-t-mcp.souzat19.workers.dev";
const TIMEOUT_MS = Number.parseInt(process.env.TIMEOUT_MS ?? "180000", 10);
const POLL_INTERVAL_MS = 3000;

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

/**
 * Carrega todos os casos do diretório.
 */
async function loadCases() {
  const entries = await readdir(__dirname, { withFileTypes: true });
  const casos = [];
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith("caso-")) continue;
    const dir = join(__dirname, e.name);
    const peticao = JSON.parse(await readFile(join(dir, "peticao.json"), "utf-8"));
    const gabarito = JSON.parse(await readFile(join(dir, "gabarito-analise.json"), "utf-8"));
    casos.push({ nome: e.name, dir, peticao, gabarito });
  }
  return casos.sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * Faz upload e aguarda análise concluir.
 */
async function executarCaso(caso) {
  const formData = new FormData();
  formData.append("metadata", JSON.stringify(caso.peticao.metadata));
  // Cria um "PDF" sintético com o texto da petição (apenas para o pipeline aceitar).
  // Em produção real, isso viria de um arquivo PDF.
  const pdfBlob = new Blob(
    [`PDF SIMULADO\n\n${caso.peticao.peticao_texto}`],
    { type: "application/pdf" },
  );
  formData.append("pdf", pdfBlob, `${caso.nome}.pdf`);

  const uploadRes = await fetch(`${WORKER_URL}/api/peticoes/upload`, {
    method: "POST",
    body: formData,
  });
  if (!uploadRes.ok) {
    throw new Error(`Upload falhou: HTTP ${uploadRes.status}`);
  }
  const upload = await uploadRes.json();
  const id = upload.id;

  // Polling
  const startTime = Date.now();
  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`${WORKER_URL}/api/peticoes/${id}`);
    if (!statusRes.ok) {
      throw new Error(`Status falhou: HTTP ${statusRes.status}`);
    }
    const status = await statusRes.json();
    if (status.fase === "done" && status.analise) {
      return status.analise;
    }
    if (status.fase === "failed") {
      throw new Error(`Análise falhou: ${status.erro ?? "sem detalhes"}`);
    }
  }
  throw new Error(`Timeout após ${TIMEOUT_MS}ms`);
}

/**
 * Compara análise gerada contra gabarito.
 */
function avaliar(analise, gabarito) {
  const erros = [];

  // 1. Veredito
  if (analise.veredito !== gabarito.veredito_esperado) {
    erros.push(`veredito: esperado=${gabarito.veredito_esperado}, obtido=${analise.veredito}`);
  }

  // 2. Score min/max
  if (gabarito.score_minimo_esperado != null && analise.score_confianca < gabarito.score_minimo_esperado) {
    erros.push(`score baixo: esperado≥${gabarito.score_minimo_esperado}, obtido=${analise.score_confianca}`);
  }
  if (gabarito.score_maximo_esperado != null && analise.score_confianca > gabarito.score_maximo_esperado) {
    erros.push(`score alto: esperado≤${gabarito.score_maximo_esperado}, obtido=${analise.score_confianca}`);
  }

  // 3. Citações obrigatórias
  const citacoesObtidas = (analise.citacoes ?? []).map((c) => `${c.norma}|${c.artigo}`);
  for (const obrig of gabarito.citacoes_obrigatorias ?? []) {
    const chave = `${obrig.norma}|${obrig.artigo}`;
    const match = citacoesObtidas.some((c) => c.includes(obrig.norma) || c.includes(obrig.artigo));
    if (!match) {
      erros.push(`citação faltante: ${chave} (${obrig.motivo})`);
    }
  }

  // 4. Citações REJEITADAS são bloqueantes
  const rejeitadas = (analise.citacoes ?? []).filter((c) => c.status === "REJEITADA");
  if (rejeitadas.length > 0) {
    erros.push(`${rejeitadas.length} citação(ões) REJEITADA(s) pelo Auditor`);
  }

  return { aprovado: erros.length === 0, erros };
}

async function main() {
  console.log(`${BOLD}🧪 Golden Set Runner — Vectorgov_t${RESET}`);
  console.log(`Worker: ${WORKER_URL}`);
  console.log(`Timeout por caso: ${TIMEOUT_MS / 1000}s`);
  console.log();

  const casos = await loadCases();
  console.log(`Carregados ${casos.length} casos.\n`);

  const resultados = [];
  for (const caso of casos) {
    process.stdout.write(`[${caso.nome}] executando... `);
    try {
      const analise = await executarCaso(caso);
      const aval = avaliar(analise, caso.gabarito);
      if (aval.aprovado) {
        console.log(`${GREEN}✓ APROVADO${RESET}`);
      } else {
        console.log(`${RED}✗ REPROVADO${RESET}`);
        for (const e of aval.erros) console.log(`    ${YELLOW}→${RESET} ${e}`);
      }
      resultados.push({ caso: caso.nome, ...aval });
    } catch (err) {
      console.log(`${RED}✗ ERRO: ${err.message}${RESET}`);
      resultados.push({ caso: caso.nome, aprovado: false, erros: [err.message] });
    }
  }

  const aprovados = resultados.filter((r) => r.aprovado).length;
  console.log();
  console.log(`${BOLD}═══════════════════════════════════${RESET}`);
  console.log(`${BOLD}Resultado: ${aprovados}/${resultados.length} aprovados${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════${RESET}`);
  process.exit(aprovados === resultados.length ? 0 : 1);
}

main().catch((err) => {
  console.error(`${RED}Erro fatal: ${err.message}${RESET}`);
  process.exit(2);
});
