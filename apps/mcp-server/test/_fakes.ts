/**
 * Fakes mínimos dos bindings Cloudflare usados pelo Worker em ambiente
 * de teste (vitest rodando em Node puro).
 *
 * Cobre:
 *   - `CACHE` (KVNamespace): in-memory `get`, `put`, `delete`.
 *   - `AI` (Workers AI): stub configurável (embed + reranker).
 *   - `VECTORIZE`: stub configurável retornando `matches`.
 *   - `R2_LEIS`/`R2_SKILLS`: in-memory bucket com `get` (JSON / text).
 *   - `DB` (D1): stub que devolve resultados configurados por padrão SQL
 *     substring → resultados (suficiente para testar handlers sem motor SQL).
 *
 * Os fakes preservam "fail-fast": qualquer binding não configurado em uma
 * suíte (via `createTestEnv({...})`) explode no acesso para deixar claro
 * que o handler está vazando dependência indevida.
 */

import type { Env } from "../src/env.js";

// ============================================================================
// KV
// ============================================================================

export function createFakeKv(): KVNamespace {
  const store = new Map<string, string>();

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

// ============================================================================
// AI (Workers AI)
// ============================================================================

export interface FakeAiOptions {
  /** Resposta default do embedding (1024 dims preenchidos com 0.01). */
  embedding?: number[];
  /** Map opcional para overrides por modelo. */
  responses?: Record<string, unknown>;
}

export function createFakeAi(opts: FakeAiOptions = {}): Ai {
  const embedding = opts.embedding ?? new Array(1024).fill(0.01);
  const ai = {
    async run(model: string, _input: unknown): Promise<unknown> {
      if (opts.responses && model in opts.responses) {
        return opts.responses[model];
      }
      if (model.includes("bge-m3")) {
        return { data: [embedding] };
      }
      if (model.includes("reranker")) {
        return {
          response: [
            { id: 0, score: 0.95 },
            { id: 1, score: 0.7 },
          ],
        };
      }
      return {};
    },
  };
  return ai as unknown as Ai;
}

// ============================================================================
// Vectorize
// ============================================================================

export interface FakeVectorizeOptions {
  matches?: Array<{
    id: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
}

export function createFakeVectorize(opts: FakeVectorizeOptions = {}): VectorizeIndex {
  const idx = {
    async query(
      _vector: number[] | Float32Array,
      _options?: VectorizeQueryOptions,
    ): Promise<{ matches: typeof opts.matches }> {
      return { matches: opts.matches ?? [] };
    },
  };
  return idx as unknown as VectorizeIndex;
}

// ============================================================================
// R2
// ============================================================================

export function createFakeR2(initial: Record<string, unknown> = {}): R2Bucket {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  const bucket = {
    async get(key: string): Promise<R2ObjectBody | null> {
      const raw = store.get(key);
      if (raw === undefined) return null;
      const body = {
        async json<T>(): Promise<T> {
          return JSON.parse(raw) as T;
        },
        async text(): Promise<string> {
          return raw;
        },
      };
      return body as unknown as R2ObjectBody;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };
  return bucket as unknown as R2Bucket;
}

// ============================================================================
// D1
// ============================================================================

export interface FakeD1Options {
  /**
   * Lista de "regras": cada regra casa por substring no SQL e devolve linhas.
   * Avaliada na ordem; a primeira regra que casar é usada.
   */
  rules?: Array<{
    match: string | RegExp;
    rows: unknown[];
  }>;
}

export function createFakeD1(opts: FakeD1Options = {}): D1Database {
  function matchRows(sql: string): unknown[] {
    for (const r of opts.rules ?? []) {
      if (typeof r.match === "string" && sql.includes(r.match)) return r.rows;
      if (r.match instanceof RegExp && r.match.test(sql)) return r.rows;
    }
    return [];
  }
  const stmt = (sql: string) => {
    const _bound: unknown[] = [];
    const prepared = {
      bind(...args: unknown[]) {
        _bound.push(...args);
        return prepared;
      },
      async first<T>(): Promise<T | null> {
        const rows = matchRows(sql);
        return (rows[0] as T | undefined) ?? null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        return { results: matchRows(sql) as T[] };
      },
      async run(): Promise<{ success: true }> {
        return { success: true };
      },
    };
    return prepared as unknown as D1PreparedStatement;
  };
  const db = {
    prepare(sql: string) {
      return stmt(sql);
    },
  };
  return db as unknown as D1Database;
}

// ============================================================================
// Env
// ============================================================================

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

export interface TestEnvOverrides {
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  R2_LEIS?: R2Bucket;
  R2_SKILLS?: R2Bucket;
  DB?: D1Database;
  CACHE?: KVNamespace;
}

/**
 * Monta um `Env` de teste com KV real (in-memory) e demais bindings inertes.
 *
 * Passe `overrides` para configurar individualmente (ex.: ao testar
 * tools que falam com R2/D1/AI/VECTORIZE).
 */
export function createTestEnv(overrides: TestEnvOverrides = {}): Env {
  return {
    AI: overrides.AI ?? unusedBinding<Ai>("AI"),
    VECTORIZE: overrides.VECTORIZE ?? unusedBinding<VectorizeIndex>("VECTORIZE"),
    R2_LEIS: overrides.R2_LEIS ?? unusedBinding<R2Bucket>("R2_LEIS"),
    R2_SKILLS: overrides.R2_SKILLS ?? unusedBinding<R2Bucket>("R2_SKILLS"),
    DB: overrides.DB ?? unusedBinding<D1Database>("DB"),
    CACHE: overrides.CACHE ?? createFakeKv(),
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
