/**
 * Fakes mínimos dos bindings Cloudflare usados pelo Worker em ambiente
 * de teste (vitest rodando em Node puro).
 *
 * Combina as APIs introduzidas pelas Tracks D (tools MCP) e G (pipeline):
 *   - APIs com options (D): `createFakeAi({embedding, responses})`,
 *     `createFakeR2(initial)`, `createFakeD1({rules})`,
 *     `createFakeVectorize({matches})`.
 *   - APIs com state introspection (G): `createFakeAi()` → `FakeAi`,
 *     `createFakeR2Bucket()` → `FakeR2Bucket`, `createFakeD1()` → `FakeD1Database`,
 *     `createFakeVectorize()` → `FakeVectorize`.
 *
 * Os fakes preservam "fail-fast" via `unusedBinding()`: qualquer binding não
 * configurado em uma suíte explode no acesso para deixar claro que o handler
 * está vazando dependência indevida.
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
// AI (Workers AI) — versão unificada
// ============================================================================

export interface FakeAiOptions {
  /** Embedding fixo (1024 dims) para retornar quando bge-m3 for chamado. */
  embedding?: number[];
  /** Map de respostas por nome de modelo (override completo). */
  responses?: Record<string, unknown>;
}

export interface FakeAi extends Ai {
  callCount: number;
  failOnCalls: Set<number>;
  textsSeen: string[][];
}

/**
 * Hash simples para gerar valores reproduzíveis sem depender de crypto.
 */
function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Gera um vetor "embedding" determinístico baseado no hash do texto.
 * Não é semântico — só serve para testes assertarem ordem/dimensão.
 */
function fakeEmbedding(text: string, fallback?: number[]): number[] {
  if (fallback) return fallback;
  const seed = simpleHash(text);
  const vec: number[] = new Array(1024);
  for (let i = 0; i < 1024; i++) {
    vec[i] = ((seed * (i + 1)) % 1000) / 1000;
  }
  return vec;
}

export function createFakeAi(opts: FakeAiOptions = {}): FakeAi {
  const state = {
    callCount: 0,
    failOnCalls: new Set<number>(),
    textsSeen: [] as string[][],
  };

  const ai = {
    callCount: 0,
    failOnCalls: state.failOnCalls,
    textsSeen: state.textsSeen,
    async run(model: string, params: unknown): Promise<unknown> {
      state.callCount += 1;
      (ai as { callCount: number }).callCount = state.callCount;

      // Override por modelo (versão D)
      if (opts.responses && model in opts.responses) {
        return opts.responses[model];
      }

      const p = params as { text?: string[] };
      const texts = p?.text ?? [];
      state.textsSeen.push([...texts]);

      if (state.failOnCalls.has(state.callCount)) {
        throw new Error(`fake AI failure on call ${state.callCount}`);
      }

      if (model.includes("bge-m3")) {
        const data = texts.map((t) => fakeEmbedding(t, opts.embedding));
        return { shape: [data.length, 1024], data };
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
  } as unknown as FakeAi;
  return ai;
}

// ============================================================================
// Vectorize — versão unificada
// ============================================================================

export interface FakeVectorizeOptions {
  matches?: Array<{
    id: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface FakeVectorize extends VectorizeIndex {
  vectors: Map<string, { values: number[]; metadata: Record<string, unknown> }>;
  upsertCount: number;
  deleteCount: number;
}

export function createFakeVectorize(opts: FakeVectorizeOptions = {}): FakeVectorize {
  const vectors = new Map<string, { values: number[]; metadata: Record<string, unknown> }>();
  const counters = { upsertCount: 0, deleteCount: 0 };

  const idx = {
    vectors,
    get upsertCount(): number {
      return counters.upsertCount;
    },
    get deleteCount(): number {
      return counters.deleteCount;
    },
    async upsert(
      items: { id: string; values: number[]; metadata?: Record<string, unknown> }[],
    ): Promise<unknown> {
      counters.upsertCount += 1;
      for (const v of items) {
        vectors.set(v.id, { values: v.values, metadata: v.metadata ?? {} });
      }
      return { count: items.length };
    },
    async deleteByIds(ids: string[]): Promise<unknown> {
      counters.deleteCount += 1;
      for (const id of ids) vectors.delete(id);
      return { count: ids.length };
    },
    async query(
      _vector: number[] | Float32Array,
      _options?: VectorizeQueryOptions,
    ): Promise<{ matches: NonNullable<FakeVectorizeOptions["matches"]> }> {
      return { matches: opts.matches ?? [] };
    },
    async insert(): Promise<unknown> {
      return { count: 0 };
    },
    async getByIds(): Promise<unknown> {
      return [];
    },
    async describe(): Promise<unknown> {
      return { dimensions: 1024, vectorsCount: vectors.size };
    },
  } as unknown as FakeVectorize;
  return idx;
}

// ============================================================================
// R2 — duas APIs (simples + state)
// ============================================================================

/**
 * R2 simples (versão D): só `get`/`put`/`delete`. Sem state introspection.
 */
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

interface FakeR2Object {
  key: string;
  body: ArrayBuffer;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
}

export interface FakeR2Bucket extends R2Bucket {
  store: Map<string, FakeR2Object>;
  putCount: number;
  deleteCount: number;
}

/**
 * Converte qualquer body aceito pelo `put` para ArrayBuffer.
 */
async function bodyToArrayBuffer(
  body: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
): Promise<ArrayBuffer> {
  if (body === null) return new ArrayBuffer(0);
  if (typeof body === "string") {
    return new TextEncoder().encode(body).buffer as ArrayBuffer;
  }
  if (body instanceof ArrayBuffer) return body;
  if (body instanceof Blob) return await body.arrayBuffer();
  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
  }
  throw new Error("createFakeR2Bucket: ReadableStream não suportado em testes");
}

/**
 * R2 com state (versão G): mantém store, putCount, deleteCount acessíveis.
 */
export function createFakeR2Bucket(): FakeR2Bucket {
  const store = new Map<string, FakeR2Object>();
  const counters = { putCount: 0, deleteCount: 0 };

  const bucket = {
    store,
    get putCount(): number {
      return counters.putCount;
    },
    get deleteCount(): number {
      return counters.deleteCount;
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
      options?: R2PutOptions,
    ): Promise<R2Object> {
      counters.putCount += 1;
      const buf = await bodyToArrayBuffer(value);
      store.set(key, {
        key,
        body: buf,
        customMetadata: options?.customMetadata ?? undefined,
        httpMetadata:
          options?.httpMetadata && !(options.httpMetadata instanceof Headers)
            ? { contentType: options.httpMetadata.contentType ?? undefined }
            : undefined,
      });
      return {
        key,
        size: buf.byteLength,
        etag: "fake",
        httpEtag: "fake",
        uploaded: new Date(),
      } as unknown as R2Object;
    },
    async get(key: string): Promise<R2ObjectBody | null> {
      const obj = store.get(key);
      if (!obj) return null;
      const buf = obj.body;
      return {
        key,
        size: buf.byteLength,
        async arrayBuffer(): Promise<ArrayBuffer> {
          return buf;
        },
        async text(): Promise<string> {
          return new TextDecoder().decode(buf);
        },
        async json<T = unknown>(): Promise<T> {
          return JSON.parse(new TextDecoder().decode(buf)) as T;
        },
      } as unknown as R2ObjectBody;
    },
    async delete(keys: string | string[]): Promise<void> {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) {
        if (store.delete(k)) counters.deleteCount += 1;
      }
    },
    async list(options?: R2ListOptions): Promise<R2Objects> {
      const prefix = options?.prefix ?? "";
      const matched = Array.from(store.values())
        .filter((o) => o.key.startsWith(prefix))
        .map((o) => ({
          key: o.key,
          size: o.body.byteLength,
          etag: "fake",
          httpEtag: "fake",
          uploaded: new Date(),
        }));
      return {
        objects: matched as unknown as R2Object[],
        truncated: false,
        delimitedPrefixes: [],
      } as R2Objects;
    },
  } as unknown as FakeR2Bucket;

  return bucket;
}

// ============================================================================
// D1 — duas APIs (rule-based + state)
// ============================================================================

export interface FakeD1Options {
  /**
   * Lista de "regras": cada regra casa por substring no SQL e devolve linhas.
   * Avaliada na ordem; a primeira regra que casar é usada.
   * Quando dado, usa o motor rule-based (versão D).
   * Quando ausente, usa o motor com state (versão G).
   */
  rules?: Array<{
    match: string | RegExp;
    rows: unknown[];
  }>;
}

export interface FakeD1Database extends D1Database {
  state: {
    normas: Map<string, Record<string, unknown>>;
    dispositivos: Map<string, Record<string, unknown>>;
    versoes: Array<Record<string, unknown>>;
    fts: Array<Record<string, unknown>>;
  };
  batchCount: number;
}

export function createFakeD1(opts: FakeD1Options = {}): FakeD1Database {
  // Modo rule-based (versão D)
  if (opts.rules) {
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
        async raw<T>(): Promise<T[]> {
          return matchRows(sql) as T[];
        },
      };
      return prepared as unknown as D1PreparedStatement;
    };
    const db = {
      state: {
        normas: new Map(),
        dispositivos: new Map(),
        versoes: [],
        fts: [],
      },
      batchCount: 0,
      prepare(sql: string) {
        return stmt(sql);
      },
      async batch(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
        const results: D1Result[] = [];
        for (const s of stmts) {
          await s.run();
          results.push({ success: true, meta: { duration: 0 } } as unknown as D1Result);
        }
        return results;
      },
      async exec(): Promise<D1ExecResult> {
        return { count: 0, duration: 0 } as unknown as D1ExecResult;
      },
    } as unknown as FakeD1Database;
    return db;
  }

  // Modo com state (versão G)
  const state = {
    normas: new Map<string, Record<string, unknown>>(),
    dispositivos: new Map<string, Record<string, unknown>>(),
    versoes: [] as Array<Record<string, unknown>>,
    fts: [] as Array<Record<string, unknown>>,
  };
  const counters = { batchCount: 0 };

  function makeStatement(sql: string, binds: unknown[] = []): D1PreparedStatement {
    return {
      bind(...args: unknown[]): D1PreparedStatement {
        return makeStatement(sql, args);
      },
      async run(): Promise<D1Result> {
        runOne(sql, binds);
        return { success: true, meta: { duration: 0 } } as unknown as D1Result;
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const results = runQuery(sql, binds) as T[];
        return { success: true, results, meta: { duration: 0 } } as unknown as D1Result<T>;
      },
      async first<T = unknown>(): Promise<T | null> {
        const results = runQuery(sql, binds);
        return (results[0] as T) ?? null;
      },
      async raw<T = unknown[]>(): Promise<T[]> {
        return runQuery(sql, binds) as T[];
      },
    } as unknown as D1PreparedStatement;
  }

  function runOne(sql: string, binds: unknown[]): void {
    const s = sql.trim();

    if (s.startsWith("INSERT INTO normas")) {
      const [id, tipo, numero, ano, data_publicacao, ementa, status, r2_path] = binds;
      state.normas.set(String(id), {
        id, tipo, numero, ano, data_publicacao, ementa, status, r2_path,
      });
      return;
    }
    if (s.startsWith("INSERT INTO dispositivos ")) {
      const [id, norma_id, artigo, paragrafo, inciso, alinea, hierarquia_path, tipo_dispositivo] = binds;
      state.dispositivos.set(String(id), {
        id, norma_id, artigo, paragrafo, inciso, alinea, hierarquia_path, tipo_dispositivo,
      });
      return;
    }
    if (s.startsWith("INSERT INTO versoes_dispositivos")) {
      const [dispositivo_id, data_inicio, data_fim, texto, norma_que_alterou, r2_path_versao] = binds;
      state.versoes.push({
        dispositivo_id, data_inicio, data_fim, texto, norma_que_alterou, r2_path_versao,
      });
      return;
    }
    if (s.startsWith("INSERT INTO dispositivos_fts")) {
      const [norma_id, artigo, paragrafo, hierarquia, texto] = binds;
      state.fts.push({ norma_id, artigo, paragrafo, hierarquia, texto });
      return;
    }
    if (s.startsWith("DELETE FROM versoes_dispositivos WHERE")) {
      const normaId = String(binds[0]);
      const idsDoNorma = Array.from(state.dispositivos.values())
        .filter((d) => d.norma_id === normaId)
        .map((d) => d.id);
      const setIds = new Set(idsDoNorma);
      state.versoes = state.versoes.filter((v) => !setIds.has(v.dispositivo_id));
      return;
    }
    if (s.startsWith("DELETE FROM dispositivos_fts WHERE norma_id")) {
      const normaId = String(binds[0]);
      state.fts = state.fts.filter((f) => f.norma_id !== normaId);
      return;
    }
    if (s.startsWith("DELETE FROM dispositivos WHERE norma_id")) {
      const normaId = String(binds[0]);
      for (const [id, d] of state.dispositivos.entries()) {
        if (d.norma_id === normaId) state.dispositivos.delete(id);
      }
      return;
    }
    if (s.startsWith("DELETE FROM normas WHERE id")) {
      state.normas.delete(String(binds[0]));
      return;
    }
  }

  function runQuery(sql: string, binds: unknown[]): Record<string, unknown>[] {
    const s = sql.trim();
    if (s.startsWith("SELECT id FROM dispositivos WHERE norma_id")) {
      const normaId = String(binds[0]);
      return Array.from(state.dispositivos.values())
        .filter((d) => d.norma_id === normaId)
        .map((d) => ({ id: d.id }));
    }
    return [];
  }

  const db = {
    state,
    get batchCount(): number {
      return counters.batchCount;
    },
    prepare(sql: string): D1PreparedStatement {
      return makeStatement(sql);
    },
    async batch(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
      counters.batchCount += 1;
      const results: D1Result[] = [];
      for (const stmt of stmts) {
        results.push(await stmt.run());
      }
      return results;
    },
    async exec(_sql: string): Promise<D1ExecResult> {
      return { count: 0, duration: 0 } as unknown as D1ExecResult;
    },
    dump: undefined,
  } as unknown as FakeD1Database;
  return db;
}

// ============================================================================
// Env helpers
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
 * Variante de `createTestEnv()` com TODOS os bindings ativos (in-memory).
 * Use nos testes do orchestrator/pipeline que tocam R2/D1/Vectorize/AI.
 *
 * Também define `INGESTION_API_SECRET` para evitar que o teste exploda em
 * "INGESTION_API_SECRET não configurado".
 */
export function createPipelineEnv(): Env & {
  AI: FakeAi;
  R2_LEIS: FakeR2Bucket;
  R2_SKILLS: FakeR2Bucket;
  DB: FakeD1Database;
  VECTORIZE: FakeVectorize;
} {
  return {
    AI: createFakeAi(),
    VECTORIZE: createFakeVectorize(),
    R2_LEIS: createFakeR2Bucket(),
    R2_SKILLS: createFakeR2Bucket(),
    DB: createFakeD1(),
    CACHE: createFakeKv(),
    INGESTION_API_SECRET: "test-secret",
  } as Env & {
    AI: FakeAi;
    R2_LEIS: FakeR2Bucket;
    R2_SKILLS: FakeR2Bucket;
    DB: FakeD1Database;
    VECTORIZE: FakeVectorize;
  };
}

/**
 * `ExecutionContext` simulado — `waitUntil` / `passThroughOnException` são
 * no-ops nos testes.
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
