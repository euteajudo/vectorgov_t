/**
 * NotebookAgent — Durable Object por notebook (chat estilo NotebookLM).
 *
 * Cada instância tem 1 documento PDF anexado e N mensagens de conversa.
 * Estado fica em storage SQL do DO. Embeddings de chunks são gerados
 * sob demanda na primeira busca semântica.
 *
 * Bindings (wrangler.toml):
 *
 *   [[durable_objects.bindings]]
 *   name = "NOTEBOOK_AGENT"
 *   class_name = "NotebookAgent"
 *
 *   [[migrations]]
 *   tag = "v2-notebook-agent"
 *   new_sqlite_classes = ["NotebookAgent"]
 *
 * Roteamento HTTP interno (chamado via stub.fetch(internalUrl, init)):
 *
 *   POST /criar              -> {titulo?} -> NotebookMeta
 *   GET  /meta               -> NotebookMeta
 *   POST /anexar             -> {documento_nome, pages, pdf_hash} -> UploadDocumentoOutput
 *   GET  /mensagens          -> Mensagem[]
 *   GET  /chat               -> Upgrade WebSocket
 *
 * Não exposto externamente — o Worker MCP é o frontend.
 */
import type { Env } from "../env.js";
import type {
  ChatClientEvent,
  ChatEvent,
  Mensagem,
  NotebookMeta,
  ToolCall,
  UploadDocumentoOutput,
} from "@vectorgov-t/schemas";
import {
  ChatClientEventSchema,
  CriarNotebookInputSchema,
  MensagemSchema,
  NotebookMetaSchema,
} from "@vectorgov-t/schemas";
import { embedBatch } from "../lib/batch-embedding.js";
import { criarGoogleLLM } from "./llm/google.js";
import { conversar } from "./conversational/engine.js";

const STORAGE_FLAG_SCHEMA = "schema_aplicado_v1";

/**
 * Página de um documento — texto cru extraído pelo Container Python.
 */
export interface NotebookPagina {
  n: number;
  text: string;
}

/**
 * Chunk consultável (~600 tokens) com possível embedding.
 */
interface ChunkRow {
  id: string;
  texto: string;
  pagina_inicio: number;
  pagina_fim: number;
  /** Vetor 1024-dim serializado como Float32Array em BLOB. null se ainda não embeddado. */
  embedding: Float32Array | null;
}

/**
 * Resultado de busca semântica.
 */
export interface BuscaChunkResult {
  texto: string;
  pagina_inicio: number;
  pagina_fim: number;
  score: number;
}

/**
 * Estado abstrato do DO — interface estrutural (igual ao SessionAgent
 * mas em escopo local pra evitar colisão de export).
 */
interface SQL {
  exec(
    query: string,
    ...bindings: unknown[]
  ): {
    toArray(): Array<Record<string, unknown>>;
    rowsWritten?: number;
  };
}

interface KV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

export interface NotebookAgentState {
  storage: KV & { sql: SQL };
  /** ID estável do DO — usado como notebook_id. */
  id: { toString(): string };
}

/**
 * Quebra o texto bruto em chunks de ~chars por chunk, respeitando quebras
 * de parágrafo quando possível. Mantém mapa pagina_inicio/pagina_fim.
 *
 * Estratégia simples: concatena páginas separadas por `\n\n--- pagina N ---\n\n`,
 * varre por janelas de `targetChars` quebrando em `\n\n` mais próximo, e
 * registra a primeira página e última página tocadas pelo chunk.
 */
function chunkifyPages(
  pages: NotebookPagina[],
  targetChars = 2400,
): Array<{ texto: string; pagina_inicio: number; pagina_fim: number }> {
  const result: Array<{
    texto: string;
    pagina_inicio: number;
    pagina_fim: number;
  }> = [];
  if (pages.length === 0) return result;

  // Constrói um array de spans (texto, pagina) preservando origem.
  type Span = { text: string; n: number };
  const spans: Span[] = [];
  for (const p of pages) {
    const blocks = p.text.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
    for (const b of blocks) spans.push({ text: b.trim(), n: p.n });
  }

  let buf: Span[] = [];
  let buflen = 0;
  for (const s of spans) {
    if (buflen + s.text.length + 2 > targetChars && buf.length > 0) {
      result.push({
        texto: buf.map((x) => x.text).join("\n\n"),
        pagina_inicio: buf[0]!.n,
        pagina_fim: buf[buf.length - 1]!.n,
      });
      buf = [];
      buflen = 0;
    }
    buf.push(s);
    buflen += s.text.length + 2;
  }
  if (buf.length > 0) {
    result.push({
      texto: buf.map((x) => x.text).join("\n\n"),
      pagina_inicio: buf[0]!.n,
      pagina_fim: buf[buf.length - 1]!.n,
    });
  }
  return result;
}

/**
 * Similaridade cosseno entre dois Float32Array de mesma dimensão.
 */
function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Serializa Float32Array como Uint8Array (view do mesmo buffer) — formato
 * compatível com BLOB do storage SQL do DO.
 */
function f32ToBytes(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

function bytesToF32(b: Uint8Array): Float32Array {
  // O storage devolve um Uint8Array — copiamos pra um ArrayBuffer próprio
  // pra garantir alinhamento de 4 bytes (Float32Array exige).
  const copy = new Uint8Array(b.length);
  copy.set(b);
  return new Float32Array(copy.buffer);
}

/**
 * NotebookAgent — corpo principal.
 *
 * Em testes, instanciamos passando `state` em formato estrutural + `env`.
 * No runtime, o Cloudflare runtime estende DurableObject e injeta o state real.
 */
export class NotebookAgent {
  private readonly state: NotebookAgentState;
  private readonly env: Env;
  private schemaProntoPromise: Promise<void> | null = null;

  constructor(state: NotebookAgentState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private get sql(): SQL {
    return this.state.storage.sql;
  }

  private notebookId(): string {
    return this.state.id.toString();
  }

  private async garantirSchema(): Promise<void> {
    if (this.schemaProntoPromise) return this.schemaProntoPromise;
    this.schemaProntoPromise = (async () => {
      const flag = await this.state.storage.get<boolean>(STORAGE_FLAG_SCHEMA);
      if (flag === true) return;
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS notebook (
           id TEXT PRIMARY KEY,
           titulo TEXT NOT NULL,
           documento_nome TEXT,
           documento_total_paginas INTEGER,
           documento_total_chars INTEGER,
           documento_pdf_hash TEXT,
           criado_em INTEGER NOT NULL,
           atualizado_em INTEGER NOT NULL
         );`,
      );
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS pagina (
           notebook_id TEXT NOT NULL,
           n INTEGER NOT NULL,
           texto TEXT NOT NULL,
           PRIMARY KEY (notebook_id, n)
         );`,
      );
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS chunk (
           id TEXT PRIMARY KEY,
           notebook_id TEXT NOT NULL,
           texto TEXT NOT NULL,
           pagina_inicio INTEGER NOT NULL,
           pagina_fim INTEGER NOT NULL,
           embedding BLOB
         );`,
      );
      this.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_chunk_notebook
           ON chunk(notebook_id);`,
      );
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS mensagem (
           id TEXT PRIMARY KEY,
           notebook_id TEXT NOT NULL,
           role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
           content TEXT NOT NULL,
           tool_calls TEXT NOT NULL DEFAULT '[]',
           modelo TEXT,
           tokens_total INTEGER,
           criado_em INTEGER NOT NULL
         );`,
      );
      this.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_mensagem_notebook_criado
           ON mensagem(notebook_id, criado_em ASC);`,
      );
      await this.state.storage.put(STORAGE_FLAG_SCHEMA, true);
    })();
    return this.schemaProntoPromise;
  }

  /**
   * Cria o registro do notebook (uma vez por DO). Idempotente — se já
   * existir, devolve a metadata atual.
   */
  async criar(input: { titulo?: string }): Promise<NotebookMeta> {
    await this.garantirSchema();
    const parsed = CriarNotebookInputSchema.parse(input);
    const id = this.notebookId();
    const agora = Date.now();
    const tituloDefault = parsed.titulo ?? "Notebook sem título";

    const existe = this.sql
      .exec(`SELECT id FROM notebook WHERE id = ? LIMIT 1`, id)
      .toArray();
    if (existe.length === 0) {
      this.sql.exec(
        `INSERT INTO notebook (id, titulo, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?)`,
        id,
        tituloDefault,
        agora,
        agora,
      );
    }
    return this.getMeta();
  }

  /**
   * Lê metadados do notebook.
   */
  async getMeta(): Promise<NotebookMeta> {
    await this.garantirSchema();
    const id = this.notebookId();
    const rows = this.sql
      .exec(`SELECT * FROM notebook WHERE id = ? LIMIT 1`, id)
      .toArray();
    if (rows.length === 0) {
      throw new Error(`NotebookAgent: notebook ${id} ainda não criado`);
    }
    const r = rows[0]!;
    return NotebookMetaSchema.parse({
      id,
      titulo: String(r["titulo"] ?? ""),
      documento_nome: r["documento_nome"]
        ? String(r["documento_nome"])
        : null,
      documento_total_paginas:
        r["documento_total_paginas"] === null ||
        r["documento_total_paginas"] === undefined
          ? null
          : Number(r["documento_total_paginas"]),
      documento_total_chars:
        r["documento_total_chars"] === null ||
        r["documento_total_chars"] === undefined
          ? null
          : Number(r["documento_total_chars"]),
      criado_em: Number(r["criado_em"]),
      atualizado_em: Number(r["atualizado_em"]),
    });
  }

  /**
   * Anexa o documento parseado ao notebook. Apaga páginas/chunks
   * anteriores (caso o usuário re-suba). Não gera embeddings ainda —
   * isso acontece no primeiro `buscarChunks`.
   */
  async anexarDocumento(input: {
    documento_nome: string;
    pages: NotebookPagina[];
    pdf_hash: string;
  }): Promise<UploadDocumentoOutput> {
    await this.garantirSchema();
    const id = this.notebookId();
    const totalChars = input.pages.reduce((s, p) => s + p.text.length, 0);
    const agora = Date.now();

    // Limpa estado antigo do mesmo notebook
    this.sql.exec(`DELETE FROM pagina WHERE notebook_id = ?`, id);
    this.sql.exec(`DELETE FROM chunk WHERE notebook_id = ?`, id);

    for (const p of input.pages) {
      this.sql.exec(
        `INSERT INTO pagina (notebook_id, n, texto) VALUES (?, ?, ?)`,
        id,
        p.n,
        p.text,
      );
    }

    const chunks = chunkifyPages(input.pages);
    for (const c of chunks) {
      const cid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `chk-${Math.random().toString(36).slice(2)}`;
      this.sql.exec(
        `INSERT INTO chunk (id, notebook_id, texto, pagina_inicio, pagina_fim)
         VALUES (?, ?, ?, ?, ?)`,
        cid,
        id,
        c.texto,
        c.pagina_inicio,
        c.pagina_fim,
      );
    }

    this.sql.exec(
      `UPDATE notebook
         SET documento_nome = ?, documento_total_paginas = ?,
             documento_total_chars = ?, documento_pdf_hash = ?,
             atualizado_em = ?
       WHERE id = ?`,
      input.documento_nome,
      input.pages.length,
      totalChars,
      input.pdf_hash,
      agora,
      id,
    );

    return {
      notebook_id: id,
      documento_nome: input.documento_nome,
      total_paginas: input.pages.length,
      total_chars: totalChars,
      pdf_hash: input.pdf_hash,
    };
  }

  /**
   * Persiste uma mensagem na conversa.
   */
  async registrarMensagem(
    input: Omit<Mensagem, "criado_em" | "notebook_id"> & {
      criado_em?: number;
    },
  ): Promise<Mensagem> {
    await this.garantirSchema();
    const id = this.notebookId();
    const criado_em = input.criado_em ?? Date.now();
    const mensagem: Mensagem = MensagemSchema.parse({
      id: input.id,
      notebook_id: id,
      role: input.role,
      content: input.content,
      tool_calls: input.tool_calls ?? [],
      modelo: input.modelo ?? null,
      tokens_total: input.tokens_total ?? null,
      criado_em,
    });
    this.sql.exec(
      `INSERT INTO mensagem
         (id, notebook_id, role, content, tool_calls, modelo, tokens_total, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      mensagem.id,
      id,
      mensagem.role,
      mensagem.content,
      JSON.stringify(mensagem.tool_calls),
      mensagem.modelo,
      mensagem.tokens_total,
      mensagem.criado_em,
    );
    this.sql.exec(
      `UPDATE notebook SET atualizado_em = ? WHERE id = ?`,
      criado_em,
      id,
    );
    return mensagem;
  }

  /**
   * Lista todas as mensagens em ordem cronológica.
   */
  async listarMensagens(): Promise<Mensagem[]> {
    await this.garantirSchema();
    const id = this.notebookId();
    const rows = this.sql
      .exec(
        `SELECT * FROM mensagem WHERE notebook_id = ? ORDER BY criado_em ASC`,
        id,
      )
      .toArray();
    return rows.map((r) => {
      const toolCallsRaw = String(r["tool_calls"] ?? "[]");
      let toolCalls: ToolCall[] = [];
      try {
        toolCalls = JSON.parse(toolCallsRaw) as ToolCall[];
      } catch {
        toolCalls = [];
      }
      return MensagemSchema.parse({
        id: String(r["id"]),
        notebook_id: id,
        role: r["role"] as Mensagem["role"],
        content: String(r["content"]),
        tool_calls: toolCalls,
        modelo: r["modelo"] === null || r["modelo"] === undefined
          ? null
          : String(r["modelo"]),
        tokens_total:
          r["tokens_total"] === null || r["tokens_total"] === undefined
            ? null
            : Number(r["tokens_total"]),
        criado_em: Number(r["criado_em"]),
      });
    });
  }

  /**
   * Lê todas as páginas concatenadas (com separador). Trunca em `maxChars`
   * para evitar estourar prompt do LLM. Default 100k chars (~25k tokens).
   */
  async lerDocumentoInteiro(maxChars = 100_000): Promise<string> {
    await this.garantirSchema();
    const id = this.notebookId();
    const rows = this.sql
      .exec(
        `SELECT n, texto FROM pagina WHERE notebook_id = ? ORDER BY n ASC`,
        id,
      )
      .toArray();
    if (rows.length === 0) return "";
    const partes: string[] = [];
    let acc = 0;
    for (const r of rows) {
      const bloco = `--- Página ${String(r["n"])} ---\n${String(r["texto"])}`;
      if (acc + bloco.length > maxChars) {
        partes.push(bloco.slice(0, maxChars - acc));
        partes.push(`\n\n[...documento truncado em ${maxChars} chars]`);
        break;
      }
      partes.push(bloco);
      acc += bloco.length;
    }
    return partes.join("\n\n");
  }

  /**
   * Busca semântica nos chunks. Gera embeddings da query + dos chunks
   * ainda não embeddados, depois ranqueia por similaridade cosseno.
   */
  async buscarChunks(query: string, topK = 5): Promise<BuscaChunkResult[]> {
    await this.garantirSchema();
    const id = this.notebookId();
    const k = Math.max(1, Math.min(20, topK));

    const rows = this.sql
      .exec(
        `SELECT id, texto, pagina_inicio, pagina_fim, embedding
         FROM chunk WHERE notebook_id = ?`,
        id,
      )
      .toArray();
    if (rows.length === 0) return [];

    const chunks: ChunkRow[] = rows.map((r) => ({
      id: String(r["id"]),
      texto: String(r["texto"]),
      pagina_inicio: Number(r["pagina_inicio"]),
      pagina_fim: Number(r["pagina_fim"]),
      embedding:
        r["embedding"] === null || r["embedding"] === undefined
          ? null
          : bytesToF32(r["embedding"] as Uint8Array),
    }));

    // Gera embeddings dos chunks faltantes (e da query) em uma única call.
    const faltam = chunks.filter((c) => c.embedding === null);
    const textosPraEmbed: string[] = [query];
    for (const c of faltam) textosPraEmbed.push(c.texto);

    const embeddings = await embedBatch(textosPraEmbed, this.env);
    const queryEmb = embeddings[0]!;
    let cursor = 1;
    for (const c of faltam) {
      const emb = embeddings[cursor++]!;
      c.embedding = emb;
      this.sql.exec(
        `UPDATE chunk SET embedding = ? WHERE id = ?`,
        f32ToBytes(emb),
        c.id,
      );
    }

    const ranked = chunks
      .map((c) => ({
        texto: c.texto,
        pagina_inicio: c.pagina_inicio,
        pagina_fim: c.pagina_fim,
        score: cosineSim(queryEmb, c.embedding!),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return ranked;
  }

  /**
   * Processa uma mensagem do chat. Dispara o engine conversacional,
   * encaminha eventos pelo WebSocket, persiste user/assistant turn no DO.
   *
   * `signal` propaga abort vindo do WebSocket fechado pelo cliente.
   */
  private async processarTurnoChat(
    userText: string,
    ws: WebSocket,
    signal: AbortSignal,
  ): Promise<void> {
    const sendEvent = (ev: ChatEvent) => {
      try {
        if (ws.readyState === 1 /* OPEN */) {
          ws.send(JSON.stringify(ev));
        }
      } catch {
        // socket fechou — engine ainda continua, mas eventos viram no-op.
      }
    };

    // Persiste a mensagem do user antes de gerar a resposta.
    const userMsgId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `usr-${Date.now()}`;
    await this.registrarMensagem({
      id: userMsgId,
      role: "user",
      content: userText,
      tool_calls: [],
      modelo: null,
      tokens_total: null,
    });

    try {
      const llm = criarGoogleLLM(this.env);
      const resultado = await conversar({
        env: this.env,
        llm,
        notebook: this,
        userText,
        onEvent: sendEvent,
        signal,
      });
      await this.registrarMensagem({
        id: resultado.message_id,
        role: "assistant",
        content: resultado.texto,
        tool_calls: resultado.tool_calls,
        modelo: resultado.modelo,
        tokens_total: resultado.tokens,
      });
      sendEvent({
        type: "done",
        message_id: resultado.message_id,
        tokens: resultado.tokens,
        finish_reason: resultado.finish_reason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendEvent({ type: "error", message: msg });
    }
  }

  /**
   * Handler HTTP do DO. Roteamento por pathname relativo + suporte a
   * WebSocket upgrade no `/chat`.
   *
   * Os endpoints só são chamados pelo Worker MCP via stub.fetch(internalUrl).
   * Não há autenticação aqui — segurança fica na fronteira do Worker.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // WebSocket upgrade — chat com streaming.
    if (
      pathname === "/chat" &&
      request.headers.get("Upgrade") === "websocket"
    ) {
      await this.garantirSchema();
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();

      const abortController = new AbortController();
      server.addEventListener("close", () => abortController.abort());
      server.addEventListener("error", () => abortController.abort());
      server.addEventListener("message", async (ev: MessageEvent) => {
        let payload: ChatClientEvent;
        try {
          const raw =
            typeof ev.data === "string"
              ? ev.data
              : new TextDecoder().decode(ev.data as ArrayBuffer);
          payload = ChatClientEventSchema.parse(JSON.parse(raw));
        } catch (err) {
          server.send(
            JSON.stringify({
              type: "error",
              message: `payload inválido: ${
                err instanceof Error ? err.message : String(err)
              }`,
            }),
          );
          return;
        }
        if (payload.type === "user_message") {
          await this.processarTurnoChat(
            payload.text,
            server,
            abortController.signal,
          );
        } else if (payload.type === "abort") {
          abortController.abort();
        }
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    try {
      if (request.method === "POST" && pathname === "/criar") {
        const body = (await request.json()) as { titulo?: string };
        const meta = await this.criar(body);
        return Response.json(meta);
      }
      if (request.method === "GET" && pathname === "/meta") {
        const meta = await this.getMeta();
        return Response.json(meta);
      }
      if (request.method === "POST" && pathname === "/anexar") {
        const body = (await request.json()) as {
          documento_nome: string;
          pages: NotebookPagina[];
          pdf_hash: string;
        };
        const out = await this.anexarDocumento(body);
        return Response.json(out);
      }
      if (request.method === "GET" && pathname === "/mensagens") {
        const msgs = await this.listarMensagens();
        return Response.json(msgs);
      }
      if (request.method === "POST" && pathname === "/mensagem") {
        const body = (await request.json()) as Parameters<
          NotebookAgent["registrarMensagem"]
        >[0];
        const m = await this.registrarMensagem(body);
        return Response.json(m);
      }
      if (request.method === "POST" && pathname === "/buscar-chunks") {
        const body = (await request.json()) as { query: string; topK?: number };
        const out = await this.buscarChunks(body.query, body.topK);
        return Response.json(out);
      }
      if (request.method === "POST" && pathname === "/ler-documento") {
        const body = (await request.json().catch(() => ({}))) as {
          max_chars?: number;
        };
        const texto = await this.lerDocumentoInteiro(body.max_chars);
        return Response.json({ texto });
      }
      return new Response(`Not found: ${pathname}`, { status: 404 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 500 });
    }
  }
}
