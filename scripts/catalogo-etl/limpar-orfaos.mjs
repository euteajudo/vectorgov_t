// Limpeza de vetores órfãos no Vectorize após uma recarga por upsert.
//
// O upsert cria/sobrescreve IDs, mas NUNCA remove os ausentes da fonte nova —
// itens excluídos do catálogo ficariam como vetores órfãos, entrando no RRF e
// saindo no payload com metadata velha. (O motor tem defesa em query-time —
// confirma hits vector-only no D1 — mas órfão acumulado é custo de índice e
// ruído de recall; limpar na recarga é a higiene correta.)
//
// Diff: IDs exportados do D1 ANTES do reset  −  IDs do itens.ndjson novo.
// Os órfãos são removidos via REST delete_by_ids, em lotes com retry.
//
// Uso:
//   1. ANTES do reset-pre-carga.sql:
//      wrangler d1 execute catmat-catser-db --remote --json \
//        --command "SELECT id FROM catalogo_itens" > out/ids-antes.json
//   2. Depois do upsert dos vectors-*.ndjson:
//      CF_ACCOUNT_ID=... CF_API_TOKEN=... OUT_DIR=./out node limpar-orfaos.mjs
//
// Alternativa para reset absoluto (índice possivelmente inconsistente): criar
// um índice novo versionado (catmat-catser-v2), carregar, trocar o binding e
// apagar o antigo — ver README.
import { readFileSync, existsSync } from "node:fs";

const OUT = process.env.OUT_DIR || "./out";
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const INDEX = process.env.VECTORIZE_INDEX || "catmat-catser";
const LOTE = 200;

if (!ACCOUNT || !TOKEN) {
  console.error("Defina CF_ACCOUNT_ID e CF_API_TOKEN.");
  process.exit(1);
}

const antesPath = `${OUT}/ids-antes.json`;
if (!existsSync(antesPath)) {
  console.error(
    `${antesPath} não existe. Exporte os IDs ANTES do reset:\n` +
      `  wrangler d1 execute catmat-catser-db --remote --json --command "SELECT id FROM catalogo_itens" > ${antesPath}\n` +
      "Sem esse snapshot não há como saber quais IDs sumiram da fonte.",
  );
  process.exit(1);
}

// Aceita o JSON do `wrangler d1 execute --json` ([{results:[{id}]}]) ou
// texto puro com um id por linha (snapshot manual).
function lerIdsAntes(raw) {
  try {
    const json = JSON.parse(raw);
    const blocos = Array.isArray(json) ? json : [json];
    const ids = [];
    for (const b of blocos) {
      for (const r of b?.results ?? []) {
        if (typeof r?.id === "string") ids.push(r.id);
      }
    }
    if (ids.length > 0) return ids;
  } catch {
    // não era JSON — cai para o formato texto
  }
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^cat-(material|servico)-\d+$/.test(l));
}

const antes = new Set(lerIdsAntes(readFileSync(antesPath, "utf8")));
const atuais = new Set(
  readFileSync(`${OUT}/itens.ndjson`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l).id),
);
const orfaos = [...antes].filter((id) => !atuais.has(id));

console.log(
  `IDs antes: ${antes.size} | fonte nova: ${atuais.size} | órfãos a remover: ${orfaos.length}`,
);
if (orfaos.length === 0) {
  console.log("Nada a remover.");
  process.exit(0);
}

const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/vectorize/v2/indexes/${INDEX}/delete_by_ids`;

async function deletarLote(ids, tentativa = 1) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    if ((res.status === 429 || res.status >= 500) && tentativa <= 4) {
      const espera = 1000 * 2 ** (tentativa - 1);
      console.warn(`  ${res.status} — retry em ${espera}ms`);
      await new Promise((r) => setTimeout(r, espera));
      return deletarLote(ids, tentativa + 1);
    }
    throw new Error(`Vectorize delete_by_ids ${res.status}: ${body}`);
  }
}

for (let i = 0; i < orfaos.length; i += LOTE) {
  await deletarLote(orfaos.slice(i, i + LOTE));
  console.log(`  removidos ${Math.min(i + LOTE, orfaos.length)}/${orfaos.length}`);
}
console.log(
  `OK: ${orfaos.length} vetores órfãos removidos de ${INDEX}. ` +
    "(A mutação do Vectorize é assíncrona — o vectorCount do `info` converge em alguns minutos.)",
);
