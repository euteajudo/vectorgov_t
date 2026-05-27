/**
 * Testes de `src/lib/retry.ts` — helper `withR2Retry` + classificador de
 * erros transientes.
 *
 * Cobertura:
 *   - Sucesso na 1ª tentativa.
 *   - Sucesso após N retentativas (erro transiente).
 *   - Falha imediata em erro não-transiente.
 *   - Esgotamento de retries.
 *   - Cálculo de delay com jitter.
 *   - Classificação correta de erros.
 *
 * Estratégia: injetar `sleepFn` (no-op) e `randomFn` (determinístico)
 * para evitar dependência de timers fake e cobrir todos os ramos sem
 * flakiness.
 */

import { describe, expect, it, vi } from "vitest";
import {
  withR2Retry,
  isTransientError,
  calcDelayMs,
  __internal,
} from "../src/lib/retry.js";

// Logger silencioso para evitar poluir output dos testes
const silentLogger = {
  warn: (): void => {},
  error: (): void => {},
};

describe("isTransientError", () => {
  it("classifica R2 10058 como transiente", () => {
    expect(isTransientError(new Error("R2 error 10058: rate limit"))).toBe(true);
    expect(
      isTransientError(new Error("Reduce your concurrent request rate for the same object")),
    ).toBe(true);
  });

  it("classifica erros de rede como transientes", () => {
    expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
    expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isTransientError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isTransientError(new Error("EAI_AGAIN getaddrinfo"))).toBe(true);
  });

  it("classifica 5xx e 429 como transientes", () => {
    expect(isTransientError(new Error("HTTP 502 Bad Gateway"))).toBe(true);
    expect(isTransientError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransientError(new Error("Got 504 from upstream"))).toBe(true);
    expect(isTransientError(new Error("429 Too Many Requests"))).toBe(true);
  });

  it("classifica 4xx (exceto 429) como NÃO transiente", () => {
    expect(isTransientError(new Error("HTTP 400 Bad Request"))).toBe(false);
    expect(isTransientError(new Error("401 Unauthorized"))).toBe(false);
    expect(isTransientError(new Error("403 Forbidden"))).toBe(false);
    expect(isTransientError(new Error("404 Not Found"))).toBe(false);
    expect(isTransientError(new Error("413 Payload Too Large"))).toBe(false);
  });

  it("4xx tem precedência sobre transient — não retenta erro 404 com palavra 'unavailable'", () => {
    // Curto-circuito: 404 nunca é retentável, mesmo se a mensagem contiver
    // palavras-chave de transient (caso real: APIs que dizem "404 - service
    // unavailable for path X").
    expect(
      isTransientError(new Error("404 Not Found - service unavailable")),
    ).toBe(false);
  });

  it("default: erro desconhecido = NÃO transiente", () => {
    expect(isTransientError(new Error("foo bar baz"))).toBe(false);
    expect(isTransientError("string sem padrão")).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

describe("calcDelayMs", () => {
  it("aplica backoff exponencial: 500, 1000, 2000", () => {
    // randomFn fixo em 0 → jitter zero, isola o termo exponencial
    expect(calcDelayMs(0, () => 0)).toBe(500);
    expect(calcDelayMs(1, () => 0)).toBe(1000);
    expect(calcDelayMs(2, () => 0)).toBe(2000);
    expect(calcDelayMs(3, () => 0)).toBe(4000);
  });

  it("aplica jitter no intervalo [0, MAX_JITTER_MS)", () => {
    expect(calcDelayMs(0, () => 0)).toBe(500);
    // randomFn = 0.5 → jitter = floor(0.5 * 200) = 100
    expect(calcDelayMs(0, () => 0.5)).toBe(600);
    // randomFn próximo de 1 → jitter próximo de 200
    expect(calcDelayMs(0, () => 0.9999)).toBe(699);
  });
});

describe("withR2Retry — caminho feliz", () => {
  it("devolve o resultado na 1ª tentativa quando operation passa", async () => {
    const operation = vi.fn(async () => "ok");
    const result = await withR2Retry(operation, "test:op", {
      logger: silentLogger,
    });
    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retenta erro transiente até sucesso e devolve o resultado final", async () => {
    let tentativas = 0;
    const operation = vi.fn(async () => {
      tentativas++;
      if (tentativas < 3) {
        throw new Error("R2 10058 transient");
      }
      return "sucesso-eventual";
    });

    const sleepFn = vi.fn(async () => {
      /* no-op */
    });

    const result = await withR2Retry(operation, "test:retry", {
      sleepFn,
      randomFn: () => 0,
      logger: silentLogger,
    });

    expect(result).toBe("sucesso-eventual");
    expect(operation).toHaveBeenCalledTimes(3);
    // Dormiu 2 vezes (entre a 1ª-2ª e a 2ª-3ª tentativa)
    expect(sleepFn).toHaveBeenCalledTimes(2);
    // Primeiro delay: 500ms (jitter 0), segundo: 1000ms
    expect(sleepFn).toHaveBeenNthCalledWith(1, 500);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 1000);
  });
});

describe("withR2Retry — caminhos de erro", () => {
  it("propaga IMEDIATAMENTE erro não-transiente, sem dormir", async () => {
    const operation = vi.fn(async () => {
      throw new Error("HTTP 404 Not Found");
    });
    const sleepFn = vi.fn(async () => {
      /* no-op */
    });

    await expect(
      withR2Retry(operation, "test:404", {
        sleepFn,
        logger: silentLogger,
      }),
    ).rejects.toThrow("404");

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledTimes(0);
  });

  it("propaga erro original (preserva stack) após esgotar retries", async () => {
    const erroOriginal = new Error("ECONNRESET fatal");
    const operation = vi.fn(async () => {
      throw erroOriginal;
    });
    const sleepFn = vi.fn(async () => {
      /* no-op */
    });

    let caught: unknown;
    try {
      await withR2Retry(operation, "test:exhaust", {
        sleepFn,
        randomFn: () => 0,
        logger: silentLogger,
      });
    } catch (err) {
      caught = err;
    }

    // Erro propagado é EXATAMENTE o original (identidade, não wrap)
    expect(caught).toBe(erroOriginal);
    // 4 tentativas totais (MAX_RETRIES default)
    expect(operation).toHaveBeenCalledTimes(__internal.MAX_RETRIES);
    // Dormiu MAX_RETRIES-1 vezes (entre cada par de tentativas)
    expect(sleepFn).toHaveBeenCalledTimes(__internal.MAX_RETRIES - 1);
  });

  it("respeita maxRetries override em opts", async () => {
    const operation = vi.fn(async () => {
      throw new Error("503 transient");
    });

    await expect(
      withR2Retry(operation, "test:max-2", {
        maxRetries: 2,
        sleepFn: async () => {
          /* no-op */
        },
        randomFn: () => 0,
        logger: silentLogger,
      }),
    ).rejects.toThrow("503");

    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe("withR2Retry — logging", () => {
  it("loga retry_attempt em cada retentativa e retry_exhausted no fim", async () => {
    const operation = async (): Promise<never> => {
      throw new Error("R2 10058");
    };
    const warns: string[] = [];
    const errors: string[] = [];

    try {
      await withR2Retry(operation, "test:log", {
        maxRetries: 2,
        sleepFn: async () => {
          /* no-op */
        },
        randomFn: () => 0,
        logger: {
          warn: (m): void => {
            warns.push(m);
          },
          error: (m): void => {
            errors.push(m);
          },
        },
      });
    } catch {
      /* esperado */
    }

    // 1 retry_attempt entre a 1ª e a 2ª tentativa
    expect(warns).toHaveLength(1);
    const warnEvent = JSON.parse(warns[0]!);
    expect(warnEvent.event).toBe("retry_attempt");
    expect(warnEvent.op).toBe("test:log");
    expect(warnEvent.attempt).toBe(1);

    // 1 retry_exhausted após esgotar
    expect(errors).toHaveLength(1);
    const errEvent = JSON.parse(errors[0]!);
    expect(errEvent.event).toBe("retry_exhausted");
    expect(errEvent.op).toBe("test:log");
    expect(errEvent.attempts).toBe(2);
  });

  it("loga retry_non_transient e NÃO loga retry_exhausted em erro 4xx", async () => {
    const operation = async (): Promise<never> => {
      throw new Error("HTTP 400 Bad Request");
    };
    const warns: string[] = [];
    const errors: string[] = [];

    try {
      await withR2Retry(operation, "test:non-transient", {
        sleepFn: async () => {
          /* no-op */
        },
        logger: {
          warn: (m): void => {
            warns.push(m);
          },
          error: (m): void => {
            errors.push(m);
          },
        },
      });
    } catch {
      /* esperado */
    }

    expect(warns).toHaveLength(1);
    expect(JSON.parse(warns[0]!).event).toBe("retry_non_transient");
    expect(errors).toHaveLength(0);
  });
});
