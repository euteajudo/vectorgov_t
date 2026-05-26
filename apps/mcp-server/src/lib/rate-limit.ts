/**
 * Rate limiter por IP usando o KV `CACHE` como contador por janela de 1 minuto.
 *
 * Chave: `ratelimit:<ip>:<minuteWindow>` com TTL de 90s (margem segura
 * para o início da próxima janela).
 *
 * Estratégia: contador incremental simples. Aceita corrida (race condition)
 * leve em troca de não exigir Durable Object — adequado para o uso atual.
 * Caso a precisão precise ser exata, migrar para Durable Object com
 * `state.transaction()`.
 */

import type { Env } from "../env.js";
import { jsonResponse } from "./responses.js";

/**
 * Limite default de requisições por IP por minuto.
 */
const DEFAULT_LIMIT_PER_MINUTE = 60;

/**
 * TTL do registro KV — janela (60s) + folga.
 */
const RATE_LIMIT_TTL_SECONDS = 90;

/**
 * Extrai o IP do cliente. `CF-Connecting-IP` é setado pela Cloudflare;
 * fallback para `unknown` evita explodir em testes / cenários sem proxy.
 */
function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/**
 * Calcula a janela de minuto atual (segundo dividido por 60, inteiro).
 *
 * Usar minuto absoluto (não relativo à primeira requisição) evita drift
 * entre múltiplos Workers em datacenters distintos.
 */
function getCurrentMinuteWindow(): number {
  return Math.floor(Date.now() / 60_000);
}

/**
 * Verifica e aplica o rate limit.
 *
 * @returns `null` se a requisição é permitida; uma `Response 429` se o
 * limite foi excedido (com `Retry-After` em segundos).
 */
export async function enforceRateLimit(
  request: Request,
  env: Env,
  limit: number = DEFAULT_LIMIT_PER_MINUTE,
): Promise<Response | null> {
  // Preflight nunca é limitado — evita travar CORS legítimo.
  if (request.method === "OPTIONS") {
    return null;
  }

  const ip = getClientIp(request);
  const window = getCurrentMinuteWindow();
  const key = `ratelimit:${ip}:${window}`;

  const currentRaw = await env.CACHE.get(key);
  const current = currentRaw ? Number.parseInt(currentRaw, 10) : 0;

  if (Number.isFinite(current) && current >= limit) {
    // Calcula segundos até a próxima janela
    const secondsIntoMinute = Math.floor(Date.now() / 1000) % 60;
    const retryAfter = 60 - secondsIntoMinute;
    return jsonResponse(
      {
        error: "Too Many Requests",
        message: `Rate limit excedido: máx ${limit} requisições por minuto.`,
        retry_after_seconds: retryAfter,
      },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  const next = (Number.isFinite(current) ? current : 0) + 1;
  await env.CACHE.put(key, String(next), {
    expirationTtl: RATE_LIMIT_TTL_SECONDS,
  });

  return null;
}
