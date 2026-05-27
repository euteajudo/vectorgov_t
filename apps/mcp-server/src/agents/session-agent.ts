/**
 * SessionAgent — Durable Object com persistência SQL.
 *
 * Estratégia (F2.F.1): usamos `DurableObject<Env>` direto (não a classe
 * `Agent` do package `agents`), pois:
 *
 *  1. Não há acesso à API Google ainda → não tem por que arrastar a
 *     dependência completa do framework Agents.
 *  2. A persistência local (SQL) cobre o requisito atual de manter
 *     histórico de petições / pareceres / conversas por usuário.
 *  3. Quando integrarmos com o framework Agents (Fase 3+), basta trocar
 *     `extends DurableObject` por `extends Agent` — o storage SQL fica
 *     compatível.
 *
 * Schema SQL (aplicado on-demand em `garantirSchema`):
 *
 *   peticoes_analisadas
 *     - id TEXT PK
 *     - peticao_json TEXT NOT NULL
 *     - analise_json TEXT NOT NULL
 *     - criado_em INTEGER NOT NULL   -- epoch ms
 *
 *   pareceres_gerados
 *     - id TEXT PK
 *     - analise_id TEXT NOT NULL FK
 *     - parecer_json TEXT NOT NULL
 *     - criado_em INTEGER NOT NULL
 *
 *   conversas_recentes
 *     - id TEXT PK
 *     - role TEXT NOT NULL ('user'|'assistant')
 *     - content TEXT NOT NULL
 *     - criado_em INTEGER NOT NULL
 *
 * O SessionAgent NÃO orquestra agentes — ele é apenas a casca persistente.
 * O motor PEVS (`pevs-engine.ts`) é quem orquestra os papéis e usa o
 * SessionAgent como storage.
 *
 * Wrangler binding (a configurar manualmente em wrangler.toml depois):
 *
 *   [[durable_objects.bindings]]
 *   name = "SESSION_AGENT"
 *   class_name = "SessionAgent"
 *
 *   [[migrations]]
 *   tag = "v1-session-agent"
 *   new_sqlite_classes = ["SessionAgent"]
 */
import type { Env } from "../env.js";
import {
  PeticaoSchema,
  type Peticao,
  AnaliseReequilibrioSchema,
  type AnaliseReequilibrio,
  ParecerSchema,
  type Parecer,
} from "@vectorgov-t/schemas";

/**
 * Estado mínimo persistido em storage convencional do DO.
 *
 * Usamos storage SQL para os dados ricos (queries por timestamp, joins
 * leves) e storage chave-valor APENAS para flags de bootstrap (ex.:
 * `schema_aplicado`). Isso evita recriar/checar tabelas a cada request.
 */
const STORAGE_FLAG_SCHEMA = "schema_aplicado_v1";

/**
 * Estrutura simplificada de uma entrada do histórico (output de
 * `listarHistorico`).
 */
export interface EntradaHistorico {
  peticao_id: string;
  analise_id: string;
  veredito: AnaliseReequilibrio["veredito"];
  score_confianca: number;
  criado_em: number;
  tem_parecer: boolean;
  parecer_id: string | null;
}

/**
 * Interface mínima da camada de storage SQL que SessionAgent precisa.
 *
 * Em produção isso é `DurableObjectState.storage.sql` (Cloudflare SQL
 * Storage). Aceitamos uma interface aqui para que os testes possam
 * fornecer uma implementação em memória (better-sqlite3 ou shim simples)
 * sem precisar do runtime do Workers.
 */
export interface StorageSQL {
  exec(query: string, ...bindings: unknown[]): {
    toArray(): Array<Record<string, unknown>>;
    rowsWritten?: number;
  };
}

/**
 * Interface mínima da camada de storage KV do DO.
 */
export interface StorageKV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

/**
 * Estado abstrato do Durable Object (apenas o que usamos).
 *
 * O tipo real do Workers (`DurableObjectState`) tem mais coisa, mas
 * só consumimos `storage.sql` (SQL) e `storage` (KV). Manter a
 * interface enxuta facilita o teste sem Workers runtime.
 */
export interface SessionAgentState {
  storage: StorageKV & { sql: StorageSQL };
}

/**
 * SessionAgent — Durable Object com SQL storage.
 *
 * Nota sobre `extends`: usamos `DurableObject<Env>` quando rodando em
 * Workers; em testes, instanciamos a classe diretamente passando um
 * `SessionAgentState` mockado e o `Env`. O construtor aceita ambos.
 *
 * Para evitar dependência rígida da classe base do Workers (que vem do
 * `cloudflare:workers` module), aceitamos `state` por tipo estrutural.
 * Quando exportarmos para o Worker, o runtime do CF cuida da herança.
 */
export class SessionAgent {
  private readonly state: SessionAgentState;
  private readonly env: Env;
  private schemaProntoPromise: Promise<void> | null = null;

  constructor(state: SessionAgentState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Aplica o schema SQL se ainda não foi aplicado. Idempotente — pode
   * ser chamado antes de toda operação de leitura/escrita.
   *
   * Persistimos uma flag em storage KV para evitar `CREATE TABLE IF NOT
   * EXISTS` desnecessário em cada chamada — embora seja barato, manter
   * o caminho rápido reduz latência percebida.
   */
  private async garantirSchema(): Promise<void> {
    if (this.schemaProntoPromise) return this.schemaProntoPromise;
    this.schemaProntoPromise = (async () => {
      const flag = await this.state.storage.get<boolean>(STORAGE_FLAG_SCHEMA);
      if (flag === true) return;
      this.state.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS peticoes_analisadas (
           id TEXT PRIMARY KEY,
           peticao_json TEXT NOT NULL,
           analise_json TEXT NOT NULL,
           veredito TEXT NOT NULL,
           score_confianca REAL NOT NULL,
           criado_em INTEGER NOT NULL
         );`,
      );
      this.state.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_peticoes_criado_em
           ON peticoes_analisadas(criado_em DESC);`,
      );
      this.state.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS pareceres_gerados (
           id TEXT PRIMARY KEY,
           analise_id TEXT NOT NULL,
           parecer_json TEXT NOT NULL,
           criado_em INTEGER NOT NULL,
           FOREIGN KEY (analise_id) REFERENCES peticoes_analisadas(id)
         );`,
      );
      this.state.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_pareceres_analise
           ON pareceres_gerados(analise_id);`,
      );
      this.state.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS conversas_recentes (
           id TEXT PRIMARY KEY,
           role TEXT NOT NULL CHECK (role IN ('user','assistant')),
           content TEXT NOT NULL,
           criado_em INTEGER NOT NULL
         );`,
      );
      this.state.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_conversas_criado_em
           ON conversas_recentes(criado_em DESC);`,
      );
      await this.state.storage.put(STORAGE_FLAG_SCHEMA, true);
    })();
    return this.schemaProntoPromise;
  }

  /**
   * Persiste uma análise (par petição + análise) — chamado pelo PEVS
   * engine no fim do Feature 1.
   *
   * Valida ambos os schemas Zod antes de gravar para evitar inserir
   * JSON corrupto no SQL (que apareceria como erro de runtime mais
   * adiante).
   */
  async analisarPeticao(
    peticao: Peticao,
    analise: AnaliseReequilibrio,
  ): Promise<void> {
    await this.garantirSchema();
    const peticaoOk = PeticaoSchema.parse(peticao);
    const analiseOk = AnaliseReequilibrioSchema.parse(analise);
    if (peticaoOk.id && analiseOk.peticao_id !== peticaoOk.id) {
      throw new Error(
        `analisarPeticao: analise.peticao_id (${analiseOk.peticao_id}) ` +
          `não bate com peticao.id (${peticaoOk.id})`,
      );
    }
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO peticoes_analisadas
         (id, peticao_json, analise_json, veredito, score_confianca, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
      analiseOk.id,
      JSON.stringify(peticaoOk),
      JSON.stringify(analiseOk),
      analiseOk.veredito,
      analiseOk.score_confianca,
      Date.now(),
    );
  }

  /**
   * Persiste um parecer gerado a partir de uma análise existente.
   * Falha se a análise referenciada não estiver no storage.
   */
  async gerarParecer(parecer: Parecer): Promise<void> {
    await this.garantirSchema();
    const parecerOk = ParecerSchema.parse(parecer);
    const analiseExiste = this.state.storage.sql
      .exec(
        `SELECT id FROM peticoes_analisadas WHERE id = ? LIMIT 1`,
        parecerOk.analise_id,
      )
      .toArray();
    if (analiseExiste.length === 0) {
      throw new Error(
        `gerarParecer: análise ${parecerOk.analise_id} não encontrada no SessionAgent`,
      );
    }
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO pareceres_gerados
         (id, analise_id, parecer_json, criado_em)
       VALUES (?, ?, ?, ?)`,
      parecerOk.id,
      parecerOk.analise_id,
      JSON.stringify(parecerOk),
      Date.now(),
    );
  }

  /**
   * Lista o histórico (paginado) do usuário desta sessão.
   *
   *  - `limit` clampado em [1, 100] para evitar consultas absurdas.
   *  - Faz LEFT JOIN com pareceres para indicar se cada análise já
   *    tem parecer gerado.
   */
  async listarHistorico(limit = 20): Promise<EntradaHistorico[]> {
    await this.garantirSchema();
    const limitClamp = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = this.state.storage.sql
      .exec(
        `SELECT
           p.id           AS analise_id,
           p.veredito     AS veredito,
           p.score_confianca AS score_confianca,
           p.criado_em    AS criado_em,
           p.peticao_json AS peticao_json,
           pa.id          AS parecer_id
         FROM peticoes_analisadas p
         LEFT JOIN pareceres_gerados pa ON pa.analise_id = p.id
         ORDER BY p.criado_em DESC
         LIMIT ?`,
        limitClamp,
      )
      .toArray();
    return rows.map((r) => {
      const peticaoJson = r["peticao_json"];
      let peticaoId = "";
      if (typeof peticaoJson === "string") {
        try {
          const parsed = JSON.parse(peticaoJson) as { id?: string };
          peticaoId = parsed.id ?? "";
        } catch {
          peticaoId = "";
        }
      }
      return {
        peticao_id: peticaoId,
        analise_id: String(r["analise_id"] ?? ""),
        veredito: r["veredito"] as AnaliseReequilibrio["veredito"],
        score_confianca: Number(r["score_confianca"] ?? 0),
        criado_em: Number(r["criado_em"] ?? 0),
        tem_parecer: r["parecer_id"] !== null && r["parecer_id"] !== undefined,
        parecer_id: r["parecer_id"] ? String(r["parecer_id"]) : null,
      };
    });
  }

  /**
   * Recupera uma análise específica por ID. Devolve `null` se não existir.
   */
  async carregarAnalise(
    analiseId: string,
  ): Promise<{ peticao: Peticao; analise: AnaliseReequilibrio } | null> {
    await this.garantirSchema();
    const rows = this.state.storage.sql
      .exec(
        `SELECT peticao_json, analise_json
         FROM peticoes_analisadas
         WHERE id = ? LIMIT 1`,
        analiseId,
      )
      .toArray();
    if (rows.length === 0) return null;
    const row = rows[0]!;
    const peticao = PeticaoSchema.parse(JSON.parse(String(row["peticao_json"])));
    const analise = AnaliseReequilibrioSchema.parse(
      JSON.parse(String(row["analise_json"])),
    );
    return { peticao, analise };
  }

  /**
   * Recupera um parecer específico por ID. Devolve `null` se não existir.
   */
  async carregarParecer(parecerId: string): Promise<Parecer | null> {
    await this.garantirSchema();
    const rows = this.state.storage.sql
      .exec(
        `SELECT parecer_json FROM pareceres_gerados WHERE id = ? LIMIT 1`,
        parecerId,
      )
      .toArray();
    if (rows.length === 0) return null;
    return ParecerSchema.parse(JSON.parse(String(rows[0]!["parecer_json"])));
  }

  /**
   * Grava uma turn de conversa (texto livre) — usada para histórico
   * de chat antes da execução do PEVS.
   */
  async registrarConversa(
    id: string,
    role: "user" | "assistant",
    content: string,
  ): Promise<void> {
    await this.garantirSchema();
    this.state.storage.sql.exec(
      `INSERT INTO conversas_recentes (id, role, content, criado_em)
       VALUES (?, ?, ?, ?)`,
      id,
      role,
      content,
      Date.now(),
    );
  }

  /**
   * Recupera últimas N mensagens em ordem cronológica ascendente
   * (mais antiga primeiro).
   */
  async ultimasConversas(
    n = 10,
  ): Promise<Array<{ id: string; role: "user" | "assistant"; content: string; criado_em: number }>> {
    await this.garantirSchema();
    const clamp = Math.max(1, Math.min(200, Math.trunc(n)));
    // Buscamos DESC + reordenamos no JS para devolver ASC (mais antiga primeiro).
    const rows = this.state.storage.sql
      .exec(
        `SELECT id, role, content, criado_em
         FROM conversas_recentes
         ORDER BY criado_em DESC
         LIMIT ?`,
        clamp,
      )
      .toArray();
    return rows
      .map((r) => ({
        id: String(r["id"]),
        role: r["role"] as "user" | "assistant",
        content: String(r["content"]),
        criado_em: Number(r["criado_em"]),
      }))
      .reverse();
  }

  /**
   * Acesso somente-leitura ao Env (útil para outros componentes do DO
   * que precisem dos bindings).
   */
  protected getEnv(): Env {
    return this.env;
  }
}
