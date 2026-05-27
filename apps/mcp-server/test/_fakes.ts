/**
 * Fakes mínimos dos bindings Cloudflare usados pelo Worker em ambiente
 * de teste (vitest rodando em Node puro).
 *
 * Cobre apenas a superfície usada pelo handler atual:
 *   - `CACHE` (KVNamespace): `get`, `put`, `delete`.
 *
 * Demais bindings (AI, VECTORIZE, R2, D1) recebem stubs que arremessam
 * caso usados — preservando "fail-fast" se algum handler vazar
 * dependência indevida nos testes.
 */

import type { Env } from "../src/env.js";

/**
 * Fake do KV em memória — suficiente para testar rate-limit + cache wrapper.
 *
 * Implementa as duas formas de `get` usadas pelo código: string padrão
 * (no rate-limit) e `"json"` (no cache wrapper). Demais sobrecargas
 * (`"arrayBuffer"`, `"stream"`) caem no `default` que arremessa.
 */
export function createFakeKv(): KVNamespace {
  const store = new Map<string, string>();

  // Função `get` polimórfica — cobre as sobrecargas string e "json".
  async function get(
    key: string,
    typeOrOptions?: unknown,
  ): Promise<string | null | unknown> {
    const raw = store.get(key) ?? null;
    if (raw === null) return null;
    const type =
      typeof typeOrOptions === "string"
        ? typeOrOptions
        : (typeOrOptions as { type?: string } | undefined)?.type;
    if (type === "json") {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    }
    if (type === undefined || type === "text") {
      return raw;
    }
    throw new Error(`createFakeKv.get: tipo '${type}' não suportado em testes`);
  }

  const kv: Partial<KVNamespace> = {
    get: get as unknown as KVNamespace["get"],
    async put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
      _opts?: KVNamespacePutOptions,
    ): Promise<void> {
      if (typeof value === "string") {
        store.set(key, value);
        return;
      }
      throw new Error("createFakeKv: apenas string values são suportadas");
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };
  return kv as KVNamespace;
}

/**
 * Builder genérico para um binding "explosivo" — qualquer acesso lança.
 * Útil quando o handler em teste não deveria tocar aquele binding.
 */
function unusedBinding<T>(name: string): T {
  return new Proxy(
    {},
    {
      get(): never {
        throw new Error(`Binding '${name}' acessado em teste sem fake configurado`);
      },
    },
  ) as T;
}

/**
 * Monta um `Env` de teste com KV real (in-memory) e demais bindings inertes.
 */
export function createTestEnv(): Env {
  return {
    AI: unusedBinding<Ai>("AI"),
    VECTORIZE: unusedBinding<VectorizeIndex>("VECTORIZE"),
    R2_LEIS: unusedBinding<R2Bucket>("R2_LEIS"),
    R2_SKILLS: unusedBinding<R2Bucket>("R2_SKILLS"),
    DB: unusedBinding<D1Database>("DB"),
    CACHE: createFakeKv(),
  };
}

/**
 * `ExecutionContext` simulado — `waitUntil` / `passThroughOnException` são
 * no-ops nos testes (não precisamos esperar tarefas em background).
 */
export function createExecutionContext(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>): void {
      /* no-op */
    },
    passThroughOnException(): void {
      /* no-op */
    },
    props: {},
  } satisfies ExecutionContext;
}
