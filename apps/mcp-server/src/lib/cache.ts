/**
 * Wrapper tipado sobre o KV namespace `CACHE`.
 *
 * Todos os helpers convertem o valor armazenado para/de JSON e abstraem
 * a expiração via `expirationTtl`. Use TTL >= 60s (limite do Workers KV).
 */

import type { Env } from "../env.js";

/**
 * TTL mínimo aceito pelo Workers KV (em segundos).
 * Valores abaixo disto são automaticamente promovidos.
 */
const KV_MIN_TTL_SECONDS = 60;

/**
 * Lê um valor do KV e desserializa como JSON.
 *
 * Retorna `null` se a chave não existir OU se o JSON estiver corrompido —
 * em ambos os casos o chamador deve tratar como cache miss.
 */
export async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  try {
    const raw = await env.CACHE.get(key, "json");
    return (raw as T | null) ?? null;
  } catch {
    // valor corrompido — trata como miss
    return null;
  }
}

/**
 * Grava um valor no KV serializado como JSON.
 *
 * Se `ttlSeconds` for menor que `KV_MIN_TTL_SECONDS`, eleva para o mínimo
 * aceito (evita silenciosa rejeição do Workers KV).
 */
export async function cacheSet<T>(
  env: Env,
  key: string,
  value: T,
  ttlSeconds?: number,
): Promise<void> {
  const payload = JSON.stringify(value);
  const options: KVNamespacePutOptions = {};
  if (ttlSeconds !== undefined) {
    options.expirationTtl = Math.max(ttlSeconds, KV_MIN_TTL_SECONDS);
  }
  await env.CACHE.put(key, payload, options);
}

/**
 * Remove uma chave do KV. Idempotente (não erra se a chave não existir).
 */
export async function cacheDelete(env: Env, key: string): Promise<void> {
  await env.CACHE.delete(key);
}
