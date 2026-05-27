/**
 * Orchestrator do pipeline de ingestão.
 *
 * Fluxo completo (cada passo atualiza `IngestaoStatus` no KV):
 *
 *   1. parsing    → callContainerParse() devolve ParseResult.
 *   2. markdown   → para cada dispositivo: gera .md + upload R2.
 *   3. embedding  → embedBatch() em sub-batches de 100.
 *   4. vectorize  → upsert no índice em sub-batches de 100.
 *   5. d1         → DELETE prévio (idempotência) + INSERT normas /
 *                   dispositivos / versoes_dispositivos / dispositivos_fts
 *                   em batches via D1 `batch()`.
 *   6. indices    → upload `_meta.json`, `_sumario.json` e atualização
 *                   incremental do `_index.json` global.
 *   7. done       → finaliza com progresso 100%.
 *
 * Idempotência: re-ingestar uma norma já indexada substitui o conteúdo —
 * o DELETE prévio em D1 + Vectorize + R2 acontece ANTES do upsert para
 * garantir que não fiquem chunks órfãos com `versao` antiga.
 *
 * Tratamento de erro: qualquer exceção em qualquer fase chama
 * `markFailed()`, mas a Response HTTP do `POST /ingestao/iniciar`
 * pode ter retornado 202 antes — o caller monitora via
 * `GET /ingestao/status/:id`.
 *
 * Performance: alvo < 5min para LC 214 (165 páginas, ~600 dispositivos).
 * Gargalos esperados: parsing (Container) e embedding (Workers AI).
 * R2/Vectorize/D1 são paralelizáveis em batches.
 */

import type { Env } from "../env.js";
import type {
  DispositivoChunk,
  IngestaoFase,
  IngestaoStatus,
  ParseResult,
} from "@vectorgov-t/schemas";
import { embedBatch } from "../lib/batch-embedding.js";
import { withR2Retry } from "../lib/retry.js";
import { callContainerParse, type ParseInput } from "./container-client.js";
import {
  appendWarning,
  createStatus,
  markFailed,
  readStatus,
  updateStatus,
} from "./status-store.js";
import {
  dispositivoR2Key,
  indiceGlobalR2Key,
  normaMetaR2Key,
  normaSumarioR2Key,
  renderDispositivoMd,
} from "./markdown.js";
import { sumarioToEstruturaFile } from "./sumario.js";

/**
 * Tamanho dos sub-batches em todas as etapas que aceitam batch (embedding,
 * vectorize upsert, D1 INSERT, R2 upload concorrente).
 *
 * 100 é o teto seguro do Workers AI e suficiente para amortizar overhead
 * de rede sem estourar memória do isolate.
 */
const BATCH_SIZE = 100;

/**
 * Concorrência máxima de uploads R2 simultâneos.
 *
 * R2 aceita uploads em paralelo mas tem RATE LIMIT POR OBJETO interno
 * (erro 10058: "Reduce your concurrent request rate for the same object").
 * Esse limite não é documentado precisamente mas empiricamente se manifesta
 * acima de ~10 puts/s para o mesmo prefixo lógico.
 *
 * F5.1 (hardening): reduzido de 20 → 8 após falha na ingestão da LC 214
 * (4336 dispositivos) na fase markdown. Combinado com `withR2Retry` em
 * cada `put`, deixa o pipeline resiliente a picos transientes sem perder
 * o trabalho de parsing (218k tokens) já gasto.
 *
 * Trade-off de latência: ingestão da LC 214 sobe de ~3min (teórico) para
 * ~6-8min, mas confiabilidade salta drasticamente. EC 132 (376 disp) não
 * é afetada porque cabe em <50 batches.
 */
const R2_CONCURRENCY = 8;

/**
 * Helper para iterar uma lista em sub-batches.
 */
function chunked<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

/**
 * Executor pool simples — roda `n` promises em paralelo respeitando
 * o limite de concorrência.
 *
 * Reutilizado para uploads R2 (onde queremos paralelismo mas sem
 * estourar o limite de subrequests do Worker).
 */
async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function pullNext(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await worker(item, i);
    }
  }
  const runners: Promise<void>[] = [];
  const n = Math.max(1, Math.min(concurrency, items.length));
  for (let i = 0; i < n; i++) runners.push(pullNext());
  await Promise.all(runners);
  return results;
}

/**
 * Patch atômico de status que também avança o `progresso_pct` de forma
 * monotônica — não retrocede mesmo se o caller passar um valor menor.
 */
async function setFase(
  env: Env,
  id: string,
  fase: IngestaoFase,
  progressoPct: number,
  extra: Partial<IngestaoStatus> = {},
): Promise<void> {
  const current = await readStatus(env, id);
  const next = Math.max(current?.progresso_pct ?? 0, progressoPct);
  await updateStatus(env, id, { fase, progresso_pct: next, ...extra });
}

/**
 * Remove tudo relacionado a uma norma antes do upsert (idempotência).
 *
 * - D1: deleta normas + dispositivos + versoes_dispositivos + FTS5 via
 *   `batch()` para usar transação implícita.
 * - Vectorize: lista os IDs e remove em batches (não há "delete by prefix").
 * - R2: lista objetos com prefixo `<lei_id>/` e remove.
 *
 * Não falha se a norma não existir (idempotente em ambos sentidos).
 */
async function purgeNorma(env: Env, leiId: string): Promise<void> {
  // === D1 ===
  // Coleta IDs dos dispositivos para usar no DELETE da FTS5 (rowid match
  // implícito não funciona com texto). Tabela `dispositivos.id` é a chave.
  const dispositivosExistentes = await env.DB.prepare(
    "SELECT id FROM dispositivos WHERE norma_id = ?",
  )
    .bind(leiId)
    .all<{ id: string }>();
  const idsDispositivos = (dispositivosExistentes.results ?? []).map((r) => r.id);

  if (idsDispositivos.length > 0) {
    // Apaga em batch — D1 batch() roda como transação implícita.
    // FTS5 não tem FK, então deleta por norma_id (campo UNINDEXED).
    await env.DB.batch([
      env.DB.prepare("DELETE FROM versoes_dispositivos WHERE dispositivo_id IN (SELECT id FROM dispositivos WHERE norma_id = ?)").bind(leiId),
      env.DB.prepare("DELETE FROM dispositivos_fts WHERE norma_id = ?").bind(leiId),
      env.DB.prepare("DELETE FROM dispositivos WHERE norma_id = ?").bind(leiId),
      env.DB.prepare("DELETE FROM normas WHERE id = ?").bind(leiId),
    ]);

    // === Vectorize ===
    // `deleteByIds` aceita até 1000 por chamada.
    for (const batch of chunked(idsDispositivos, 1000)) {
      try {
        await env.VECTORIZE.deleteByIds(batch);
      } catch (err) {
        // Não fatal — chunks órfãos no Vectorize são "limpos" pelo upsert
        // (mesmo ID sobrescreve). Log para diagnóstico.
        console.warn(
          JSON.stringify({
            event: "vectorize_delete_warn",
            count: batch.length,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  } else {
    // Mesmo sem dispositivos, garante que a linha em `normas` suma
    // (caso tenha sido inserida sem children — não é esperado, mas
    // mantém idempotência).
    await env.DB.prepare("DELETE FROM normas WHERE id = ?").bind(leiId).run();
  }

  // === R2 ===
  // Lista paginada por prefixo e remove em batches.
  let cursor: string | undefined;
  do {
    const listed = await env.R2_LEIS.list({
      prefix: `${leiId}/`,
      limit: 1000,
      cursor,
    });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length > 0) {
      try {
        await env.R2_LEIS.delete(keys);
      } catch (err) {
        console.warn(
          JSON.stringify({
            event: "r2_delete_warn",
            count: keys.length,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/**
 * Faz upload do .md de cada dispositivo no R2 e devolve a lista
 * de chaves R2 na MESMA ordem dos dispositivos (importante: a ordem
 * é usada nos passos seguintes para casar com embeddings).
 */
async function uploadMarkdowns(
  env: Env,
  parse: ParseResult,
): Promise<string[]> {
  const keys: string[] = new Array(parse.dispositivos.length);

  await runWithConcurrency(parse.dispositivos, R2_CONCURRENCY, async (d, i) => {
    const key = dispositivoR2Key(parse.norma.id, d);
    const md = renderDispositivoMd(parse.norma, d);
    // `withR2Retry` cobre R2 10058 + erros de rede transientes; um único
    // .md falhando após 4 tentativas é fatal — o orchestrator marca
    // `failed` em vez de deixar buracos nos embeddings.
    await withR2Retry(
      () =>
        env.R2_LEIS.put(key, md, {
          httpMetadata: {
            contentType: "text/markdown; charset=utf-8",
          },
          customMetadata: {
            norma_id: parse.norma.id,
            dispositivo_id: d.id,
            tipo: d.tipo_dispositivo,
          },
        }),
      `uploadMarkdowns:${d.id}`,
    );
    keys[i] = key;
  });

  return keys;
}

/**
 * Faz upsert dos embeddings no Vectorize em sub-batches de 100.
 *
 * O `id` no Vectorize é o `dispositivo.id` — re-indexar com o mesmo ID
 * sobrescreve (parte da estratégia de idempotência).
 *
 * Metadata mínima necessária para filtros downstream (Track D):
 * `norma_id`, `tipo_dispositivo`, `artigo`, `r2_key`, `hierarquia`.
 */
async function upsertVectorize(
  env: Env,
  dispositivos: readonly DispositivoChunk[],
  embeddings: readonly Float32Array[],
  r2Keys: readonly string[],
): Promise<void> {
  if (dispositivos.length !== embeddings.length || dispositivos.length !== r2Keys.length) {
    throw new Error(
      `upsertVectorize: arrays desalinhados (disp=${dispositivos.length}, emb=${embeddings.length}, r2=${r2Keys.length})`,
    );
  }

  const vectors = dispositivos.map((d, i) => {
    const emb = embeddings[i];
    const key = r2Keys[i];
    if (emb === undefined || key === undefined) {
      throw new Error(`upsertVectorize: dispositivo ${d.id} sem embedding/key`);
    }
    const metadata: Record<string, VectorizeVectorMetadata> = {
      norma_id: d.norma_id,
      lei: d.norma_id,
      tipo_dispositivo: d.tipo_dispositivo,
      artigo: d.artigo ?? 0,
      r2_key: key,
      hierarquia: d.hierarquia_path,
      hierarquia_path: d.hierarquia_path,
      texto: d.texto.slice(0, 4000),
    };
    if (d.paragrafo) metadata.paragrafo = d.paragrafo;
    if (d.inciso) metadata.inciso = d.inciso;
    if (d.alinea) metadata.alinea = d.alinea;

    return {
      id: d.id,
      values: Array.from(emb),
      metadata,
    };
  });

  for (const batch of chunked(vectors, BATCH_SIZE)) {
    // Vectorize tem rate-limit similar ao R2 sob rajadas (limite não
    // documentado precisamente). `withR2Retry` cobre os mesmos casos
    // transientes; upsert é idempotente (mesmo ID sobrescreve) então
    // retentar é seguro.
    await withR2Retry(
      () => env.VECTORIZE.upsert(batch),
      `upsertVectorize:batch-${batch.length}`,
    );
  }
}

/**
 * Insere norma + dispositivos + versoes_dispositivos + FTS5 em D1.
 *
 * Usa `env.DB.batch([...])` para empacotar múltiplos prepared statements
 * em uma única transação implícita. Quebra em sub-batches para não
 * estourar o limite de statements por batch (D1 aceita 100).
 */
async function insertD1(
  env: Env,
  parse: ParseResult,
  r2Keys: readonly string[],
): Promise<void> {
  // 1. Norma (sempre 1 linha, fora do batch para garantir que aparece antes
  // dos FKs).
  await env.DB.prepare(
    "INSERT INTO normas (id, tipo, numero, ano, data_publicacao, ementa, status, r2_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      parse.norma.id,
      parse.norma.tipo,
      parse.norma.numero,
      parse.norma.ano,
      parse.norma.data_publicacao,
      parse.norma.ementa ?? "",
      parse.norma.status ?? "vigente",
      `${parse.norma.id}/`,
    )
    .run();

  // 2. Dispositivos + versoes + FTS5 em batches.
  // Cada dispositivo gera 3 statements (1 dispositivo + 1 versao + 1 fts) →
  // BATCH_SIZE/3 dispositivos por batch para ficar em ~100 statements.
  const dispBatchSize = Math.floor(BATCH_SIZE / 3);

  for (let i = 0; i < parse.dispositivos.length; i += dispBatchSize) {
    const chunk = parse.dispositivos.slice(i, i + dispBatchSize);
    const stmts: D1PreparedStatement[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const d = chunk[j];
      if (d === undefined) continue;
      const r2Key = r2Keys[i + j];
      if (r2Key === undefined) continue;

      stmts.push(
        env.DB.prepare(
          "INSERT INTO dispositivos (id, norma_id, artigo, paragrafo, inciso, alinea, hierarquia_path, tipo_dispositivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          d.id,
          d.norma_id,
          d.artigo ?? null,
          d.paragrafo ?? null,
          d.inciso ?? null,
          d.alinea ?? null,
          d.hierarquia_path,
          d.tipo_dispositivo,
        ),
        env.DB.prepare(
          "INSERT INTO versoes_dispositivos (dispositivo_id, data_inicio, data_fim, texto, norma_que_alterou, r2_path_versao) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(
          d.id,
          parse.norma.data_publicacao,
          null,
          d.texto,
          null,
          r2Key,
        ),
        env.DB.prepare(
          "INSERT INTO dispositivos_fts (dispositivo_id, norma_id, artigo, paragrafo, hierarquia, texto) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(
          d.id,
          d.norma_id,
          d.artigo ?? null,
          d.paragrafo ?? null,
          d.hierarquia_path,
          d.texto,
        ),
      );
    }

    if (stmts.length > 0) {
      await env.DB.batch(stmts);
    }
  }
}

/**
 * Atualiza o `_index.json` global (lista de normas indexadas).
 *
 * Lê o JSON existente (se houver), adiciona/atualiza a entry da norma
 * atual e grava de volta. Tolera ausência (primeira norma).
 */
async function updateIndiceGlobal(env: Env, parse: ParseResult): Promise<void> {
  const key = indiceGlobalR2Key();
  let indice: { normas: Array<Record<string, unknown>>; atualizado_em: string } = {
    normas: [],
    atualizado_em: new Date().toISOString(),
  };

  const existing = await env.R2_LEIS.get(key);
  if (existing !== null) {
    try {
      const parsed = (await existing.json()) as typeof indice;
      if (parsed && Array.isArray(parsed.normas)) {
        indice = parsed;
      }
    } catch {
      // Índice corrompido — recria do zero (perder histórico de listing
      // não é tão grave; a fonte da verdade é o D1).
    }
  }

  const entry = {
    norma_id: parse.norma.id,
    tipo: parse.norma.tipo,
    numero: parse.norma.numero,
    ano: parse.norma.ano,
    data_publicacao: parse.norma.data_publicacao,
    ementa: parse.norma.ementa ?? "",
    total_dispositivos: parse.dispositivos.length,
    r2_path: `${parse.norma.id}/`,
    indexado_em: new Date().toISOString(),
  };

  indice.normas = indice.normas
    .filter((n) => (n.norma_id ?? n.id) !== parse.norma.id)
    .concat(entry);
  indice.atualizado_em = new Date().toISOString();

  // _index.json é o objeto MAIS contendido do bucket (toda ingestão escreve
  // nele). É o caso clássico de R2 10058 quando duas normas ingerem em
  // paralelo — retry é obrigatório aqui.
  await withR2Retry(
    () =>
      env.R2_LEIS.put(key, JSON.stringify(indice, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      }),
    `updateIndiceGlobal`,
  );
}

/**
 * Faz upload do _sumario.json e _meta.json da norma.
 */
async function uploadNormaArtefatos(env: Env, parse: ParseResult): Promise<void> {
  const meta = {
    norma: parse.norma,
    total_dispositivos: parse.dispositivos.length,
    canonical_hash: parse.canonical_hash,
    pdf_hash: parse.pdf_hash,
    tokens_aproximados: parse.tokens_aproximados,
    indexado_em: new Date().toISOString(),
  };

  // Os 3 artefatos rodam em paralelo (chaves distintas, sem contenção
  // por objeto). Cada um tem retry transiente — falha de um único deles
  // ainda derruba a fase, mas o cenário típico (R2 10058 momentâneo) é
  // resolvido pela retentativa.
  await Promise.all([
    withR2Retry(
      () =>
        env.R2_LEIS.put(normaMetaR2Key(parse.norma.id), JSON.stringify(meta, null, 2), {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
        }),
      `uploadNormaArtefatos:meta`,
    ),
    withR2Retry(
      () =>
        env.R2_LEIS.put(
          normaSumarioR2Key(parse.norma.id),
          JSON.stringify(
            sumarioToEstruturaFile(parse.sumario ?? {}, parse.dispositivos.length),
            null,
            2,
          ),
          {
            httpMetadata: { contentType: "application/json; charset=utf-8" },
          },
        ),
      `uploadNormaArtefatos:sumario`,
    ),
    // Texto canônico completo — útil para offsets dos dispositivos.
    withR2Retry(
      () =>
        env.R2_LEIS.put(`${parse.norma.id}/_canonical.txt`, parse.canonical_text, {
          httpMetadata: { contentType: "text/plain; charset=utf-8" },
        }),
      `uploadNormaArtefatos:canonical`,
    ),
  ]);
}

/**
 * Executa o pipeline completo end-to-end.
 *
 * Os erros de qualquer fase são capturados e gravados no status como
 * `failed` — a função NÃO relança, porque tipicamente é executada via
 * `ctx.waitUntil()` após o Worker já ter respondido 202.
 */
export async function runIngestionPipeline(
  env: Env,
  params: {
    ingestaoId: string;
    pdf: Blob;
    pdfFilename: string;
    leiId: string;
    leiTipo: string;
    numero: string;
    ano: number;
    dataPublicacao: string;
  },
): Promise<void> {
  const { ingestaoId } = params;
  let currentFase: IngestaoFase = "pending";

  try {
    // === 1. Parsing ===
    currentFase = "parsing";
    await setFase(env, ingestaoId, "parsing", 5);
    const parseInput: ParseInput = {
      pdf: params.pdf,
      pdfFilename: params.pdfFilename,
      leiId: params.leiId,
      leiTipo: params.leiTipo,
      numero: params.numero,
      ano: params.ano,
      dataPublicacao: params.dataPublicacao,
    };
    const parse = await callContainerParse(env, parseInput);
    await updateStatus(env, ingestaoId, {
      total_dispositivos: parse.dispositivos.length,
      tokens_consumidos: parse.tokens_aproximados,
    });

    // Idempotência: purgar antes do upsert para não duplicar.
    await purgeNorma(env, params.leiId);

    if (parse.dispositivos.length === 0) {
      // Sem dispositivos não há o que fazer — marca done com warning.
      await appendWarning(env, ingestaoId, "parsing", "Parser não retornou nenhum dispositivo");
      await uploadNormaArtefatos(env, parse);
      await updateIndiceGlobal(env, parse);
      await setFase(env, ingestaoId, "done", 100, {
        finalizado_em: new Date().toISOString(),
      });
      return;
    }

    // === 2. Markdown + Upload R2 ===
    currentFase = "markdown";
    await setFase(env, ingestaoId, "markdown", 20);
    const r2Keys = await uploadMarkdowns(env, parse);

    // === 3. Embedding ===
    currentFase = "embedding";
    await setFase(env, ingestaoId, "embedding", 40);
    const textos = parse.dispositivos.map((d) => d.texto);
    const embeddings = await embedBatch(textos, env);
    await updateStatus(env, ingestaoId, {
      processados: embeddings.length,
    });

    // === 4. Vectorize ===
    currentFase = "vectorize";
    await setFase(env, ingestaoId, "vectorize", 70);
    await upsertVectorize(env, parse.dispositivos, embeddings, r2Keys);

    // === 5. D1 + FTS5 ===
    currentFase = "d1";
    await setFase(env, ingestaoId, "d1", 85);
    await insertD1(env, parse, r2Keys);

    // === 6. Indices ===
    currentFase = "indices";
    await setFase(env, ingestaoId, "indices", 95);
    await uploadNormaArtefatos(env, parse);
    await updateIndiceGlobal(env, parse);

    // === 7. Done ===
    await setFase(env, ingestaoId, "done", 100, {
      finalizado_em: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        event: "pipeline_failed",
        ingestao_id: ingestaoId,
        fase: currentFase,
        error: msg,
      }),
    );
    await markFailed(env, ingestaoId, currentFase, msg);
  }
}

/**
 * Gera um ID único para a ingestão.
 *
 * Usa `crypto.randomUUID()` disponível no runtime do Workers. Formato
 * UUID v4 — 36 chars seguros para usar em URLs.
 */
export function newIngestaoId(): string {
  return crypto.randomUUID();
}

// Exports auxiliares (úteis para testes unitários).
export const __internal = {
  chunked,
  runWithConcurrency,
  purgeNorma,
  uploadMarkdowns,
  upsertVectorize,
  insertD1,
  updateIndiceGlobal,
  uploadNormaArtefatos,
};

// Re-export para o roteador
export { createStatus, readStatus };
