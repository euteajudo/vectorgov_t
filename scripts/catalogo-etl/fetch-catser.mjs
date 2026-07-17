// ETL fetch — CATSER via API oficial dadosabertos.compras.gov.br
//
// Substitui o XLSX mojibakado ('¿' no lugar de ÇÕ/ÇÃ) como fonte dos serviços:
// a API pública devolve grupo/classe limpos e o status real do item.
//
// Endpoint (GET, sem auth — validado em 2026-07):
//   /modulo-servico/6_consultarItemServico?pagina=N&tamanhoPagina=500
//   - tamanhoPagina aceita 10..500 (fora disso a API responde texto de erro)
//   - response: { resultado: [...], totalRegistros, totalPaginas, paginasRestantes }
//   - ~3.095 registros (7 páginas de 500), inclui inativos (statusServico=false)
//
// Uso:
//   node fetch-catser.mjs [--out ./out]
//
// Saída: out/itens-servico.ndjson (mesmo shape do parse-csv.mjs, para o
// embed.mjs) + out/catser-d1.sql. Ver README para a ordem de aplicação.
import { createWriteStream, mkdirSync } from "node:fs";
import { sanearGrupo } from "./sane-grupos.mjs";

const args = process.argv.slice(2);
const OUT = (() => {
  const i = args.indexOf("--out");
  return i >= 0 ? args[i + 1] : process.env.OUT_DIR || "./out";
})();
mkdirSync(OUT, { recursive: true });

const BASE =
  "https://dadosabertos.compras.gov.br/modulo-servico/6_consultarItemServico";
const TAMANHO_PAGINA = 500; // máximo aceito pela API

function limpar(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}

function classeValida(classe) {
  if (!classe) return false;
  const norm = classe
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  return norm !== "INVALIDO" && norm !== "INVALIDA";
}

async function buscarPagina(pagina, tentativa = 1) {
  const url = `${BASE}?pagina=${pagina}&tamanhoPagina=${TAMANHO_PAGINA}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const corpo = (await res.text()).slice(0, 300);
    if ((res.status === 429 || res.status >= 500) && tentativa <= 4) {
      const espera = 1000 * 2 ** (tentativa - 1);
      console.warn(`  ${res.status} na página ${pagina} — retry em ${espera}ms`);
      await new Promise((r) => setTimeout(r, espera));
      return buscarPagina(pagina, tentativa + 1);
    }
    throw new Error(`API ${res.status} na página ${pagina}: ${corpo}`);
  }
  return res.json();
}

const sqlStr = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const ndjson = createWriteStream(`${OUT}/itens-servico.ndjson`, { encoding: "utf8" });
const sql = createWriteStream(`${OUT}/catser-d1.sql`, { encoding: "utf8" });
// Sem BEGIN/COMMIT: o `wrangler d1 execute --file` já envolve numa transação.

// 50 linhas por INSERT: acima disso o D1 estoura "statement too long".
const CHUNK = 50;
const vistos = new Set();
let lote = [];
let gravados = 0;
let ativos = 0;
let dupes = 0;
let pulados = 0;

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

let pagina = 1;
let totalPaginas = 1;
let totalRegistros = null;
do {
  let json = await buscarPagina(pagina);
  // max: um response instável reportando totalPaginas menor não pode encurtar
  // o fetch (perda silenciosa de páginas finais).
  totalPaginas = Math.max(totalPaginas, json.totalPaginas ?? 0);
  totalRegistros = json.totalRegistros ?? totalRegistros;
  // Página 200-mas-incompleta: o backend instável devolve MENOS linhas que o
  // tamanho pedido sem erro nenhum — foi assim que o run 29580173104 perdeu
  // ~200 serviços e gerou 132 "exclusões fantasma". Página não-final curta é
  // anômala (blocos fixos de TAMANHO_PAGINA): re-busca; persistindo, aborta o
  // fetch (barato) antes de gastar confirmação/embed rio abaixo.
  for (let t = 1; pagina < totalPaginas && (json.resultado ?? []).length < TAMANHO_PAGINA; t++) {
    const veio = (json.resultado ?? []).length;
    if (t > 4) {
      throw new Error(
        `Página ${pagina} incompleta (${veio}/${TAMANHO_PAGINA}) após 4 re-buscas — fonte instável, abortando.`,
      );
    }
    console.warn(`  página ${pagina} incompleta (${veio}/${TAMANHO_PAGINA}) — re-buscando (${t}/4)`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (t - 1)));
    json = await buscarPagina(pagina);
    totalPaginas = Math.max(totalPaginas, json.totalPaginas ?? 0);
    totalRegistros = json.totalRegistros ?? totalRegistros;
  }
  const resultado = json.resultado ?? [];
  for (const r of resultado) {
    const codigo = Number(r.codigoServico);
    const descricao = limpar(r.nomeServico);
    if (!Number.isInteger(codigo) || codigo <= 0 || !descricao) {
      pulados++;
      continue;
    }
    const id = `cat-servico-${codigo}`;
    if (vistos.has(id)) {
      dupes++;
      continue;
    }
    vistos.add(id);
    const classe = limpar(r.nomeClasse);
    const ativo = r.statusServico === true ? 1 : 0;
    if (ativo) ativos++;
    lote.push({
      id,
      codigo,
      tipo: "servico",
      descricao,
      // Grupos da API vêm limpos; sanearGrupo ainda colapsa espaços da fonte
      // (as descrições herdam colagens do sistema legado, mas grupo não).
      grupo: sanearGrupo(limpar(r.nomeGrupo)),
      classe,
      pdm: null,
      ncm: null,
      ativo,
      atualizado_em: limpar(r.dataHoraAtualizacao),
      texto_embed: [descricao, classeValida(classe) ? `[${classe}]` : null]
        .filter(Boolean)
        .join(" "),
    });
    if (lote.length >= CHUNK) flushLote();
  }
  console.log(`página ${pagina}/${totalPaginas}: +${resultado.length}`);
  pagina++;
} while (pagina <= totalPaginas);
flushLote();

// SQL só de dados — a FTS e a trigram são reconstruídas de uma vez por
// sql/rebuild-pos-carga.sql, depois que catmat E catser estiverem carregados.
ndjson.end();
sql.end();

// Conferência final contra o total anunciado pela API. Tolerância de 250
// (meia página) absorve mudança legítima do catálogo no meio do fetch;
// acima disso é truncamento — aborta para o workflow falhar AQUI, não em
// "exclusão fantasma" depois de minutos de conferência.
const processados = gravados + dupes + pulados;
if (totalRegistros !== null && Math.abs(processados - totalRegistros) > 250) {
  console.error(
    `Fonte truncada: processados=${processados} vs totalRegistros=${totalRegistros} — abortando.`,
  );
  process.exit(1);
}

console.log(
  "RESUMO:",
  JSON.stringify(
    {
      gravados,
      ativos,
      inativos: gravados - ativos,
      dupes,
      pulados,
      totalRegistrosApi: totalRegistros,
      saida: OUT,
    },
    null,
    2,
  ),
);
