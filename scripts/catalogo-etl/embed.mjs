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
  readdirSync,
} from "node:fs";

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

const itens = readFileSync(`${OUT}/itens.ndjson`, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

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
for (let k = 0; k < existentes.length; k++) {
  const caminho = `${OUT}/${existentes[k]}`;
  const linhas = readFileSync(caminho, "utf8").split("\n").filter(Boolean);
  if (k === existentes.length - 1) {
    const validas = linhas.filter((l) => {
      try {
        JSON.parse(l);
        return true;
      } catch {
        return false;
      }
    });
    if (validas.length !== linhas.length) {
      console.warn(
        `Descartando ${linhas.length - validas.length} linha(s) truncada(s) de ${existentes[k]}.`,
      );
      writeFileSync(caminho, validas.map((l) => l + "\n").join(""), "utf8");
    }
    jaFeitos += validas.length;
  } else {
    jaFeitos += linhas.length;
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
out.end();

const arquivos = readdirSync(OUT)
  .filter((f) => /^vectors-\d{3}\.ndjson$/.test(f))
  .sort();
console.log(`OK: ${total} vetores em ${arquivos.length} arquivo(s):`);
for (const f of arquivos) {
  const n = readFileSync(`${OUT}/${f}`, "utf8").split("\n").filter(Boolean).length;
  console.log(`  ${f}: ${n}`);
}
console.log(
  `Carga: for f in ${OUT}/vectors-*.ndjson; do wrangler vectorize upsert catmat-catser --file "$f"; done`,
);
console.log(
  `Validar: wrangler vectorize info catmat-catser  (vectorCount deve chegar a ${total}; a contagem atualiza com atraso)`,
);
