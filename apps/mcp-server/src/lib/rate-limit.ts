/**
 * Rate limiter por IP usando o KV `CACHE` como contador.
 *
 * Duas dimensões aplicadas em sequência (curto-circuito na 1ª violação):
 *   1. Janela curta — 60 req/min (proteção contra burst / DoS leve).
 *      Chave `ratelimit:<ip>:<minuteWindow>`, TTL 90s.
 *   2. Janela longa — 500 req/dia (quota proporcional a uso humano
 *      legítimo — vide `docs/arquitetura.md`).
 *      Chave `quota:<ip>:<dayWindow>`, TTL 26h.
 *
 * Estratégia: contadores incrementais simples. Aceita race condition
 * leve em troca de não exigir Durable Object — adequado para o uso atual.
 * Caso a precisão precise ser exata (ex.: cobrança por uso), migrar para
 * Durable Object com `state.transaction()`.
 *
 * Headers de resposta em 429:
 *   - `Retry-After`: segundos até a próxima janela (relativo à janela violada).
 *   - `X-RateLimit-Scope`: `minute` ou `day` (debug).
 */

import type { Env } from "../env.js";
import { jsonResponse } from "./responses.js";

/**
 * Limite default de requisições por IP por minuto.
 */
const DEFAULT_LIMIT_PER_MINUTE = 60;

/**
 * Limite default de requisições por IP por DIA (24h corrida).
 *
 * Vide `docs/arquitetura.md`: protege contra abuso sustentado e dimensiona
 * o budget de Workers AI / Gemini (custo de N análises × 500 IPs ainda
 * cabe em ~$X/mês — estimativa em hardening-notes.md).
 */
const DEFAULT_LIMIT_PER_DAY = 500;

/**
 * TTL do registro KV de janela curta — janela (60s) + folga.
 */
const RATE_LIMIT_TTL_SECONDS = 90;

/**
 * TTL do registro KV de janela diária — 26h cobre virada de dia + folga
 * para clientes em fusos horários distantes da UTC.
 */
const QUOTA_TTL_SECONDS = 26 * 60 * 60;

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
 * Calcula a janela de dia atual (UTC). Mesma lógica do minuto:
 * timestamp absoluto evita drift entre Workers.
 */
function getCurrentDayWindow(): number {
  return Math.floor(Date.now() / 86_400_000);
}

/**
 * Opções de override do rate-limit (úteis em testes e endpoints com
 * limites mais estritos no futuro).
 */
export interface RateLimitOptions {
  limitPerMinute?: number;
  limitPerDay?: number;
}

/**
 * Verifica e aplica o rate limit (janela de 1 min E quota diária).
 *
 * Ordem de checagem: minuto → dia. Se o de minuto não barrar mas o de
 * dia barrar, devolve 429 com scope="day" e Retry-After em segundos até
 * a virada do dia UTC.
 *
 * Incrementos: SEMPRE incrementa ambos os contadores quando a requisição
 * passa (não há corrida de "incrementou X mas deu 429 em Y" — checagem
 * vem antes do incremento, e ambos incrementam só ao final).
 *
 * @returns `null` se a requisição é permitida; uma `Response 429` se algum
 *          limite foi excedido (com `Retry-After` em segundos).
 */
export async function enforceRateLimit(
  request: Request,
  env: Env,
  opts: RateLimitOptions = {},
): Promise<Response | null> {
  const limitPerMinute = opts.limitPerMinute ?? DEFAULT_LIMIT_PER_MINUTE;
  const limitPerDay = opts.limitPerDay ?? DEFAULT_LIMIT_PER_DAY;

  // Preflight nunca é limitado — evita travar CORS legítimo.
  if (request.method === "OPTIONS") {
    return null;
  }

  const ip = getClientIp(request);
  const minuteWindow = getCurrentMinuteWindow();
  const dayWindow = getCurrentDayWindow();
  const minuteKey = `ratelimit:${ip}:${minuteWindow}`;
  const dayKey = `quota:${ip}:${dayWindow}`;

  // Lê ambos em paralelo — economiza 1 round-trip de KV (~10-20ms cold).
  const [minuteRaw, dayRaw] = await Promise.all([
    env.CACHE.get(minuteKey),
    env.CACHE.get(dayKey),
  ]);
  const minuteCount = minuteRaw ? Number.parseInt(minuteRaw, 10) : 0;
  const dayCount = dayRaw ? Number.parseInt(dayRaw, 10) : 0;

  // 1ª barreira: janela curta (burst protection).
  if (Number.isFinite(minuteCount) && minuteCount >= limitPerMinute) {
    const secondsIntoMinute = Math.floor(Date.now() / 1000) % 60;
    const retryAfter = 60 - secondsIntoMinute;
    return jsonResponse(
      {
        error: "Too Many Requests",
        message: `Rate limit excedido: máx ${limitPerMinute} requisições por minuto.`,
        retry_after_seconds: retryAfter,
        scope: "minute",
      },
      429,
      {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Scope": "minute",
      },
    );
  }

  // 2ª barreira: quota diária.
  if (Number.isFinite(dayCount) && dayCount >= limitPerDay) {
    const secondsIntoDay = Math.floor(Date.now() / 1000) % 86_400;
    const retryAfter = 86_400 - secondsIntoDay;
    return jsonResponse(
      {
        error: "Too Many Requests",
        message: `Quota diária excedida: máx ${limitPerDay} requisições por dia.`,
        retry_after_seconds: retryAfter,
        scope: "day",
      },
      429,
      {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Scope": "day",
      },
    );
  }

  // Incrementa ambos os contadores em paralelo.
  const nextMinute = (Number.isFinite(minuteCount) ? minuteCount : 0) + 1;
  const nextDay = (Number.isFinite(dayCount) ? dayCount : 0) + 1;
  await Promise.all([
    env.CACHE.put(minuteKey, String(nextMinute), {
      expirationTtl: RATE_LIMIT_TTL_SECONDS,
    }),
    env.CACHE.put(dayKey, String(nextDay), {
      expirationTtl: QUOTA_TTL_SECONDS,
    }),
  ]);

  return null;
}
