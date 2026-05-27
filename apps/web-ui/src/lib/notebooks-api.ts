/**
 * Cliente HTTP + WebSocket do chat NotebookLM.
 *
 * Endpoints REST:
 *   POST   /api/notebooks                     -> criar notebook
 *   GET    /api/notebooks                     -> lista
 *   GET    /api/notebooks/:id                 -> metadata
 *   POST   /api/notebooks/:id/upload          -> sobe PDF
 *   GET    /api/notebooks/:id/mensagens       -> histórico
 *
 * WebSocket:
 *   GET    /api/notebooks/:id/chat            -> stream de eventos
 */
import type {
  ChatEvent,
  ChatClientEvent,
  Mensagem,
  NotebookMeta,
  UploadDocumentoOutput,
} from "@vectorgov-t/schemas";

const BASE =
  process.env.NEXT_PUBLIC_MCP_BASE_URL ??
  "https://vectorgov-t-mcp.souzat19.workers.dev";

/** Mesmo `ApiError` do lib/api.ts replicado aqui pra evitar import cíclico. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail: { error?: string } | null = null;
    try {
      detail = (await res.json()) as { error?: string };
    } catch {}
    throw new ApiError(
      detail?.error ?? `${res.status} ${res.statusText}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

export interface NotebookIdxEntry {
  id: string;
  titulo: string;
  documento_nome: string | null;
  criado_em: number;
  atualizado_em: number;
}

/**
 * Cria notebook novo (vazio).
 */
export async function criarNotebook(titulo?: string): Promise<NotebookMeta> {
  return fetchJson<NotebookMeta>("/api/notebooks", {
    method: "POST",
    body: JSON.stringify({ titulo }),
  });
}

/**
 * Lista notebooks ordenados por atualizado_em DESC.
 */
export async function listarNotebooks(): Promise<NotebookIdxEntry[]> {
  const r = await fetchJson<{ notebooks: NotebookIdxEntry[] }>(
    "/api/notebooks",
  );
  return r.notebooks;
}

export async function getNotebook(id: string): Promise<NotebookMeta> {
  return fetchJson<NotebookMeta>(`/api/notebooks/${encodeURIComponent(id)}`);
}

/**
 * Upload do PDF do notebook. Server faz parse-doc e anexa as páginas.
 * Devolve UploadDocumentoOutput. Pode demorar (até 6min em PDFs grandes).
 */
export async function uploadDocumento(
  id: string,
  file: File,
): Promise<UploadDocumentoOutput> {
  const form = new FormData();
  form.append("pdf", file);
  const res = await fetch(
    `${BASE}/api/notebooks/${encodeURIComponent(id)}/upload`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    let detail: { error?: string } | null = null;
    try {
      detail = (await res.json()) as { error?: string };
    } catch {}
    throw new ApiError(
      detail?.error ?? `${res.status} ${res.statusText}`,
      res.status,
    );
  }
  return (await res.json()) as UploadDocumentoOutput;
}

export async function listarMensagens(id: string): Promise<Mensagem[]> {
  const r = await fetchJson<{ mensagens: Mensagem[] }>(
    `/api/notebooks/${encodeURIComponent(id)}/mensagens`,
  );
  return r.mensagens;
}

/**
 * Encapsulamento do WebSocket de chat. Reconecta NÃO é automático —
 * caller decide.
 */
export interface ChatSocket {
  send(event: ChatClientEvent): void;
  close(): void;
  readyState: () => number;
}

export function abrirChatSocket(
  id: string,
  onEvent: (e: ChatEvent) => void,
  apiKey: string,
  onClose?: () => void,
  onError?: (err: Event) => void,
): ChatSocket {
  if (!apiKey) {
    throw new Error("abrirChatSocket: apiKey é obrigatória");
  }
  // Converte HTTPS BASE em WSS
  const wsBase = BASE.replace(/^http/, "ws");
  const url = `${wsBase}/api/notebooks/${encodeURIComponent(id)}/chat`;
  // Subprotocol: o browser envia `Sec-WebSocket-Protocol: vectorgov-key.<key>`
  // e o servidor ecoa o mesmo. Não tem outro canal pra passar header em WS.
  const ws = new WebSocket(url, [`vectorgov-key.${apiKey}`]);
  ws.addEventListener("message", (ev) => {
    try {
      const parsed = JSON.parse(ev.data as string) as ChatEvent;
      onEvent(parsed);
    } catch {
      // ignora mensagens não-JSON (shouldn't happen).
    }
  });
  if (onClose) ws.addEventListener("close", onClose);
  if (onError) ws.addEventListener("error", onError);
  return {
    send(event) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
      }
    },
    close() {
      ws.close();
    },
    readyState: () => ws.readyState,
  };
}
