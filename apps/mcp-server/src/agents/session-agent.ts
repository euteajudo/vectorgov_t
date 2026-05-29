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
import { PEVSEngine } from "./pevs-engine.js";
import { GoogleLLMClient } from "./llm/google.js";
import { getModelConfig } from "../lib/model-config.js";
import { buildToolsForPEVS } from "./tools-adapter.js";

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
 * só consumimos `storage.sql` (SQL), `storage` (KV) e `setAlarm`/`getAlarm`
 * (para rodar o pipeline PEVS em background sem o limite do `ctx.waitUntil`).
 * Manter a interface enxuta facilita o teste sem Workers runtime.
 */
export interface SessionAgentState {
  storage: StorageKV & {
    sql: StorageSQL;
    setAlarm?(scheduledTime: number | Date): Promise<void> | void;
    getAlarm?(): Promise<number | null>;
  };
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
      // Fila de jobs de análise PEVS rodados em background via alarm.
      // `api_key` é armazenada TRANSIENTEMENTE (apagada ao concluir o job)
      // porque o alarm roda fora do contexto da request que trouxe a key.
      this.state.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS analise_jobs (
           record_id TEXT PRIMARY KEY,
           peticao_json TEXT NOT NULL,
           api_key TEXT NOT NULL,
           status TEXT NOT NULL DEFAULT 'pendente',
           criado_em INTEGER NOT NULL
         );`,
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

  // ==========================================================================
  // Background PEVS via alarm — escapa o limite do `ctx.waitUntil` do Worker.
  // ==========================================================================

  /**
   * Enfileira um job de análise PEVS e agenda o alarm pra rodá-lo
   * imediatamente. Retorna assim que persiste o job (não espera o pipeline).
   *
   * A `apiKey` é gravada na linha do job — é apagada quando o job termina
   * (ver `processarJob`). Transiente por design.
   */
  async agendarAnalise(
    recordId: string,
    peticao: Peticao,
    apiKey: string,
  ): Promise<void> {
    await this.garantirSchema();
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO analise_jobs
         (record_id, peticao_json, api_key, status, criado_em)
       VALUES (?, ?, ?, 'pendente', ?)`,
      recordId,
      JSON.stringify(peticao),
      apiKey,
      Date.now(),
    );
    // Dispara o alarm pra agora. Se já houver um agendado, não sobrescreve
    // o passado (setAlarm com horário <= agora roda assim que possível).
    if (this.state.storage.setAlarm) {
      await this.state.storage.setAlarm(Date.now());
    }
  }

  /**
   * Atualiza o registro de status da petição no KV (`peticao:<id>`),
   * lido pelo polling da UI. Mescla com o registro existente.
   */
  private async atualizarRecordKV(
    recordId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const chave = `peticao:${recordId}`;
    let atual: Record<string, unknown> = {};
    const raw = await this.env.CACHE.get(chave);
    if (raw) {
      try {
        atual = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        atual = {};
      }
    }
    const novo = {
      ...atual,
      ...patch,
      atualizado_em: new Date().toISOString(),
    };
    await this.env.CACHE.put(chave, JSON.stringify(novo), {
      expirationTtl: 24 * 60 * 60,
    });
  }

  /**
   * Handler de alarm do DO. Processa todos os jobs pendentes em sequência.
   * Erros de um job não bloqueiam os demais. Cloudflare re-dispara o alarm
   * automaticamente se este handler lançar — por isso capturamos por job.
   */
  async alarm(): Promise<void> {
    await this.garantirSchema();
    const pendentes = this.state.storage.sql
      .exec(
        `SELECT record_id, peticao_json, api_key
           FROM analise_jobs WHERE status = 'pendente'
           ORDER BY criado_em ASC`,
      )
      .toArray();

    for (const row of pendentes) {
      const recordId = String(row["record_id"]);
      const apiKey = String(row["api_key"]);
      // Marca em processamento antes de rodar (evita reprocesso se o alarm
      // re-disparar enquanto este job ainda corre).
      this.state.storage.sql.exec(
        `UPDATE analise_jobs SET status = 'processando' WHERE record_id = ?`,
        recordId,
      );
      try {
        const peticao = PeticaoSchema.parse(
          JSON.parse(String(row["peticao_json"])),
        );
        await this.processarJob(recordId, peticao, apiKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.atualizarRecordKV(recordId, { fase: "failed", erro: msg });
      } finally {
        // Apaga o job (e a apiKey) — terminal, sucesso ou falha.
        this.state.storage.sql.exec(
          `DELETE FROM analise_jobs WHERE record_id = ?`,
          recordId,
        );
      }
    }
  }

  /**
   * Roda o PEVS Feature 1 pra um job. Atualiza o KV a cada fase.
   * Como roda DENTRO do DO, `this` é o próprio SessionAgent — o engine
   * persiste a análise via `analisarPeticao` sem hop de rede.
   */
  private async processarJob(
    recordId: string,
    peticao: Peticao,
    apiKey: string,
  ): Promise<void> {
    const llm = new GoogleLLMClient(apiKey);
    const cfg = await getModelConfig(this.env);
    const tools = buildToolsForPEVS(this.env);
    const engine = new PEVSEngine({
      llm,
      sessionAgent: this,
      tools,
      modelos: cfg.modelos,
      onFase: async (fase, pct, extra) => {
        await this.atualizarRecordKV(recordId, {
          fase,
          progresso_pct: pct,
          ...(extra && typeof extra === "object" ? extra : {}),
        });
      },
    });
    const { analise } = await engine.executarFeature1(peticao);
    await this.atualizarRecordKV(recordId, {
      fase: "done",
      progresso_pct: 100,
      analise,
    });
  }

  /**
   * Handler HTTP do DO. Roteamento interno usado pelo `session-loader`
   * (cliente do Worker pro DO).
   *
   *   POST /analisar-peticao   { peticao, analise }
   *   POST /gerar-parecer      { parecer }
   *   POST /registrar-conversa { id, role, content }
   *   GET  /historico?limit=
   *   GET  /analise?id=
   *   GET  /parecer?id=
   *   GET  /conversas?n=
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    try {
      if (request.method === "POST" && pathname === "/agendar-analise") {
        const body = (await request.json()) as {
          record_id: string;
          peticao: Peticao;
          api_key: string;
        };
        await this.agendarAnalise(body.record_id, body.peticao, body.api_key);
        return Response.json({ ok: true, agendado: true });
      }
      if (request.method === "POST" && pathname === "/analisar-peticao") {
        const body = (await request.json()) as {
          peticao: Peticao;
          analise: AnaliseReequilibrio;
        };
        await this.analisarPeticao(body.peticao, body.analise);
        return Response.json({ ok: true });
      }
      if (request.method === "POST" && pathname === "/gerar-parecer") {
        const body = (await request.json()) as { parecer: Parecer };
        await this.gerarParecer(body.parecer);
        return Response.json({ ok: true });
      }
      if (request.method === "POST" && pathname === "/registrar-conversa") {
        const body = (await request.json()) as {
          id: string;
          role: "user" | "assistant";
          content: string;
        };
        await this.registrarConversa(body.id, body.role, body.content);
        return Response.json({ ok: true });
      }
      if (request.method === "GET" && pathname === "/historico") {
        const limit = Number(url.searchParams.get("limit") ?? 20);
        const hist = await this.listarHistorico(limit);
        return Response.json({ historico: hist });
      }
      if (request.method === "GET" && pathname === "/analise") {
        const id = url.searchParams.get("id") ?? "";
        const res = await this.carregarAnalise(id);
        return Response.json(res ?? null);
      }
      if (request.method === "GET" && pathname === "/parecer") {
        const id = url.searchParams.get("id") ?? "";
        const res = await this.carregarParecer(id);
        return Response.json(res ?? null);
      }
      if (request.method === "GET" && pathname === "/conversas") {
        const n = Number(url.searchParams.get("n") ?? 10);
        const msgs = await this.ultimasConversas(n);
        return Response.json({ conversas: msgs });
      }
      return new Response(`Not found: ${pathname}`, { status: 404 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 500 });
    }
  }
}
