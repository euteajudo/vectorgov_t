/**
 * Testes do batch-embedding (`src/lib/batch-embedding.ts`).
 *
 * Cobre:
 *   - Dimensão 1024 validada e empacotada em Float32Array.
 *   - Sub-batches de 100 quando o input excede o limite.
 *   - Retry com sucesso na 2ª tentativa (sleep mockado).
 *   - Falha terminal após 3 tentativas.
 *   - Lista vazia → array vazio sem chamar AI.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { embedBatch } from "../src/lib/batch-embedding.js";
import { createPipelineEnv } from "./_fakes.js";

describe("embedBatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna vetores Float32Array de 1024 dim na ordem do input", async () => {
    const env = createPipelineEnv();
    const textos = ["lorem", "ipsum", "dolor"];
    const promise = embedBatch(textos, env);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toHaveLength(3);
    for (const v of result) {
      expect(v).toBeInstanceOf(Float32Array);
      expect(v.length).toBe(1024);
    }
    expect(env.AI.callCount).toBe(1);
    expect(env.AI.textsSeen[0]).toEqual(textos);
  });

  it("quebra em sub-batches de 100", async () => {
    const env = createPipelineEnv();
    const textos = Array.from({ length: 250 }, (_, i) => `doc-${i}`);
    const promise = embedBatch(textos, env);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toHaveLength(250);
    // 100 + 100 + 50 = 3 chamadas
    expect(env.AI.callCount).toBe(3);
    expect(env.AI.textsSeen[0]?.length).toBe(100);
    expect(env.AI.textsSeen[1]?.length).toBe(100);
    expect(env.AI.textsSeen[2]?.length).toBe(50);
  });

  it("retenta após falha (sucesso na 2ª tentativa)", async () => {
    const env = createPipelineEnv();
    env.AI.failOnCalls.add(1); // primeira tentativa falha
    const promise = embedBatch(["alfa"], env);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toHaveLength(1);
    expect(env.AI.callCount).toBe(2);
  });

  it("propaga erro após 3 tentativas falhas", async () => {
    const env = createPipelineEnv();
    env.AI.failOnCalls.add(1);
    env.AI.failOnCalls.add(2);
    env.AI.failOnCalls.add(3);
    const promise = embedBatch(["x"], env);
    // anexar handler de rejeição ANTES de avançar os timers evita o
    // PromiseRejectionHandledWarning do Node.
    const assertion = expect(promise).rejects.toThrow(/falhou após 3 tentativas/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(env.AI.callCount).toBe(3);
  });

  it("retorna [] sem chamar AI para input vazio", async () => {
    const env = createPipelineEnv();
    const result = await embedBatch([], env);
    expect(result).toEqual([]);
    expect(env.AI.callCount).toBe(0);
  });
});
