/**
 * Fakes mínimos dos bindings usados pelo Worker do catálogo em teste (vitest
 * em Node puro) — versão enxuta do padrão do mcp-server.
 *
 * O D1 fake aceita regras com `rows` fixas OU `resolver(sql, binds)` — o
 * resolver permite reagir à expressão MATCH bindada (necessário para testar o
 * fallback AND→OR, que muda só o bind, não o SQL).
 */
import type { Env } from "../src/env.js";

// ============================================================================
// D1 (rule-based)
// ============================================================================

export interface RegraD1 {
  match: string | RegExp;
  rows?: unknown[];
  /** Alternativa dinâmica: recebe o SQL e os binds e decide as linhas. */
  resolver?: (sql: string, binds: unknown[]) => unknown[];
}

export function createFakeD1(opts: { regras: RegraD1[] }): D1Database {
  function resolveRows(sql: string, binds: unknown[]): unknown[] {
    for (const r of opts.regras) {
      const bateu =
        typeof r.match === "string" ? sql.includes(r.match) : r.match.test(sql);
      if (!bateu) continue;
      return r.resolver ? r.resolver(sql, binds) : (r.rows ?? []);
    }
    return [];
  }
  const db = {
    prepare(sql: string) {
      const bound: unknown[] = [];
      const prepared = {
        bind(...args: unknown[]) {
          bound.push(...args);
          return prepared;
        },
        async first<T>(): Promise<T | null> {
          const rows = resolveRows(sql, bound);
          return (rows[0] as T | undefined) ?? null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: resolveRows(sql, bound) as T[] };
        },
        async run(): Promise<{ success: true }> {
          return { success: true };
        },
      };
      return prepared as unknown as D1PreparedStatement;
    },
  };
  return db as unknown as D1Database;
}

// ============================================================================
// Workers AI (embedding determinístico)
// ============================================================================

export interface FakeAi extends Ai {
  /** Textos enviados ao embedding — para asserções sobre expansão de query. */
  textsSeen: string[][];
}

export function createFakeAi(): FakeAi {
  const textsSeen: string[][] = [];
  const ai = {
    textsSeen,
    async run(_model: string, input: { text?: string[] }): Promise<unknown> {
      const texts = input.text ?? [];
      textsSeen.push(texts);
      return { data: texts.map(() => new Array(1024).fill(0.1)) };
    },
  };
  return ai as unknown as FakeAi;
}

// ============================================================================
// Vectorize
// ============================================================================

export function createFakeVectorize(opts: {
  matches?: Array<{ id: string; score: number; metadata: Record<string, unknown> }>;
  /** Vetores devolvidos por getByIds (raio-X do inspetor). */
  byId?: Record<string, { metadata: Record<string, unknown> }>;
  /** Simula falha da lane semântica (trace do inspetor). */
  queryThrows?: boolean;
}): VectorizeIndex {
  const idx = {
    async query(): Promise<{ matches: unknown[] }> {
      if (opts.queryThrows) throw new Error("vectorize indisponível (fake)");
      return { matches: opts.matches ?? [] };
    },
    async getByIds(ids: string[]): Promise<unknown[]> {
      return ids
        .filter((id) => opts.byId?.[id])
        .map((id) => ({ id, metadata: opts.byId![id]!.metadata }));
    },
    async describe(): Promise<unknown> {
      return { vectorCount: 42, processedUpToDatetime: "2026-07-17T00:00:00Z" };
    },
  };
  return idx as unknown as VectorizeIndex;
}

// ============================================================================
// Env
// ============================================================================

/** Binding não configurado explode no acesso — deixa vazamento de dependência claro. */
function unusedBinding(nome: string): unknown {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`binding '${nome}' não configurado neste teste`);
      },
    },
  );
}

export function createTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: (overrides.AI ?? unusedBinding("AI")) as Ai,
    VECTORIZE_CATMAT: (overrides.VECTORIZE_CATMAT ??
      unusedBinding("VECTORIZE_CATMAT")) as VectorizeIndex,
    DB: (overrides.DB ?? unusedBinding("DB")) as D1Database,
    COHERE_API_KEY: overrides.COHERE_API_KEY,
    COHERE_RERANK_MODEL: overrides.COHERE_RERANK_MODEL,
    CATALOGO_ADMIN_KEY: overrides.CATALOGO_ADMIN_KEY,
  };
}
