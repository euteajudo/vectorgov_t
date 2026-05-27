/**
 * Endpoints REST do chat NotebookLM.
 *
 *   POST   /api/notebooks                     -> {id, ...}
 *   GET    /api/notebooks                     -> Array<NotebookMeta>
 *   GET    /api/notebooks/:id                 -> NotebookMeta
 *   POST   /api/notebooks/:id/upload          -> UploadDocumentoOutput
 *   GET    /api/notebooks/:id/mensagens       -> Mensagem[]
 *   GET    /api/notebooks/:id/chat            -> Upgrade: websocket -> DO
 *
 * Cada notebook = 1 Durable Object (NotebookAgent). Os handlers aqui só
 * são proxies — fazem o stub.fetch pra um path interno e devolvem a
 * resposta.
 *
 * Índice de notebooks: como não dá pra "listar DOs", mantemos um índice
 * separado em KV com prefix `notebook-idx:` (id -> {titulo, criado_em}).
 * Atualizamos esse índice em POST /api/notebooks e PUT /api/notebooks/:id/upload.
 */
import type { Env } from "../env.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";

const NOTEBOOK_IDX_PREFIX = "notebook-idx:";
const MAX_PDF_BYTES = 50 * 1024 * 1024;

interface NotebookIdxEntry {
  id: string;
  titulo: string;
  documento_nome: string | null;
  criado_em: number;
  atualizado_em: number;
}

function notebookIdFromPath(pathname: string): string | null {
  // /api/notebooks/<id>(/...)?
  const m = pathname.match(/^\/api\/notebooks\/([^/]+)(?:\/.*)?$/);
  return m ? (m[1] ?? null) : null;
}

function pickStub(env: Env, id: string) {
  const ns = env.NOTEBOOK_AGENT;
  // Tanto `idFromString` quanto `idFromName` funcionariam — preferimos
  // `idFromName(id)` pra que strings curtas legíveis também viáveis em
  // dev sirvam como identidade do DO.
  const doId = ns.idFromName(id);
  return ns.get(doId);
}

async function updateIndexFromMeta(
  env: Env,
  entry: NotebookIdxEntry,
): Promise<void> {
  await env.CACHE.put(
    `${NOTEBOOK_IDX_PREFIX}${entry.id}`,
    JSON.stringify(entry),
  );
}

async function loadIndex(env: Env): Promise<NotebookIdxEntry[]> {
  const list = await env.CACHE.list({ prefix: NOTEBOOK_IDX_PREFIX });
  const out: NotebookIdxEntry[] = [];
  for (const k of list.keys) {
    const raw = await env.CACHE.get(k.name);
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as NotebookIdxEntry);
    } catch {
      // ignore corrupt entries
    }
  }
  return out.sort((a, b) => b.atualizado_em - a.atualizado_em);
}

/**
 * POST /api/notebooks — cria um notebook com id novo.
 */
export async function handleCriarNotebook(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    titulo?: string;
  };
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `nb-${Date.now()}`;
  const stub = pickStub(env, id);
  const r = await stub.fetch(
    new Request("https://do.local/criar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo: body.titulo }),
    }),
  );
  if (!r.ok) {
    return errorResponse(`DO retornou ${r.status}`, 500);
  }
  const meta = (await r.json()) as { id: string; titulo: string; criado_em: number; atualizado_em: number };
  await updateIndexFromMeta(env, {
    id: meta.id,
    titulo: meta.titulo,
    documento_nome: null,
    criado_em: meta.criado_em,
    atualizado_em: meta.atualizado_em,
  });
  return jsonResponse(meta, 201);
}

/**
 * GET /api/notebooks — lista todos os notebooks (ordenados por atualizado_em DESC).
 */
export async function handleListarNotebooks(
  _request: Request,
  env: Env,
): Promise<Response> {
  const list = await loadIndex(env);
  return jsonResponse({ notebooks: list });
}

/**
 * GET /api/notebooks/:id — metadados do notebook.
 */
export async function handleGetNotebook(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const id = notebookIdFromPath(url.pathname);
  if (!id) return errorResponse("id inválido", 400);
  const stub = pickStub(env, id);
  const r = await stub.fetch(new Request("https://do.local/meta"));
  if (!r.ok) return errorResponse(`DO retornou ${r.status}`, r.status);
  return jsonResponse(await r.json());
}

/**
 * POST /api/notebooks/:id/upload — multipart com PDF; encadeia parse-doc + anexar.
 */
export async function handleUploadDocumento(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const id = notebookIdFromPath(url.pathname);
  if (!id) return errorResponse("id inválido", 400);

  if (!request.headers.get("Content-Type")?.includes("multipart/form-data")) {
    return errorResponse("Content-Type deve ser multipart/form-data", 400);
  }

  const form = await request.formData();
  const file = form.get("pdf");
  if (!(file instanceof File)) {
    return errorResponse("campo 'pdf' obrigatório", 400);
  }
  if (file.size > MAX_PDF_BYTES) {
    return errorResponse(
      `PDF maior que ${MAX_PDF_BYTES} bytes (50 MB)`,
      413,
    );
  }

  // 1. Salva o PDF em R2 (no bucket existente, prefixado por notebook).
  const r2Key = `notebooks/${id}/source.pdf`;
  const pdfBytes = await file.arrayBuffer();
  await env.R2_LEIS.put(r2Key, pdfBytes, {
    httpMetadata: { contentType: file.type || "application/pdf" },
    customMetadata: { notebook_id: id, filename: file.name },
  });

  // 2. Chama /parse-doc do Container Python.
  const { callContainerParseDoc } = await import(
    "../pipeline/container-client.js"
  );
  let parsed;
  try {
    parsed = await callContainerParseDoc(
      env,
      new Blob([pdfBytes], { type: file.type }),
      file.name,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`parse-doc falhou: ${msg}`, 502);
  }

  // 3. Envia páginas pro DO.
  const stub = pickStub(env, id);
  const anexoR = await stub.fetch(
    new Request("https://do.local/anexar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documento_nome: file.name,
        pages: parsed.pages,
        pdf_hash: parsed.pdf_hash,
      }),
    }),
  );
  if (!anexoR.ok) {
    return errorResponse(`DO /anexar retornou ${anexoR.status}`, 500);
  }
  const out = await anexoR.json();

  // 4. Atualiza índice em KV.
  const metaR = await stub.fetch(new Request("https://do.local/meta"));
  if (metaR.ok) {
    const meta = (await metaR.json()) as {
      id: string;
      titulo: string;
      documento_nome: string | null;
      criado_em: number;
      atualizado_em: number;
    };
    await updateIndexFromMeta(env, {
      id: meta.id,
      titulo: meta.titulo,
      documento_nome: meta.documento_nome,
      criado_em: meta.criado_em,
      atualizado_em: meta.atualizado_em,
    });
  }

  return jsonResponse(out);
}

/**
 * GET /api/notebooks/:id/mensagens — histórico de mensagens.
 */
export async function handleListarMensagens(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const id = notebookIdFromPath(url.pathname);
  if (!id) return errorResponse("id inválido", 400);
  const stub = pickStub(env, id);
  const r = await stub.fetch(new Request("https://do.local/mensagens"));
  if (!r.ok) return errorResponse(`DO retornou ${r.status}`, r.status);
  return jsonResponse({ mensagens: await r.json() });
}

/**
 * GET /api/notebooks/:id/chat — Upgrade: websocket. Apenas faz proxy
 * pro DO; o DO trata o WebSocket via state.acceptWebSocket.
 */
export async function handleChatWS(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const id = notebookIdFromPath(url.pathname);
  if (!id) return errorResponse("id inválido", 400);
  if (request.headers.get("Upgrade") !== "websocket") {
    return errorResponse("Esta rota requer Upgrade: websocket", 426);
  }
  const stub = pickStub(env, id);
  // Encaminha o request original (preservando Upgrade header) ao DO.
  return await stub.fetch(
    new Request("https://do.local/chat", {
      method: "GET",
      headers: request.headers,
    }),
  );
}
