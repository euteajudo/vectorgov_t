// ETL embed — itens.ndjson -> vectors-NNN.ndjson (bge-m3 via Workers AI REST).
//
// GATED: consome Workers AI (paga neurons) e exige credenciais. Resumível e
// à prova de crash: na retomada, o último arquivo-lote é revalidado linha a
// linha (uma linha truncada por queda no meio do write é descartada) e a
// geração continua de onde parou.
//
// A saída é PARTICIONADA em arquivos de até VECTORS_PER_FILE vetores porque o
// `wrangler vectorize upsert` trava por volta de ~100k vetores num arquivo
// único — e reexecutar recomeçava do zero. Lotes de 40k passam com folga.
// Usar `upsert` (NÃO `insert`): insert preserva IDs existentes e portanto NÃO
// atualiza embeddings nem metadata numa recarga.
//
// Uso:
//   CF_ACCOUNT_ID=a89dbdb0...   CF_API_TOKEN=...   OUT_DIR=./out   node embed.mjs
//
// Carga (um upsert por arquivo, na ordem):
//   for f in ./out/vectors-*.ndjson; do
//     wrangler vectorize upsert catmat-catser --file "$f"
//   done
//   wrangler vectorize info catmat-catser   # conferir vectorCount == total
import {
  readFileSync,
  writeFileSync,
  createWriteStream,
  createReadStream,
  readdirSync,
  existsSync,
  renameSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const OUT = process.env.OUT_DIR || "./out";
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const MODEL = "@cf/baai/bge-m3";
const BATCH = 100;
const META_DESC_MAX = 400;
const VECTORS_PER_FILE = 40_000;

if (!ACCOUNT || !TOKEN) {
  console.error("Defina CF_ACCOUNT_ID e CF_API_TOKEN.");
  process.exit(1);
}

const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`;

// Shards de 40k vetores passam de 700MB e o limite de string do Node é
// ~512MB — nenhuma leitura de shard pode usar readFileSync. Foi exatamente
// esse ERR_STRING_TOO_LONG que derrubou a geração de 16/07/2026 com todos
// os vetores prontos, e o crash sem flush perdeu a cauda do write stream.

function hashArquivo(caminho) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(caminho)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

async function contarLinhas(caminho) {
  let n = 0;
  const rl = createInterface({ input: createReadStream(caminho, "utf8"), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) n += 1;
  return n;
}

// Valida o último shard linha a linha; linha truncada (crash no meio do
// write) é descartada regravando só as íntegras num temporário. Retorna a
// contagem de válidas e o id do último vetor íntegro.
async function sanearUltimoShard(caminho) {
  const tmp = `${caminho}.tmp`;
  const w = createWriteStream(tmp, { encoding: "utf8" });
  let validas = 0;
  let truncadas = 0;
  let ultimoId = null;
  const rl = createInterface({ input: createReadStream(caminho, "utf8"), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l.trim()) continue;
    try {
      ultimoId = JSON.parse(l).id;
    } catch {
      truncadas += 1;
      continue;
    }
    validas += 1;
    if (!w.write(l + "\n")) await new Promise((r) => w.once("drain", r));
  }
  await new Promise((res, rej) => w.end((e) => (e ? rej(e) : res())));
  if (truncadas > 0) {
    console.warn(`Descartando ${truncadas} linha(s) truncada(s) de ${caminho}.`);
    renameSync(tmp, caminho);
  } else {
    rmSync(tmp);
  }
  return { validas, ultimoId };
}

const hashFonte = await hashArquivo(`${OUT}/itens.ndjson`);
const itens = [];
{
  const rl = createInterface({
    input: createReadStream(`${OUT}/itens.ndjson`, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const l of rl) if (l.trim()) itens.push(JSON.parse(l));
}

const nomeArquivo = (n) => `${OUT}/vectors-${String(n).padStart(3, "0")}.ndjson`;

// Retomada: conta os vetores já gerados nos arquivos-lote existentes. Só o
// ÚLTIMO arquivo pode estar incompleto/corrompido (crash no meio do write):
// revalida cada linha como JSON e regrava mantendo apenas as íntegras — a
// contagem por linhas volta a ser confiável e a retomada nunca pula nem
// duplica itens.
const existentes = readdirSync(OUT)
  .filter((f) => /^vectors-\d{3}\.ndjson$/.test(f))
  .sort();
let jaFeitos = 0;
let ultimoIdGerado = null;
for (let k = 0; k < existentes.length; k++) {
  const caminho = `${OUT}/${existentes[k]}`;
  if (k === existentes.length - 1) {
    const { validas, ultimoId } = await sanearUltimoShard(caminho);
    jaFeitos += validas;
    ultimoIdGerado = ultimoId;
  } else {
    jaFeitos += await contarLinhas(caminho);
  }
}
// A retomada por posição só é válida se os shards vieram DESTA fonte — um
// itens.ndjson diferente (item novo, ordem nova) faria a contagem "bater" e
// a recarga virar no-op silencioso preservando vetores da versão anterior.
// O manifest amarra os shards ao sha256 da fonte; a checagem posicional pega
// drift residual. Divergiu: abortamos com instrução, nunca descartamos os
// shards sozinhos (eles custaram embedding pago).
const MANIFEST = `${OUT}/embed-manifest.json`;
if (existentes.length > 0) {
  if (!existsSync(MANIFEST)) {
    console.error(
      `Shards vectors-*.ndjson existem em ${OUT} mas não há ${MANIFEST}.\n` +
        "Origem desconhecida — apague os vectors-*.ndjson para reembeddar do zero, " +
        "ou restaure o manifest da geração original.",
    );
    process.exit(1);
  }
  const man = JSON.parse(readFileSync(MANIFEST, "utf8"));
  if (man.hashFonte !== hashFonte) {
    console.error(
      "itens.ndjson MUDOU desde a geração dos shards existentes.\n" +
        `  manifest: ${man.hashFonte}\n  fonte:    ${hashFonte}\n` +
        "Apague os vectors-*.ndjson + embed-manifest.json para reembeddar a fonte " +
        "nova do zero, ou restaure o itens.ndjson original para só retomar.",
    );
    process.exit(1);
  }
} else {
  writeFileSync(
    MANIFEST,
    JSON.stringify({ hashFonte, total: itens.length }, null, 2) + "\n",
    "utf8",
  );
}
if (jaFeitos > 0) {
  const ultimoId = ultimoIdGerado;
  const esperado = itens[jaFeitos - 1]?.id;
  if (ultimoId !== esperado) {
    console.error(
      `Shard desalinhado da fonte: último vetor é ${ultimoId}, mas a posição ` +
        `${jaFeitos} do itens.ndjson é ${esperado}. Fonte reordenada? ` +
        "Apague os shards + manifest para reembeddar do zero.",
    );
    process.exit(1);
  }
}
if (jaFeitos > 0) console.log(`Retomando: ${jaFeitos} vetores já gerados.`);

// Continua escrevendo no arquivo correspondente à posição atual.
let arquivoIdx = Math.floor(jaFeitos / VECTORS_PER_FILE);
let linhasNoArquivo = jaFeitos % VECTORS_PER_FILE;
let out = createWriteStream(nomeArquivo(arquivoIdx), {
  flags: "a",
  encoding: "utf8",
});

function escreverVetor(linha) {
  if (linhasNoArquivo >= VECTORS_PER_FILE) {
    out.end();
    arquivoIdx += 1;
    linhasNoArquivo = 0;
    out = createWriteStream(nomeArquivo(arquivoIdx), {
      flags: "a",
      encoding: "utf8",
    });
  }
  out.write(linha);
  linhasNoArquivo += 1;
}

async function embedBatch(textos, tentativa = 1) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: textos }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    if ((res.status === 429 || res.status >= 500) && tentativa <= 4) {
      const espera = 1000 * 2 ** (tentativa - 1);
      console.warn(`  ${res.status} — retry em ${espera}ms`);
      await new Promise((r) => setTimeout(r, espera));
      return embedBatch(textos, tentativa + 1);
    }
    throw new Error(`Workers AI ${res.status}: ${body}`);
  }
  const json = await res.json();
  const data = json?.result?.data;
  if (!Array.isArray(data) || data.length !== textos.length) {
    throw new Error(`Resposta inesperada (esperava ${textos.length} vetores)`);
  }
  return data;
}

const total = itens.length;
for (let i = jaFeitos; i < total; i += BATCH) {
  const lote = itens.slice(i, i + BATCH);
  const vetores = await embedBatch(lote.map((it) => it.texto_embed));
  for (let j = 0; j < lote.length; j++) {
    const it = lote[j];
    escreverVetor(
      JSON.stringify({
        id: it.id,
        values: vetores[j],
        metadata: {
          codigo: it.codigo,
          tipo: it.tipo,
          grupo: it.grupo ?? "",
          classe: it.classe ?? "",
          descricao: String(it.descricao).slice(0, META_DESC_MAX),
          // pdm/ativo/ncm: o motor le meta.pdm (doc do rerank), meta.ativo e
          // meta.ncm em hits que so vieram da lane semantica — sem eles, item
          // inativo recuperado via vetor sairia como ativo no response.
          pdm: String(it.pdm ?? "").slice(0, 120),
          ativo: it.ativo === 0 ? 0 : 1,
          ncm: it.ncm ?? "",
        },
      }) + "\n",
    );
  }
  if (i % 2000 === 0) console.log(`  ${Math.min(i + BATCH, total)}/${total}`);
}
// Aguarda o flush REAL — out.end() sem await perdeu as 14 últimas linhas
// quando o processo morreu logo em seguida (16/07/2026).
await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));

const arquivos = readdirSync(OUT)
  .filter((f) => /^vectors-\d{3}\.ndjson$/.test(f))
  .sort();
console.log(`OK: ${total} vetores em ${arquivos.length} arquivo(s):`);
for (const f of arquivos) {
  console.log(`  ${f}: ${await contarLinhas(`${OUT}/${f}`)}`);
}
console.log(
  `Carga: for f in ${OUT}/vectors-*.ndjson; do wrangler vectorize upsert catmat-catser --file "$f"; done`,
);
console.log(
  `Validar: wrangler vectorize info catmat-catser  (vectorCount deve chegar a ${total}; a contagem atualiza com atraso)`,
);
