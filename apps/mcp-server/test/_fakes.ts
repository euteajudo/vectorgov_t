/**
 * Fakes mínimos dos bindings Cloudflare usados pelo Worker em ambiente
 * de teste (vitest rodando em Node puro).
 *
 * Combina as APIs introduzidas pelas Tracks D (tools MCP de leis), E (skills)
 * e G (pipeline de ingestão):
 *
 *   - **KV** (`createFakeKv`) — store in-memory simples.
 *   - **AI** (`createFakeAi`) — embedding bge-m3 determinístico + reranker stub,
 *     com state introspectável (callCount, failOnCalls, textsSeen) e overrides
 *     opcionais (embedding fixo, responses por modelo).
 *   - **Vectorize** (`createFakeVectorize`) — upsert/deleteByIds com state +
 *     query stub configurável (matches).
 *   - **R2** — duas APIs:
 *       - `createFakeR2()` → FakeR2 com `__snapshot()`/`__seed()` (Track E, mais
 *         rica; usada pelas skills tools)
 *       - `createFakeR2Bucket()` → FakeR2Bucket com `store`/`putCount`/`deleteCount`
 *         (Track G; usada pelo pipeline orchestrator)
 *   - **D1** (`createFakeD1`) — duas modalidades:
 *       - sem opts → motor com state interno (state.normas, state.dispositivos,
 *         state.versoes, state.fts) — usado pelo pipeline
 *       - `{ rules }` → rule-based (regex/substring → rows) — usado por tools
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
// AI (Workers AI) — unificado D+G
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

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

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
// Vectorize — unificado D+G
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
// R2 (versão Track E — rica, com __snapshot/__seed)
// ============================================================================

/**
 * Fake mínimo de bucket R2 — armazena `string` na memória.
 *
 * Suporta a superfície usada pelo subsistema de skills:
 *   - `put(key, value, opts?)` — value pode ser string.
 *   - `get(key)` — devolve objeto com `text()`, `json()`, ou `null`.
 *   - `head(key)` — devolve metadados (ou `null`).
 *   - `list({ prefix, cursor, limit })` — listagem paginada simples.
 *   - `delete(key | string[])` — remove um ou vários objetos.
 *   - `__snapshot()` — snapshot dict para asserts.
 *   - `__seed(entries)` — pre-popula bucket sem chamar `put`.
 */
export interface FakeR2 extends R2Bucket {
  __snapshot(): Record<string, string>;
  __seed(entries: Record<string, string>): void;
}

export function createFakeR2(initial: Record<string, unknown> = {}): FakeR2 {
  const store = new Map<
    string,
    { body: string; metadata: Record<string, string> }
  >();

  // Compatibilidade com Track D: aceita dict inicial (valor pode ser
  // string ou objeto JSON-serializável).
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, {
      body: typeof v === "string" ? v : JSON.stringify(v),
      metadata: {},
    });
  }

  function makeObject(key: string, raw: string): R2ObjectBody {
    return {
      key,
      version: "v1",
      size: raw.length,
      etag: `etag-${key}`,
      httpEtag: `"etag-${key}"`,
      checksums: {
        toJSON: () => ({}),
      } as R2Checksums,
      uploaded: new Date(),
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: store.get(key)?.metadata ?? {},
      range: undefined,
      storageClass: "Standard",
      ssecKeyMd5: undefined,
      writeHttpMetadata(_h: Headers): void {
        /* no-op */
      },
      async text(): Promise<string> {
        return raw;
      },
      async json<T>(): Promise<T> {
        return JSON.parse(raw) as T;
      },
      async arrayBuffer(): Promise<ArrayBuffer> {
        return new TextEncoder().encode(raw).buffer as ArrayBuffer;
      },
      async blob(): Promise<Blob> {
        return new Blob([raw]);
      },
      async bytes(): Promise<Uint8Array> {
        return new TextEncoder().encode(raw);
      },
      body: new ReadableStream<Uint8Array>({
        start(controller): void {
          controller.enqueue(new TextEncoder().encode(raw));
          controller.close();
        },
      }),
      bodyUsed: false,
    } as unknown as R2ObjectBody;
  }

  const bucket: Partial<FakeR2> = {
    async head(key: string): Promise<R2Object | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return makeObject(key, entry.body) as unknown as R2Object;
    },
    async get(key: string): Promise<R2ObjectBody | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return makeObject(key, entry.body);
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
      opts?: R2PutOptions,
    ): Promise<R2Object> {
      if (typeof value !== "string") {
        throw new Error("FakeR2.put: apenas string suportada em testes");
      }
      const metadata =
        (opts as { customMetadata?: Record<string, string> } | undefined)
          ?.customMetadata ?? {};
      store.set(key, { body: value, metadata });
      return makeObject(key, value) as unknown as R2Object;
    },
    async list(opts?: R2ListOptions): Promise<R2Objects> {
      const prefix = opts?.prefix ?? "";
      const limit = opts?.limit ?? 1000;
      const all = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .sort();
      const cursor = opts?.cursor ? Number.parseInt(opts.cursor, 10) : 0;
      const slice = all.slice(cursor, cursor + limit);
      const objects = slice.map(
        (k) => makeObject(k, store.get(k)!.body) as unknown as R2Object,
      );
      const truncated = cursor + slice.length < all.length;
      return {
        objects,
        truncated,
        cursor: truncated ? String(cursor + slice.length) : undefined,
        delimitedPrefixes: [],
      } as unknown as R2Objects;
    },
    async delete(keys: string | string[]): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) store.delete(k);
    },
    __snapshot(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const [k, v] of store) out[k] = v.body;
      return out;
    },
    __seed(entries: Record<string, string>): void {
      for (const [k, v] of Object.entries(entries)) {
        store.set(k, { body: v, metadata: {} });
      }
    },
  };
  return bucket as FakeR2;
}

// ============================================================================
// R2 (versão Track G — com state byteArray, usada pelo pipeline)
// ============================================================================

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
// D1 — unificado D (rule-based) + G (state)
// ============================================================================

export interface FakeD1Options {
  /**
   * Lista de "regras": cada regra casa por substring no SQL e devolve linhas.
   * Quando dado, usa o motor rule-based (Track D).
   * Quando ausente, usa o motor com state (Track G).
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

  // Modo com state (Track G)
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
      const [dispositivo_id, norma_id, artigo, paragrafo, hierarquia, texto] = binds;
      state.fts.push({ dispositivo_id, norma_id, artigo, paragrafo, hierarquia, texto });
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
  VECTORIZE_CATMAT?: VectorizeIndex;
  R2_LEIS?: R2Bucket;
  R2_SKILLS?: R2Bucket;
  DB?: D1Database;
  CACHE?: KVNamespace;
}

/**
 * Monta um `Env` de teste com KV + R2_SKILLS reais (in-memory) e demais
 * bindings inertes.
 *
 * Passe `overrides` para configurar individualmente (ex.: ao testar
 * tools que falam com R2_LEIS/D1/AI/VECTORIZE).
 */
export function createTestEnv(overrides: TestEnvOverrides = {}): Env {
  return {
    AI: overrides.AI ?? unusedBinding<Ai>("AI"),
    VECTORIZE: overrides.VECTORIZE ?? unusedBinding<VectorizeIndex>("VECTORIZE"),
    VECTORIZE_CATMAT: overrides.VECTORIZE_CATMAT,
    R2_LEIS: overrides.R2_LEIS ?? unusedBinding<R2Bucket>("R2_LEIS"),
    R2_SKILLS: overrides.R2_SKILLS ?? createFakeR2(),
    DB: overrides.DB ?? unusedBinding<D1Database>("DB"),
    CACHE: overrides.CACHE ?? createFakeKv(),
    NOTEBOOK_AGENT: unusedBinding<DurableObjectNamespace>("NOTEBOOK_AGENT"),
    SESSION_AGENT: unusedBinding<DurableObjectNamespace>("SESSION_AGENT"),
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
