// ETL embed — itens.ndjson -> vectors.ndjson (bge-m3 via Workers AI REST).
//
// GATED: consome Workers AI (paga neurons) e exige credenciais. Resumível —
// relê quantos vetores já existem em vectors.ndjson e continua de onde parou.
//
// Uso:
//   CF_ACCOUNT_ID=a89dbdb0...   CF_API_TOKEN=...   OUT_DIR=./out   node embed.mjs
//
// Saída (NDJSON pronto para `wrangler vectorize insert`):
//   { "id": "cat-material-269894", "values": [...1024], "metadata": {...} }
import { readFileSync, createWriteStream, existsSync, readFileSync as rf } from "node:fs";

const OUT = process.env.OUT_DIR || "./out";
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const MODEL = "@cf/baai/bge-m3";
const BATCH = 100;
const META_DESC_MAX = 400;

if (!ACCOUNT || !TOKEN) {
  console.error("Defina CF_ACCOUNT_ID e CF_API_TOKEN.");
  process.exit(1);
}

const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`;

const itens = readFileSync(`${OUT}/itens.ndjson`, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

// Resume: pula os que já foram embedados.
let jaFeitos = 0;
if (existsSync(`${OUT}/vectors.ndjson`)) {
  jaFeitos = rf(`${OUT}/vectors.ndjson`, "utf8").split("\n").filter(Boolean).length;
  console.log(`Retomando: ${jaFeitos} vetores já gerados.`);
}

const out = createWriteStream(`${OUT}/vectors.ndjson`, { flags: "a", encoding: "utf8" });

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
    out.write(
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
console.log(`OK: ${total} vetores em ${OUT}/vectors.ndjson`);
