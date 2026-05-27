/**
 * Testes do `lib/rate-limit.ts` — duas dimensões (minuto + dia).
 *
 * Cobertura:
 *   - Requisição abaixo do limite passa (devolve null).
 *   - Limite por minuto barra (429 com scope=minute).
 *   - Quota diária barra mesmo se o minuto estiver folgado.
 *   - OPTIONS nunca é barrado.
 *   - Header `Retry-After` correto.
 */
import { describe, expect, it } from "vitest";
import { enforceRateLimit } from "../src/lib/rate-limit.js";
import { createTestEnv, createFakeKv } from "./_fakes.js";

function reqWithIp(ip: string, method = "POST"): Request {
  return new Request("https://example.com/api/test", {
    method,
    headers: { "CF-Connecting-IP": ip },
  });
}

describe("enforceRateLimit — janela curta (minuto)", () => {
  it("devolve null quando abaixo do limite", async () => {
    const env = createTestEnv({ CACHE: createFakeKv() });
    const res = await enforceRateLimit(reqWithIp("1.1.1.1"), env, {
      limitPerMinute: 3,
    });
    expect(res).toBeNull();
  });

  it("barra com 429 ao exceder limite por minuto", async () => {
    const env = createTestEnv({ CACHE: createFakeKv() });
    // 3 requisições passam
    for (let i = 0; i < 3; i++) {
      const ok = await enforceRateLimit(reqWithIp("2.2.2.2"), env, {
        limitPerMinute: 3,
        // afastar quota diária do teste — limite alto para isolar a janela curta
        limitPerDay: 999999,
      });
      expect(ok).toBeNull();
    }
    // 4ª deve barrar
    const blocked = await enforceRateLimit(reqWithIp("2.2.2.2"), env, {
      limitPerMinute: 3,
      limitPerDay: 999999,
    });
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get("X-RateLimit-Scope")).toBe("minute");
    const retry = blocked!.headers.get("Retry-After");
    expect(retry).toBeTruthy();
    expect(Number.parseInt(retry!, 10)).toBeGreaterThan(0);
  });

  it("IPs distintos têm contadores independentes", async () => {
    const env = createTestEnv({ CACHE: createFakeKv() });
    // IP A esgota limite de 2
    expect(
      await enforceRateLimit(reqWithIp("3.3.3.3"), env, { limitPerMinute: 2 }),
    ).toBeNull();
    expect(
      await enforceRateLimit(reqWithIp("3.3.3.3"), env, { limitPerMinute: 2 }),
    ).toBeNull();
    expect(
      await enforceRateLimit(reqWithIp("3.3.3.3"), env, { limitPerMinute: 2 }),
    ).not.toBeNull();

    // IP B continua passando
    expect(
      await enforceRateLimit(reqWithIp("4.4.4.4"), env, { limitPerMinute: 2 }),
    ).toBeNull();
  });
});

describe("enforceRateLimit — quota diária", () => {
  it("barra com 429 scope=day quando minuto folga mas dia atinge limite", async () => {
    const env = createTestEnv({ CACHE: createFakeKv() });

    // 2 requisições passam (limite dia=2, minuto folgado=999)
    expect(
      await enforceRateLimit(reqWithIp("5.5.5.5"), env, {
        limitPerMinute: 999,
        limitPerDay: 2,
      }),
    ).toBeNull();
    expect(
      await enforceRateLimit(reqWithIp("5.5.5.5"), env, {
        limitPerMinute: 999,
        limitPerDay: 2,
      }),
    ).toBeNull();

    // 3ª deve barrar pelo scope=day
    const blocked = await enforceRateLimit(reqWithIp("5.5.5.5"), env, {
      limitPerMinute: 999,
      limitPerDay: 2,
    });
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get("X-RateLimit-Scope")).toBe("day");
  });

  it("minuto tem precedência sobre dia (curto-circuito)", async () => {
    const env = createTestEnv({ CACHE: createFakeKv() });
    // Limite minuto=1, dia=10 — vamos atingir minuto primeiro
    expect(
      await enforceRateLimit(reqWithIp("6.6.6.6"), env, {
        limitPerMinute: 1,
        limitPerDay: 10,
      }),
    ).toBeNull();
    const blocked = await enforceRateLimit(reqWithIp("6.6.6.6"), env, {
      limitPerMinute: 1,
      limitPerDay: 10,
    });
    expect(blocked!.headers.get("X-RateLimit-Scope")).toBe("minute");
  });
});

describe("enforceRateLimit — casos especiais", () => {
  it("OPTIONS nunca é barrado, mesmo após exceder limite", async () => {
    const env = createTestEnv({ CACHE: createFakeKv() });
    // Esgota limite
    for (let i = 0; i < 5; i++) {
      await enforceRateLimit(reqWithIp("7.7.7.7"), env, { limitPerMinute: 1 });
    }
    // OPTIONS sempre passa
    const res = await enforceRateLimit(reqWithIp("7.7.7.7", "OPTIONS"), env, {
      limitPerMinute: 1,
    });
    expect(res).toBeNull();
  });

  it("usa defaults quando opts vazio (60/min, 500/dia)", async () => {
    const env = createTestEnv({ CACHE: createFakeKv() });
    // 1 requisição passa sem problemas
    const ok = await enforceRateLimit(reqWithIp("8.8.8.8"), env);
    expect(ok).toBeNull();
  });

  it("body do 429 inclui scope e retry_after_seconds", async () => {
    const env = createTestEnv({ CACHE: createFakeKv() });
    await enforceRateLimit(reqWithIp("9.9.9.9"), env, { limitPerMinute: 1 });
    const blocked = await enforceRateLimit(reqWithIp("9.9.9.9"), env, {
      limitPerMinute: 1,
    });
    const body = (await blocked!.json()) as Record<string, unknown>;
    expect(body.error).toBe("Too Many Requests");
    expect(body.scope).toBe("minute");
    expect(typeof body.retry_after_seconds).toBe("number");
    expect(body.retry_after_seconds).toBeGreaterThan(0);
  });
});
