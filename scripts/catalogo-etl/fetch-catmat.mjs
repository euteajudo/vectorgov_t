// ETL fetch — CATMAT via API oficial dadosabertos.compras.gov.br
//
// Fonte AUTOMATIZÁVEL dos materiais: o CSV oficial (~120MB) não tem URL
// pública estável (as páginas gov.br/compras que o hospedam exigem login),
// então a atualização agendada usa a MESMA API paginada do CATSER. Validado
// em 2026-07: os campos e valores (descricaoItem, nomePdm, codigo_ncm,
// dataHoraAtualizacao) são idênticos aos do CSV — com um bônus: statusItem
// REAL. O CSV inclui inativos sem dizer (343.510 = 248.017 ativos + 95.493
// inativos em 2026-07), e o parse-csv.mjs grava todos com ativo=1; aqui o
// status vai correto para o D1 e para a metadata do vetor.
//
// Endpoint (GET, sem auth — validado em 2026-07):
//   /modulo-material/4_consultarItemMaterial?pagina=N&tamanhoPagina=500
//   - sem filtro de statusItem: retorna o catálogo COMPLETO (ativos+inativos)
//   - response: { resultado: [...], totalRegistros, totalPaginas, paginasRestantes }
//   - ~343k itens (~688 páginas de 500)
//
// Uso:
//   node --max-old-space-size=4096 fetch-catmat.mjs [--out ./out]
//
// Saída: out/itens.ndjson + out/catalogo-d1.sql — MESMOS arquivos e shape do
// parse-csv.mjs (que segue válido para carga manual a partir do CSV local).
import { createWriteStream, mkdirSync } from "node:fs";
import { sanearGrupo } from "./sane-grupos.mjs";

const args = process.argv.slice(2);
const OUT = (() => {
  const i = args.indexOf("--out");
  return i >= 0 ? args[i + 1] : process.env.OUT_DIR || "./out";
})();
// Teto de páginas para smoke test local (ex.: --max-paginas 3). Em produção,
// deixar sem: o gate de mínimo abaixo reprova cargas parciais.
const MAX_PAGINAS = (() => {
  const i = args.indexOf("--max-paginas");
  return i >= 0 ? parseInt(args[i + 1], 10) : Infinity;
})();
mkdirSync(OUT, { recursive: true });

const BASE =
  "https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial";
const TAMANHO_PAGINA = 500; // máximo aceito pela API
const PAUSA_ENTRE_PAGINAS_MS = 150; // cortesia: ~688 páginas em sequência

// Gate de sanidade da fonte: o catálogo completo tem ~343k itens; menos que
// isso indica truncamento/paginação quebrada — abortar em vez de gerar um
// delta que "excluiria" dezenas de milhares de itens rio abaixo.
const MIN_ITENS = parseInt(process.env.CATMAT_MIN_ITENS || "300000", 10);

// Contrato de campos validado em 2026-07. Se a API renomear/remover um campo,
// falhar AQUI com mensagem clara em vez de gravar nulls silenciosos.
const CAMPOS_OBRIGATORIOS = [
  "codigoItem",
  "nomeGrupo",
  "nomeClasse",
  "nomePdm",
  "descricaoItem",
  "statusItem",
  "codigo_ncm",
  "dataHoraAtualizacao",
];

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

// Mesmo texto de embed do parse-csv.mjs: descricao + (pdm) + [classe válida].
function montarTextoEmbed(descricao, pdm, classe) {
  return [descricao, pdm ? `(${pdm})` : null, classeValida(classe) ? `[${classe}]` : null]
    .filter(Boolean)
    .join(" ");
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

const vistos = new Set();
const itens = []; // buffer completo: ordenamos por codigo antes de gravar
let dupes = 0;
let pulados = 0;
let totalRegistros = null;

let pagina = 1;
let totalPaginas = 1;
do {
  let json = await buscarPagina(pagina);
  // max: response instável reportando totalPaginas menor não pode encurtar o
  // fetch (perda silenciosa das páginas finais).
  totalPaginas = Math.max(totalPaginas, json.totalPaginas ?? 0);
  totalRegistros = json.totalRegistros ?? totalRegistros;
  // Página 200-mas-incompleta (menos linhas que o pedido, sem erro): mesma
  // instabilidade que perdeu ~200 serviços no run 29580173104 do CATSER.
  // Página não-final curta é anômala — re-busca; persistindo, aborta.
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
  if (pagina === 1 && resultado.length > 0) {
    const faltando = CAMPOS_OBRIGATORIOS.filter((c) => !(c in resultado[0]));
    if (faltando.length > 0) {
      console.error(
        `Contrato da API mudou — campos ausentes no response: ${faltando.join(", ")}. ` +
          "Revisar fetch-catmat.mjs antes de qualquer carga.",
      );
      process.exit(1);
    }
  }
  for (const r of resultado) {
    const codigo = Number(r.codigoItem);
    const descricao = limpar(r.descricaoItem);
    if (!Number.isInteger(codigo) || codigo <= 0 || !descricao) {
      pulados++;
      continue;
    }
    const id = `cat-material-${codigo}`;
    if (vistos.has(id)) {
      // A paginação da API pode repetir itens se o catálogo mudar no meio do
      // fetch — a 1ª ocorrência vence (mesma regra do fetch-catser).
      dupes++;
      continue;
    }
    vistos.add(id);
    const classe = limpar(r.nomeClasse);
    const pdm = limpar(r.nomePdm);
    itens.push({
      id,
      codigo,
      tipo: "material",
      descricao,
      grupo: sanearGrupo(limpar(r.nomeGrupo)),
      classe,
      pdm,
      ncm: limpar(r.codigo_ncm),
      ativo: r.statusItem === true ? 1 : 0,
      // A API já devolve ISO 8601 com "T"; o replace é defensivo para manter
      // o formato idêntico ao normalizado pelo parse-csv.mjs.
      atualizado_em: limpar(r.dataHoraAtualizacao)?.replace(" ", "T") ?? null,
      texto_embed: montarTextoEmbed(descricao, pdm, classe),
    });
  }
  if (pagina % 25 === 0 || pagina === totalPaginas) {
    console.log(`página ${pagina}/${totalPaginas}: ${itens.length} itens acumulados`);
  }
  pagina++;
  if (pagina <= totalPaginas) {
    await new Promise((r) => setTimeout(r, PAUSA_ENTRE_PAGINAS_MS));
  }
} while (pagina <= totalPaginas && pagina <= MAX_PAGINAS);

// Ordena por codigo: saída determinística entre execuções (a API não garante
// ordem estável) — evita que o manifest do embed.mjs invalide shards por mera
// reordenação e torna os diffs do delta reprodutíveis.
itens.sort((a, b) => a.codigo - b.codigo);

const emSmokeTest = Number.isFinite(MAX_PAGINAS);
if (!emSmokeTest && itens.length < MIN_ITENS) {
  console.error(
    `Fonte suspeita: ${itens.length} itens (< mínimo ${MIN_ITENS}; API anunciou ` +
      `totalRegistros=${totalRegistros}). Truncamento/paginação quebrada — abortando ` +
      "sem gravar saída. Ajuste CATMAT_MIN_ITENS apenas se o catálogo tiver " +
      "encolhido de verdade.",
  );
  process.exit(1);
}

// Conferência final contra o total anunciado pela API. Tolerância de 250
// (meia página) absorve mudança legítima do catálogo durante os ~40 min de
// fetch; acima disso é truncamento — melhor falhar AQUI (barato) do que em
// "exclusão fantasma" rio abaixo.
const processadosApi = itens.length + dupes + pulados;
if (!emSmokeTest && totalRegistros !== null && Math.abs(processadosApi - totalRegistros) > 250) {
  console.error(
    `Fonte truncada: processados=${processadosApi} vs totalRegistros=${totalRegistros} — abortando sem gravar saída.`,
  );
  process.exit(1);
}

const ndjson = createWriteStream(`${OUT}/itens.ndjson`, { encoding: "utf8" });
const sql = createWriteStream(`${OUT}/catalogo-d1.sql`, { encoding: "utf8" });
// Sem BEGIN/COMMIT: o `wrangler d1 execute --file` já envolve numa transação.

// 50 linhas por INSERT: acima disso o D1 estoura "statement too long".
const CHUNK = 50;
let ativos = 0;
for (let i = 0; i < itens.length; i += CHUNK) {
  const lote = itens.slice(i, i + CHUNK);
  for (const it of lote) {
    ndjson.write(JSON.stringify(it) + "\n");
    if (it.ativo) ativos++;
  }
  const values = lote
    .map(
      (it) =>
        `(${sqlStr(it.id)},${it.codigo},${sqlStr(it.tipo)},${sqlStr(it.descricao)},${sqlStr(it.grupo)},${sqlStr(it.classe)},${sqlStr(it.pdm)},${sqlStr(it.ncm)},${it.ativo},${sqlStr(it.atualizado_em)})`,
    )
    .join(",");
  sql.write(
    `INSERT INTO catalogo_itens (id,codigo,tipo,descricao,grupo,classe,pdm,ncm,ativo,atualizado_em) VALUES ${values};\n`,
  );
}
// SQL só de dados — na carga COMPLETA a FTS e a trigram são reconstruídas por
// sql/rebuild-pos-carga.sql; no fluxo delta o delta.mjs gera o SQL próprio.
ndjson.end();
sql.end();

console.log(
  "RESUMO:",
  JSON.stringify(
    {
      gravados: itens.length,
      ativos,
      inativos: itens.length - ativos,
      dupes,
      pulados,
      totalRegistrosApi: totalRegistros,
      saida: OUT,
    },
    null,
    2,
  ),
);
