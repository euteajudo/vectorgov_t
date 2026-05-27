/**
 * Wrapper em cima do KV `CACHE` para persistir e ler o status de uma ingestão.
 *
 * Optamos por KV (e não Durable Object) porque:
 *  - Cada registro de status é pequeno (< 4KB) e a precisão de leitura
 *    eventualmente-consistente é aceitável (UI faz polling).
 *  - O orchestrator roda dentro de um único invocation do Worker, então
 *    não precisamos de coordenação multi-instância para escrita.
 *  - Migrar para DO depois é trivial se passarmos a precisar de
 *    transações fortes ou WebSocket push.
 *
 * TTL fixo de 24h: tempo suficiente para a UI consultar o resultado e o
 * humano debugar. Histórico permanente fica em D1 (`audit_log` futuro).
 */

import { IngestaoStatusSchema, type IngestaoStatus, type IngestaoFase } from "@vectorgov-t/schemas";
import type { Env } from "../env.js";

/**
 * Prefixo das chaves no KV. Versionar (`v1:`) facilita future-proofing
 * caso o schema do status mude de forma incompatível.
 */
const KEY_PREFIX = "ingestao:status:v1:";

/**
 * TTL em segundos (24h) — registros antigos somem automaticamente.
 */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Gera a chave KV para um dado `ingestaoId`.
 */
function key(ingestaoId: string): string {
  return `${KEY_PREFIX}${ingestaoId}`;
}

/**
 * Timestamp ISO atual — extraído como função para facilitar testes
 * (vi.useFakeTimers cobre o `Date.now()` por baixo).
 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Cria um novo registro de status no estado `pending`.
 *
 * Retorna o registro criado (não busca do KV de novo — economiza round-trip).
 */
export async function createStatus(
  env: Env,
  params: { id: string; leiId: string },
): Promise<IngestaoStatus> {
  const now = nowIso();
  const status: IngestaoStatus = {
    id: params.id,
    lei_id: params.leiId,
    fase: "pending",
    progresso_pct: 0,
    total_dispositivos: 0,
    processados: 0,
    tokens_consumidos: 0,
    erros: [],
    iniciado_em: now,
    atualizado_em: now,
    finalizado_em: null,
  };
  await env.CACHE.put(key(params.id), JSON.stringify(status), {
    expirationTtl: TTL_SECONDS,
  });
  return status;
}

/**
 * Atualiza o registro de status — patch parcial, persiste de volta no KV.
 *
 * IMPORTANTE: como KV é eventually consistent, dois `updateStatus`
 * concorrentes podem perder updates. No fluxo atual, todas as atualizações
 * vêm do mesmo Worker invocation em sequência, então não há corrida.
 */
export async function updateStatus(
  env: Env,
  id: string,
  patch: Partial<Omit<IngestaoStatus, "id" | "iniciado_em">>,
): Promise<IngestaoStatus | null> {
  const existing = await readStatus(env, id);
  if (existing === null) return null;
  const next: IngestaoStatus = {
    ...existing,
    ...patch,
    atualizado_em: nowIso(),
  };
  await env.CACHE.put(key(id), JSON.stringify(next), {
    expirationTtl: TTL_SECONDS,
  });
  return next;
}

/**
 * Lê o registro do KV e valida via Zod.
 *
 * Retorna `null` em qualquer cenário "não encontrado" ou JSON corrompido —
 * o caller deve traduzir para 404.
 */
export async function readStatus(
  env: Env,
  id: string,
): Promise<IngestaoStatus | null> {
  const raw = await env.CACHE.get(key(id), "json");
  if (raw === null || raw === undefined) return null;
  const parsed = IngestaoStatusSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      JSON.stringify({
        event: "status_corrompido",
        id,
        issues: parsed.error.issues.slice(0, 3),
      }),
    );
    return null;
  }
  return parsed.data;
}

/**
 * Helper para registrar um erro não fatal (warning) sem mudar a fase.
 *
 * Use quando uma sub-etapa falhou mas o orchestrator pode prosseguir
 * (ex.: upload de um único .md falhou mas embeddings dos demais foram ok).
 */
export async function appendWarning(
  env: Env,
  id: string,
  fase: IngestaoFase,
  mensagem: string,
): Promise<void> {
  const existing = await readStatus(env, id);
  if (existing === null) return;
  const erros = [
    ...existing.erros,
    { fase, mensagem, timestamp: nowIso() },
  ];
  await updateStatus(env, id, { erros });
}

/**
 * Marca a ingestão como falha terminal — define `fase = failed` e
 * acumula a mensagem em `erros[]` para diagnóstico.
 */
export async function markFailed(
  env: Env,
  id: string,
  faseAtual: IngestaoFase,
  mensagem: string,
): Promise<void> {
  const existing = await readStatus(env, id);
  const erros = [
    ...(existing?.erros ?? []),
    { fase: faseAtual, mensagem, timestamp: nowIso() },
  ];
  await updateStatus(env, id, {
    fase: "failed",
    erros,
    finalizado_em: nowIso(),
  });
}
