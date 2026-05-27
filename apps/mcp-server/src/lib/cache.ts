/**
 * Wrapper tipado sobre o KV namespace `CACHE`.
 *
 * Todos os helpers convertem o valor armazenado para/de JSON e abstraem
 * a expiração via `expirationTtl`. Use TTL >= 60s (limite do Workers KV).
 *
 * Convenções de chave (F5.1):
 *   - Prefixo do domínio (`skill:`, `ratelimit:`, `peticao:`, etc.).
 *   - Sufixo `:vN` quando o schema do payload pode evoluir de forma
 *     incompatível (ex.: `ingestao:status:v1:`). Isso EVITA ler payload
 *     incompatível após deploy de schema novo — o KV antigo simplesmente
 *     fica órfão até expirar.
 *
 * TTL recomendado por categoria (vide docs/arquitetura.md):
 *   - Resultados estáveis (índice de leis, _meta de skills): 6-24h.
 *   - Resultados voláteis (skill ativa individual, A/B test): 60s.
 *   - Status de processamento (ingestão, petição): 24h.
 *   - Rate limit (janela de 1 minuto): 90s.
 *
 * Quando o caller esquece o TTL: o KV não expira (vive para sempre).
 * Aceito proposital para alguns casos (idx global), mas a maioria das
 * chamadas DEVE passar TTL explícito.
 */

import type { Env } from "../env.js";

/**
 * TTL mínimo aceito pelo Workers KV (em segundos).
 * Valores abaixo disto são automaticamente promovidos.
 */
const KV_MIN_TTL_SECONDS = 60;

/**
 * TTL máximo razoável (24h) — corresponde ao alvo declarado em
 * `docs/arquitetura.md`. Helper `cacheSetWithDefaultTtl` usa esse valor
 * quando o caller não especifica. Não é um clamp duro — `cacheSet`
 * aceita valores maiores se necessário (ex.: chaves de configuração
 * que vivem por dias).
 */
export const CACHE_DEFAULT_TTL_SECONDS = 24 * 60 * 60;

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

/**
 * Variante de `cacheSet` que aplica `CACHE_DEFAULT_TTL_SECONDS` (24h)
 * quando o TTL não é especificado. Use para resultados estáveis em que
 * não há razão para definir um TTL menor.
 *
 * Para resultados voláteis (skills A/B-tested, status de processamento),
 * continue usando `cacheSet(env, key, value, ttlEspecifico)`.
 */
export async function cacheSetWithDefaultTtl<T>(
  env: Env,
  key: string,
  value: T,
): Promise<void> {
  return cacheSet(env, key, value, CACHE_DEFAULT_TTL_SECONDS);
}
