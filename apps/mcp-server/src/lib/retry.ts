/**
 * Retry helpers para operações com bindings Cloudflare (R2, Vectorize).
 *
 * Motivação F5.1 (hardening): a ingestão da LC 214 (4336 dispositivos)
 * falhou na fase markdown com R2 10058 ("Reduce your concurrent request
 * rate for the same object"). A causa real é uma combinação de:
 *
 *   1. Concorrência alta nos uploads (R2_CONCURRENCY=20 → reduzido para 8).
 *   2. Ausência de retry transiente — qualquer 10058 derrubava o pipeline
 *      inteiro, descartando 218k tokens já gastos no parsing.
 *
 * Estratégia adotada:
 *   - Backoff exponencial: 500ms × 2^n  + jitter aleatório [0, 200ms].
 *   - Até 4 tentativas totais (1 original + 3 retries).
 *   - Retentar APENAS em erros que se sabe transientes:
 *       * R2 10058 ("concurrent request rate").
 *       * Erros de rede: ETIMEDOUT/ECONNRESET/ECONNREFUSED/EAI_AGAIN.
 *       * HTTP 5xx (502/503/504) e 429 (Too Many Requests).
 *   - 4xx não-429 → falha imediata (são bugs do caller, não overload).
 *
 * Em caso de falha após todas as tentativas, loga JSON estruturado e
 * propaga o erro original (preserva stack trace + permite o orchestrator
 * marcar a fase como `failed` com mensagem útil).
 *
 * Uso típico (no orchestrator):
 *
 *   await withR2Retry(
 *     () => env.R2_LEIS.put(key, body, opts),
 *     "uploadMarkdowns",
 *   );
 *
 * Esta helper NÃO é específica de R2 — também serve para Vectorize
 * (cuja API tem comportamento de rate-limit similar quando upserts
 * batched chegam em rajada). O nome `withR2Retry` ficou pelo caso
 * principal, mas a função aceita qualquer Promise idempotente.
 */

/**
 * Número máximo de tentativas (1 original + (MAX_RETRIES-1) retries).
 *
 * 4 é o sweet spot empírico: com backoff 500/1000/2000/4000ms + jitter,
 * o tempo máximo gasto numa única operação é ~7.7s. Acima disso, a probabilidade
 * de o overload ser permanente fica alta o suficiente para preferir falhar
 * rápido a torrar tokens.
 */
const MAX_RETRIES = 4;

/**
 * Delay base (em ms) — multiplicado por 2^n no backoff exponencial.
 *
 * Sequência efetiva: 500, 1000, 2000 (com jitter [0,200] somado).
 * A 4ª tentativa não dorme porque o loop sai antes.
 */
const BASE_DELAY_MS = 500;

/**
 * Jitter máximo (em ms) somado ao delay para evitar thundering herd.
 *
 * Importante quando múltiplas operações falham simultaneamente
 * (cenário típico do R2 10058 com várias workers paralelas).
 */
const MAX_JITTER_MS = 200;

/**
 * Padrões que identificam um erro como transiente — vale retentar.
 *
 * Lista intencionalmente conservadora: na dúvida, NÃO retentar.
 * Retry em erro não-transiente desperdiça budget e mascara bugs.
 */
const TRANSIENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b10058\b/i, // R2: "Reduce your concurrent request rate"
  /concurrent request rate/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /EAI_AGAIN/i,
  /\b(502|503|504)\b/, // HTTP gateway errors
  /\b429\b/, // Too Many Requests
  /too many requests/i,
  /service unavailable/i,
  /gateway timeout/i,
  /\bnetwork\b.*\b(error|failure)\b/i,
];

/**
 * Padrões que identificam erro 4xx (exceto 429) — NÃO retentar.
 *
 * Esses casos quase sempre indicam bug do caller (path errado, payload
 * inválido, permissão faltando). Retry mascara o problema e gasta
 * tempo à toa.
 */
const NON_TRANSIENT_4XX_PATTERNS: ReadonlyArray<RegExp> = [
  /\b400\b/, // Bad Request
  /\b401\b/, // Unauthorized
  /\b403\b/, // Forbidden
  /\b404\b/, // Not Found
  /\b405\b/, // Method Not Allowed
  /\b409\b/, // Conflict
  /\b410\b/, // Gone
  /\b413\b/, // Payload Too Large
  /\b415\b/, // Unsupported Media Type
  /\b422\b/, // Unprocessable Entity
];

/**
 * Heurística de classificação: o erro é seguro para retentar?
 *
 * Regras (em ordem):
 *   1. Match em NON_TRANSIENT_4XX_PATTERNS → false (curto-circuito).
 *   2. Match em TRANSIENT_PATTERNS → true.
 *   3. Default → false (na dúvida, falha rápido).
 *
 * Exposta para testes; produção usa `withR2Retry`.
 */
export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // 4xx não-429 nunca é retentável, mesmo se o texto casar com transient
  // (ex.: "404 - service unavailable somewhere"). Curto-circuito.
  for (const re of NON_TRANSIENT_4XX_PATTERNS) {
    if (re.test(msg)) return false;
  }
  for (const re of TRANSIENT_PATTERNS) {
    if (re.test(msg)) return true;
  }
  return false;
}

/**
 * Calcula o delay (em ms) para a próxima retentativa.
 *
 * Fórmula: `BASE_DELAY_MS * 2^attempt + jitter`.
 * - `attempt` é zero-indexado (0 → primeira retentativa).
 * - jitter é uniforme em [0, MAX_JITTER_MS].
 *
 * Exposta para testes determinísticos com mock de `Math.random`.
 */
export function calcDelayMs(attempt: number, randomFn: () => number = Math.random): number {
  const exponential = BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.floor(randomFn() * MAX_JITTER_MS);
  return exponential + jitter;
}

/**
 * Promise-based sleep — wrapper de `setTimeout`.
 *
 * Em testes, `vi.useFakeTimers()` avança esse delay sem esperar de verdade.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Opções de configuração (overrides úteis para testes).
 */
export interface RetryOptions {
  /** Sobrescreve MAX_RETRIES. Útil em testes para forçar caminho de erro. */
  maxRetries?: number;
  /** Função de sleep — injetável para teste sem timers fake. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Provedor de números aleatórios — injetável para teste determinístico. */
  randomFn?: () => number;
  /** Logger override — default usa console.warn/error. */
  logger?: {
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

/**
 * Executa `operation` com retry + backoff exponencial + jitter.
 *
 * @param operation - Função idempotente a executar (deve poder ser chamada
 *                    múltiplas vezes sem efeitos colaterais distintos).
 * @param label - Etiqueta humano-legível para logs (ex.: "uploadMarkdowns",
 *                "upsertVectorize"). Aparece em todos os eventos JSON.
 * @param opts - Overrides opcionais (testes).
 * @returns O resultado da `operation` na primeira tentativa que tiver sucesso.
 * @throws O erro da última tentativa (preserva o erro original — não envolve
 *         em wrapper, para manter stack trace utilizável no caller).
 *
 * Logging:
 *   - Cada retentativa loga `{event: "retry_attempt", op, attempt, delay_ms, error}`.
 *   - Falha terminal loga `{event: "retry_exhausted", op, attempts, lastError}`.
 *   - Erro não-transiente loga `{event: "retry_non_transient", op, error}` e
 *     propaga sem dormir.
 */
export async function withR2Retry<T>(
  operation: () => Promise<T>,
  label: string,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const sleepImpl = opts.sleepFn ?? sleep;
  const randomImpl = opts.randomFn ?? Math.random;
  const logger = opts.logger ?? {
    warn: (msg: string): void => console.warn(msg),
    error: (msg: string): void => console.error(msg),
  };

  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);

      // Erro não-transiente — falha imediata, sem dormir.
      if (!isTransientError(err)) {
        logger.warn(
          JSON.stringify({
            event: "retry_non_transient",
            op: label,
            attempt: attempt + 1,
            error: msg,
          }),
        );
        throw err;
      }

      // Última tentativa esgotou — sai do loop e propaga abaixo.
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) break;

      const delayMs = calcDelayMs(attempt, randomImpl);
      logger.warn(
        JSON.stringify({
          event: "retry_attempt",
          op: label,
          attempt: attempt + 1,
          next_delay_ms: delayMs,
          error: msg,
        }),
      );
      await sleepImpl(delayMs);
    }
  }

  // Esgotou retries — log estruturado + propaga o erro original.
  const lastMsg = lastError instanceof Error ? lastError.message : String(lastError);
  logger.error(
    JSON.stringify({
      event: "retry_exhausted",
      op: label,
      attempts: maxRetries,
      lastError: lastMsg,
    }),
  );
  // Preserva stack original — não envolve em novo Error.
  throw lastError;
}

/**
 * Constantes exportadas para testes / asserts (não consumir em produção).
 */
export const __internal = {
  MAX_RETRIES,
  BASE_DELAY_MS,
  MAX_JITTER_MS,
  TRANSIENT_PATTERNS,
  NON_TRANSIENT_4XX_PATTERNS,
};
