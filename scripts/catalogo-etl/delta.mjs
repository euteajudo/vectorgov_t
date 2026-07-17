// ETL delta — diff fonte oficial × estado atual do D1 → plano de atualização
// incremental (base do fluxo AGENDADO; ver .github/workflows/catalogo-etl.yml).
//
// Em vez de recarregar ~346k itens (reset → carga → rebuild) e re-embedar o
// catálogo inteiro (~US$ 0,35 + horas), o delta compara campo a campo e gera:
//   out/delta/delta-d1.sql   — upsert/delete ATÔMICO (um único `d1 execute --file`)
//   out/delta/itens.ndjson   — SÓ os itens que precisam de (re)embed, no shape
//                              que o embed.mjs consome (apontar OUT_DIR=out/delta)
//   out/delta/relatorio.json — contagens, gates e estimativa de custo
//   out/delta/relatorio.md   — resumo humano (job summary do CI)
//   <dir da fonte>/ids-antes.json — snapshot de IDs do D1 (texto, 1/linha) para
//                              o limpar-orfaos.mjs remover vetores excluídos
//
// O D1 é a PRÓPRIA baseline: todos os campos que alimentam o texto_embed e a
// metadata do vetor estão gravados lá, então não existe estado paralelo para
// driftar — e um apply parcialmente falho converge sozinho na próxima execução
// (o diff é contra o estado REAL, não contra um log de intenções).
//
// Classificação por item:
//   novo            — id na fonte, ausente no D1            → insert + embed
//   alterado_vetor  — mudou descricao/grupo/classe/pdm/ncm/ativo
//                     (afeta texto_embed e/ou metadata)      → upsert + re-embed
//   alterado_data   — SÓ atualizado_em mudou                 → upsert (sem embed)
//   excluido        — id no D1, ausente da fonte             → delete + órfão
//
// GATES (falham ANTES de gravar qualquer coisa no D1/Vectorize):
//   fonte insana    — materiais < CATMAT_MIN_ITENS, serviços < CATSER_MIN_ITENS,
//                     ou D1 vazio/incompleto (carga inicial não feita) → exit 3
//   teto de embed   — |novo ∪ alterado_vetor| > DELTA_MAX_EMBED e sem
//                     DELTA_OVERRIDE_EMBED=true → exit 2 (pedir aprovação humana)
//   teto de exclusão— |excluido| > DELTA_MAX_EXCLUSOES e sem
//                     DELTA_OVERRIDE_EXCLUSOES=true → exit 2
//   exclusão fantasma— com --confirmar-exclusoes, cada excluído é reconferido
//                     na API; se algum AINDA existir, a paginação do fetch foi
//                     inconsistente (catálogo mudou no meio) → exit 3 (re-rodar)
//
// Uso:
//   node --max-old-space-size=4096 delta.mjs \
//     --fonte out/itens.ndjson --d1 out/d1-atual --out out/delta \
//     [--confirmar-exclusoes] [--ids-antes out/ids-antes.json]
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// Campos que entram no texto_embed (descricao/pdm/classe) e/ou na metadata do
// vetor (todos) — mudou um deles, o vetor precisa de re-upsert (e o upsert do
// Vectorize exige os values, então re-embedamos; ver README §delta).
export const CAMPOS_VETOR = ["descricao", "grupo", "classe", "pdm", "ncm", "ativo"];
// Persistidos no D1 além dos acima.
export const CAMPOS_D1 = [...CAMPOS_VETOR, "atualizado_em"];

const norm = (v) => (v === undefined || v === null || v === "" ? null : v);

export function itemDiferente(fonte, d1, campos) {
  return campos.some((c) => norm(fonte[c]) !== norm(d1[c]));
}

// fonteItens: array (shape do itens.ndjson); d1Rows: array de linhas do D1.
export function planejarDelta(fonteItens, d1Rows) {
  const d1 = new Map();
  for (const r of d1Rows) d1.set(r.id, r);

  const novos = [];
  const alteradosVetor = [];
  const alteradosData = [];
  const idsFonte = new Set();
  for (const it of fonteItens) {
    if (idsFonte.has(it.id)) {
      throw new Error(`Fonte com id duplicado: ${it.id} — fetch corrompido.`);
    }
    idsFonte.add(it.id);
    const atual = d1.get(it.id);
    if (!atual) {
      novos.push(it);
    } else if (itemDiferente(it, atual, CAMPOS_VETOR)) {
      alteradosVetor.push(it);
    } else if (itemDiferente(it, atual, ["atualizado_em"])) {
      alteradosData.push(it);
    }
  }
  const excluidos = [];
  for (const id of d1.keys()) {
    if (!idsFonte.has(id)) excluidos.push(id);
  }
  excluidos.sort();

  return { novos, alteradosVetor, alteradosData, excluidos, totalD1: d1.size };
}

// Estimativa de custo do embed (bge-m3 no Workers AI). ~3 chars/token no
// vocabulário do catálogo (maiúsculas pt-BR); tarifa vigente em 2026-07 —
// conferir a página de pricing antes de aprovar um override grande.
export const USD_POR_MTOKEN = 0.012;
export function estimarCustoEmbed(itens) {
  const chars = itens.reduce((s, it) => s + (it.texto_embed?.length ?? 0), 0);
  const tokens = Math.ceil(chars / 3);
  return { chars, tokens, usd: (tokens / 1_000_000) * USD_POR_MTOKEN };
}

export function avaliarGates(plano, cfg) {
  const paraEmbed = plano.novos.length + plano.alteradosVetor.length;
  const falhas = [];
  const nMateriais = cfg.nMateriais ?? 0;
  const nServicos = cfg.nServicos ?? 0;
  if (nMateriais < cfg.minMateriais) {
    falhas.push({
      gate: "fonte_insana",
      msg: `fonte com ${nMateriais} materiais (< mínimo ${cfg.minMateriais})`,
    });
  }
  if (nServicos < cfg.minServicos) {
    falhas.push({
      gate: "fonte_insana",
      msg: `fonte com ${nServicos} serviços (< mínimo ${cfg.minServicos})`,
    });
  }
  if (plano.totalD1 < cfg.minD1) {
    falhas.push({
      gate: "estado_invalido",
      msg:
        `D1 com ${plano.totalD1} itens (< mínimo ${cfg.minD1}) — parece que a ` +
        "carga inicial (runbook manual) não foi feita; o delta não substitui a carga.",
    });
  }
  if (plano.excluidos.length > cfg.maxExclusoes && !cfg.overrideExclusoes) {
    falhas.push({
      gate: "teto_exclusoes",
      msg:
        `${plano.excluidos.length} exclusões (> teto ${cfg.maxExclusoes}). ` +
        "Aprovação humana: re-rodar com DELTA_OVERRIDE_EXCLUSOES=true.",
    });
  }
  if (paraEmbed > cfg.maxEmbed && !cfg.overrideEmbed) {
    falhas.push({
      gate: "teto_embed",
      msg:
        `${paraEmbed} itens para (re)embed (> teto ${cfg.maxEmbed}). ` +
        "Aprovação humana: re-rodar com DELTA_OVERRIDE_EMBED=true.",
    });
  }
  return falhas;
}

const sqlStr = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const listaIds = (ids) => ids.map((id) => sqlStr(id)).join(",");

function* lotes(arr, n) {
  for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n);
}

// SQL do apply, num ÚNICO arquivo (uma transação do `d1 execute --file`):
// derruba triggers, remove alterados+excluídos das 3 tabelas em lotes IN(...)
// (1 scan da FTS por LOTE em vez de 1 por linha — catalogo_id é UNINDEXED),
// insere novos+alterados, repõe FTS/trgm só dos ids tocados e recria os
// triggers. Se qualquer statement falhar, o rollback devolve o banco INTEIRO
// ao estado anterior — triggers inclusive.
export function gerarDeltaSql(plano) {
  const upserts = [...plano.novos, ...plano.alteradosVetor, ...plano.alteradosData].sort(
    (a, b) => a.codigo - b.codigo,
  );
  const idsRemover = [
    ...plano.alteradosVetor.map((it) => it.id),
    ...plano.alteradosData.map((it) => it.id),
    ...plano.excluidos,
  ].sort();
  const idsUpsert = upserts.map((it) => it.id);

  const linhas = [
    "-- delta-d1.sql — GERADO por delta.mjs; não editar à mão.",
    `-- upserts: ${upserts.length} (novos ${plano.novos.length}, vetor ${plano.alteradosVetor.length}, so-data ${plano.alteradosData.length}) | exclusoes: ${plano.excluidos.length}`,
    "DROP TRIGGER IF EXISTS catalogo_itens_ai;",
    "DROP TRIGGER IF EXISTS catalogo_itens_ad;",
    "DROP TRIGGER IF EXISTS catalogo_itens_au;",
  ];

  const LOTE_IN = 200; // ids por IN(...): statement curto e 1 scan da FTS por lote
  for (const lote of lotes(idsRemover, LOTE_IN)) {
    const ids = listaIds(lote);
    linhas.push(`DELETE FROM catalogo_fts WHERE catalogo_id IN (${ids});`);
    linhas.push(`DELETE FROM catalogo_trgm WHERE catalogo_id IN (${ids});`);
    linhas.push(`DELETE FROM catalogo_itens WHERE id IN (${ids});`);
  }

  const LOTE_INSERT = 50; // acima disso o D1 estoura "statement too long"
  for (const lote of lotes(upserts, LOTE_INSERT)) {
    const values = lote
      .map(
        (it) =>
          `(${sqlStr(it.id)},${it.codigo},${sqlStr(norm(it.tipo))},${sqlStr(norm(it.descricao))},${sqlStr(norm(it.grupo))},${sqlStr(norm(it.classe))},${sqlStr(norm(it.pdm))},${sqlStr(norm(it.ncm))},${it.ativo ? 1 : 0},${sqlStr(norm(it.atualizado_em))})`,
      )
      .join(",");
    linhas.push(
      `INSERT INTO catalogo_itens (id,codigo,tipo,descricao,grupo,classe,pdm,ncm,ativo,atualizado_em) VALUES ${values};`,
    );
  }

  for (const lote of lotes(idsUpsert, LOTE_IN)) {
    const ids = listaIds(lote);
    linhas.push(
      `INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm) SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE id IN (${ids});`,
    );
    linhas.push(
      `INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao) SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE id IN (${ids});`,
    );
  }

  // Cópia exata dos triggers da 0007/rebuild-pos-carga.
  linhas.push(
    "CREATE TRIGGER catalogo_itens_ai AFTER INSERT ON catalogo_itens BEGIN\n" +
      "  INSERT INTO catalogo_fts (catalogo_id, codigo, tipo, grupo, classe, ncm, descricao, pdm)\n" +
      "    VALUES (new.id, new.codigo, new.tipo, new.grupo, new.classe, new.ncm, new.descricao, new.pdm);\n" +
      "  INSERT INTO catalogo_trgm (catalogo_id, codigo, tipo, descricao)\n" +
      "    VALUES (new.id, new.codigo, new.tipo, new.descricao);\n" +
      "END;",
    "CREATE TRIGGER catalogo_itens_ad AFTER DELETE ON catalogo_itens BEGIN\n" +
      "  DELETE FROM catalogo_fts WHERE catalogo_id = old.id;\n" +
      "  DELETE FROM catalogo_trgm WHERE catalogo_id = old.id;\n" +
      "END;",
    "CREATE TRIGGER catalogo_itens_au AFTER UPDATE ON catalogo_itens BEGIN\n" +
      "  DELETE FROM catalogo_fts WHERE catalogo_id = old.id;\n" +
      "  DELETE FROM catalogo_trgm WHERE catalogo_id = old.id;\n" +
      "  INSERT INTO catalogo_fts (catalogo_id, codigo, tipo, grupo, classe, ncm, descricao, pdm)\n" +
      "    VALUES (new.id, new.codigo, new.tipo, new.grupo, new.classe, new.ncm, new.descricao, new.pdm);\n" +
      "  INSERT INTO catalogo_trgm (catalogo_id, codigo, tipo, descricao)\n" +
      "    VALUES (new.id, new.codigo, new.tipo, new.descricao);\n" +
      "END;",
  );

  // Rematerializa as facetas de topo na MESMA transação do delta (Fase A) —
  // itens e facetas mudam juntos, consistência forte. sqlMaterializarFacetas()
  // é a mesma agregação do fast-path de leitura (paridade por construção).
  linhas.push(sqlMaterializarFacetas());

  return linhas.join("\n") + "\n";
}

/**
 * SQL que rebuilda catalogo_facetas a partir de catalogo_itens (Fase A).
 * Fonte única, reusada pelo delta e testável isoladamente. DELETE + reINSERT
 * dos 4 dims × 2 escopos; a leitura ordena/corta (aqui vai tudo).
 */
export function sqlMaterializarFacetas() {
  const dims = ["grupo", "classe", "pdm", "ncm"];
  const linhas = ["DELETE FROM catalogo_facetas;"];
  for (const d of dims) {
    linhas.push(
      `INSERT INTO catalogo_facetas (dim, escopo, valor, n) ` +
        `SELECT '${d}', 'active', ${d}, COUNT(*) FROM catalogo_itens ` +
        `WHERE ativo = 1 AND ${d} IS NOT NULL GROUP BY ${d};`,
    );
    linhas.push(
      `INSERT INTO catalogo_facetas (dim, escopo, valor, n) ` +
        `SELECT '${d}', 'all', ${d}, COUNT(*) FROM catalogo_itens ` +
        `WHERE ${d} IS NOT NULL GROUP BY ${d};`,
    );
  }
  return linhas.join("\n");
}

// Reconfere cada exclusão planejada na API oficial. Item que "sumiu" da fonte
// mas AINDA responde na consulta unitária = paginação inconsistente (o
// catálogo mudou no meio do fetch) — excluir seria destruir dado bom.
// Conferência que FALHA (429/5xx/timeout persistentes) não derruba o ciclo:
// o item vai em `naoConfirmados` e o chamador o MANTÉM no índice nesta
// rodada (só se exclui ausência confirmada; re-tenta no próximo ciclo).
// Antes, um único endpoint instável abortava o apply inteiro — o run
// 29578981347 (17/07/2026) morreu assim no cat-servico-24090.
export async function confirmarExclusoes(
  ids,
  { fetchImpl = fetch, pausaMs = 100, backoffMs = 1000 } = {},
) {
  const MAX_CONFERENCIAS = 3000; // acima disso a intenção já passou por override humano
  const MAX_FALHAS_SEGUIDAS = 5; // API unitária fora do ar: para de martelar
  const conferir = ids.slice(0, MAX_CONFERENCIAS);
  const aindaExistem = [];
  const naoConfirmados = [];
  let falhasSeguidas = 0;
  for (let i = 0; i < conferir.length; i++) {
    const id = conferir[i];
    const m = /^cat-(material|servico)-(\d+)$/.exec(id);
    if (!m) continue; // id fora do padrão nunca veio das fontes — deixa excluir
    const [, tipo, codigo] = m;
    const url =
      tipo === "material"
        ? `https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial?pagina=1&tamanhoPagina=10&codigoItem=${codigo}`
        : `https://dadosabertos.compras.gov.br/modulo-servico/6_consultarItemServico?pagina=1&tamanhoPagina=10&codigoServico=${codigo}`;
    let json = null;
    for (let tentativa = 1; tentativa <= 6; tentativa++) {
      let res = null;
      try {
        res = await fetchImpl(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        // timeout/erro de rede — mesmo tratamento do 5xx (retry abaixo)
      }
      if (res?.ok) {
        json = await res.json();
        break;
      }
      // 4xx firme (não-429): a consulta unitária não vai mudar de resposta —
      // inconfirmável, sem insistir.
      if (res && res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, backoffMs * 2 ** Math.min(tentativa - 1, 4)));
    }
    if (json === null) {
      naoConfirmados.push(id);
      falhasSeguidas += 1;
      if (falhasSeguidas >= MAX_FALHAS_SEGUIDAS) {
        // Indisponibilidade sistêmica: os restantes ficam sem conferência
        // (e portanto sem exclusão) nesta rodada.
        naoConfirmados.push(...conferir.slice(i + 1));
        break;
      }
    } else {
      falhasSeguidas = 0;
      if ((json.resultado ?? []).length > 0) aindaExistem.push(id);
    }
    if (pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
  }
  return { conferidos: conferir.length, aindaExistem, naoConfirmados };
}

export function gerarRelatorioMd(rel) {
  const g = rel.gates_reprovados;
  return [
    "## Delta do catálogo CATMAT/CATSER",
    "",
    `| | |`,
    `|---|---|`,
    `| Fonte (materiais / serviços) | ${rel.fonte.materiais} / ${rel.fonte.servicos} |`,
    `| D1 atual | ${rel.d1_atual} |`,
    `| Novos | ${rel.novos} |`,
    `| Alterados (re-embed) | ${rel.alterados_vetor} |`,
    `| Alterados (só data) | ${rel.alterados_data} |`,
    `| Excluídos | ${rel.excluidos} |`,
    `| Itens para (re)embed | ${rel.embed.itens} |`,
    `| Custo estimado do embed | ~US$ ${rel.embed.usd_estimado.toFixed(4)} (${rel.embed.tokens_estimados.toLocaleString("pt-BR")} tokens) |`,
    `| Itens esperados no D1 após apply | ${rel.itens_esperados_apos_apply} |`,
    "",
    g.length === 0
      ? "✅ Todos os gates passaram."
      : "🚫 **Gates reprovados:**\n" + g.map((f) => `- \`${f.gate}\`: ${f.msg}`).join("\n"),
    "",
  ].join("\n");
}

function flag(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : null;
}

// Aceita o JSON do `wrangler d1 execute --json` ([{results:[...]}]) por fatia.
export function lerLinhasD1(raw, arquivo = "?") {
  const json = JSON.parse(raw);
  const blocos = Array.isArray(json) ? json : [json];
  const linhas = [];
  for (const b of blocos) {
    if (b?.success === false) {
      throw new Error(`Fatia ${arquivo} veio com success=false do wrangler.`);
    }
    for (const r of b?.results ?? []) linhas.push(r);
  }
  return linhas;
}

async function main() {
  const FONTE = flag("--fonte") || "./out/itens.ndjson";
  const D1_DIR = flag("--d1") || "./out/d1-atual";
  const OUT = flag("--out") || "./out/delta";
  const IDS_ANTES = flag("--ids-antes") || `${dirname(FONTE)}/ids-antes.json`;
  const CONFIRMAR = process.argv.includes("--confirmar-exclusoes");

  const cfg = {
    minMateriais: parseInt(process.env.CATMAT_MIN_ITENS || "300000", 10),
    minServicos: parseInt(process.env.CATSER_MIN_ITENS || "2500", 10),
    minD1: parseInt(process.env.D1_MIN_ITENS || "250000", 10),
    maxEmbed: parseInt(process.env.DELTA_MAX_EMBED || "60000", 10),
    maxExclusoes: parseInt(process.env.DELTA_MAX_EXCLUSOES || "2000", 10),
    overrideEmbed: process.env.DELTA_OVERRIDE_EMBED === "true",
    overrideExclusoes: process.env.DELTA_OVERRIDE_EXCLUSOES === "true",
  };

  const fonteItens = readFileSync(FONTE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  cfg.nMateriais = fonteItens.filter((it) => it.tipo === "material").length;
  cfg.nServicos = fonteItens.filter((it) => it.tipo === "servico").length;

  const fatias = readdirSync(D1_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (fatias.length === 0) {
    console.error(`Nenhuma fatia .json em ${D1_DIR} — exporte o estado do D1 antes.`);
    process.exit(3);
  }
  const d1Rows = [];
  for (const f of fatias) {
    d1Rows.push(...lerLinhasD1(readFileSync(`${D1_DIR}/${f}`, "utf8"), f));
  }

  const plano = planejarDelta(fonteItens, d1Rows);
  const paraEmbed = [...plano.novos, ...plano.alteradosVetor].sort(
    (a, b) => a.codigo - b.codigo,
  );
  const custo = estimarCustoEmbed(paraEmbed);
  const falhas = avaliarGates(plano, cfg);

  const rel = {
    gerado_em: new Date().toISOString(),
    fonte: {
      total: fonteItens.length,
      materiais: cfg.nMateriais,
      servicos: cfg.nServicos,
    },
    d1_atual: plano.totalD1,
    novos: plano.novos.length,
    alterados_vetor: plano.alteradosVetor.length,
    alterados_data: plano.alteradosData.length,
    excluidos: plano.excluidos.length,
    embed: {
      itens: paraEmbed.length,
      chars: custo.chars,
      tokens_estimados: custo.tokens,
      usd_estimado: custo.usd,
      usd_por_mtoken: USD_POR_MTOKEN,
    },
    itens_esperados_apos_apply: plano.totalD1 + plano.novos.length - plano.excluidos.length,
    tem_mudancas:
      plano.novos.length +
        plano.alteradosVetor.length +
        plano.alteradosData.length +
        plano.excluidos.length >
      0,
    gates_reprovados: falhas,
    tetos: {
      max_embed: cfg.maxEmbed,
      max_exclusoes: cfg.maxExclusoes,
      override_embed: cfg.overrideEmbed,
      override_exclusoes: cfg.overrideExclusoes,
    },
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/relatorio.json`, JSON.stringify(rel, null, 2) + "\n", "utf8");
  writeFileSync(`${OUT}/relatorio.md`, gerarRelatorioMd(rel), "utf8");
  console.log(gerarRelatorioMd(rel));

  const fonteInsana = falhas.some(
    (f) => f.gate === "fonte_insana" || f.gate === "estado_invalido",
  );
  if (fonteInsana) process.exit(3);
  if (falhas.length > 0) process.exit(2);

  if (!rel.tem_mudancas) {
    console.log("Nada a fazer: fonte e D1 idênticos.");
    // Sem delta-d1.sql/itens.ndjson: o workflow pula o apply pelo relatorio.json.
    return;
  }

  if (CONFIRMAR && plano.excluidos.length > 0) {
    console.log(`Confirmando ${plano.excluidos.length} exclusões na API...`);
    const { conferidos, aindaExistem, naoConfirmados } = await confirmarExclusoes(
      plano.excluidos,
    );
    // A listagem do dadosabertos pagina sobre ordenação INSTÁVEL: as
    // fronteiras de página deslizam entre requests e ~130-230 itens somem do
    // fetch a cada rodada (conjunto DIFERENTE por rodada; páginas completas e
    // total batendo — runs 29578981347/29580173104/29581506510, 3 rodadas
    // 100% fantasma em cat-servico-*). "Re-rodar o fetch" nunca converge.
    // A consulta unitária é o oráculo: item confirmado VIVO sai do plano de
    // exclusão e permanece no índice — junto com os inconfirmáveis. Exclusão
    // só com ausência confirmada.
    const manter = new Set([...aindaExistem, ...naoConfirmados]);
    if (manter.size > 0) {
      // O relatório é regravado para o gate de contagem do workflow conferir
      // contra o que será aplicado de fato.
      plano.excluidos = plano.excluidos.filter((id) => !manter.has(id));
      rel.excluidos = plano.excluidos.length;
      rel.exclusoes_fantasma_mantidas = aindaExistem.length;
      rel.exclusoes_nao_confirmadas = naoConfirmados.length;
      rel.itens_esperados_apos_apply =
        plano.totalD1 + plano.novos.length - plano.excluidos.length;
      writeFileSync(`${OUT}/relatorio.json`, JSON.stringify(rel, null, 2) + "\n", "utf8");
      writeFileSync(`${OUT}/relatorio.md`, gerarRelatorioMd(rel), "utf8");
      if (aindaExistem.length > 0) {
        console.warn(
          `Aviso: ${aindaExistem.length}/${conferidos} "excluídos" ainda existem na API ` +
            `unitária (paginação instável da listagem; ex.: ${aindaExistem.slice(0, 5).join(", ")}) ` +
            "— mantidos no índice.",
        );
      }
      if (naoConfirmados.length > 0) {
        console.warn(
          `Aviso: ${naoConfirmados.length} exclusão(ões) sem confirmação (API unitária ` +
            `instável; ex.: ${naoConfirmados.slice(0, 5).join(", ")}) — mantidas no índice ` +
            "nesta rodada.",
        );
      }
    }
    console.log(
      `OK: ${conferidos} conferências; ${plano.excluidos.length} exclusões seguem no plano.`,
    );
  }

  writeFileSync(`${OUT}/delta-d1.sql`, gerarDeltaSql(plano), "utf8");
  writeFileSync(
    `${OUT}/itens.ndjson`,
    paraEmbed.map((it) => JSON.stringify(it)).join("\n") + (paraEmbed.length ? "\n" : ""),
    "utf8",
  );
  writeFileSync(
    `${OUT}/orfaos.json`,
    JSON.stringify(plano.excluidos, null, 2) + "\n",
    "utf8",
  );
  // Snapshot de IDs do D1 no formato texto que o limpar-orfaos.mjs aceita
  // (1 id por linha). Gravado ao lado da fonte: com OUT_DIR=<dir da fonte>,
  // o limpar-orfaos lê este snapshot + o itens.ndjson COMPLETO e chega no
  // mesmo conjunto de órfãos do plano.
  writeFileSync(
    IDS_ANTES,
    d1Rows.map((r) => r.id).join("\n") + (d1Rows.length ? "\n" : ""),
    "utf8",
  );

  console.log(
    `OK: plano gravado em ${OUT} (embed: ${paraEmbed.length} itens, ` +
      `~US$ ${custo.usd.toFixed(4)}; exclusões: ${plano.excluidos.length}).`,
  );
}

// Só roda o main quando executado diretamente (o delta.test.mjs importa as
// funções puras sem disparar IO).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
