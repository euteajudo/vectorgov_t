/**
 * NotebookChat — UI principal de uma conversa com documento.
 *
 * - Carrega histórico via REST no mount.
 * - Abre WebSocket pro stream de tokens / tool calls / done.
 * - Renderiza mensagens estilo Claude: user à direita, assistant à esquerda,
 *   tool calls como blocos colapsáveis abaixo da mensagem.
 * - Input fixo embaixo com submit Enter (Shift+Enter = quebra).
 */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { Send, Bot, User, Wrench, ChevronDown, ChevronRight, KeyRound } from "lucide-react";
import type { ChatEvent, Mensagem, ToolCall } from "@vectorgov-t/schemas";
import {
  abrirChatSocket,
  listarMensagens,
  type ChatSocket,
} from "../lib/notebooks-api";
import { useApiKey } from "../lib/api-key-store";

/**
 * Estado de uma mensagem do assistant durante o streaming (antes de ser
 * persistida via `done`).
 */
interface StreamingState {
  texto: string;
  toolCalls: ToolCall[];
}

interface Props {
  notebookId: string;
  documentoNome: string | null;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ToolCallBlock({ tc }: { tc: ToolCall }): JSX.Element {
  const [aberto, setAberto] = useState(false);
  const erro = tc.erro;
  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 text-xs">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-gray-600 hover:bg-gray-100"
      >
        {aberto ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Wrench className="h-3 w-3" />
        <span className="font-mono">{tc.nome}</span>
        {erro && (
          <span className="ml-auto text-red-600">erro</span>
        )}
      </button>
      {aberto && (
        <div className="border-t border-gray-200 p-2 space-y-1">
          <div>
            <div className="text-[10px] uppercase text-gray-400">args</div>
            <pre className="text-[11px] text-gray-700 whitespace-pre-wrap break-all">
              {JSON.stringify(tc.args, null, 2)}
            </pre>
          </div>
          {erro ? (
            <div>
              <div className="text-[10px] uppercase text-red-500">erro</div>
              <pre className="text-[11px] text-red-700 whitespace-pre-wrap">
                {erro}
              </pre>
            </div>
          ) : (
            <div>
              <div className="text-[10px] uppercase text-gray-400">
                resultado
              </div>
              <pre className="text-[11px] text-gray-700 whitespace-pre-wrap break-all max-h-60 overflow-auto">
                {JSON.stringify(tc.resultado, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Bubble({
  mensagem,
}: {
  mensagem: Mensagem | { role: "assistant"; content: string; tool_calls: ToolCall[]; criado_em: number };
}): JSX.Element {
  const isUser = mensagem.role === "user";
  return (
    <div
      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
            isUser
              ? "bg-blue-600 text-white"
              : "bg-white border border-gray-200 text-gray-900"
          }`}
        >
          {mensagem.content || (
            <span className="text-gray-400 italic">…</span>
          )}
        </div>
        {!isUser && mensagem.tool_calls.length > 0 && (
          <div>
            {mensagem.tool_calls.map((tc) => (
              <ToolCallBlock key={tc.id} tc={tc} />
            ))}
          </div>
        )}
        <div className="mt-1 text-[10px] text-gray-400">
          {formatTime(mensagem.criado_em)}
        </div>
      </div>
      {isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-700">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

export function NotebookChat({
  notebookId,
  documentoNome,
}: Props): JSX.Element {
  const [historico, setHistorico] = useState<Mensagem[]>([]);
  const [stream, setStream] = useState<StreamingState | null>(null);
  const [input, setInput] = useState("");
  const [conectado, setConectado] = useState(false);
  const [erroConexao, setErroConexao] = useState<string | null>(null);
  const socketRef = useRef<ChatSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { apiKey, ready: apiKeyReady } = useApiKey();

  // Carrega histórico via REST no mount.
  useEffect(() => {
    let cancelado = false;
    listarMensagens(notebookId)
      .then((msgs) => {
        if (!cancelado) setHistorico(msgs);
      })
      .catch((err) => {
        if (!cancelado)
          setErroConexao(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelado = true;
    };
  }, [notebookId]);

  // Abre WebSocket no mount (apenas quando há key), fecha no unmount.
  useEffect(() => {
    if (!apiKeyReady) return;
    if (!apiKey) {
      setConectado(false);
      return;
    }
    const ws = abrirChatSocket(
      notebookId,
      handleEvent,
      apiKey,
      () => setConectado(false),
      () => setErroConexao("WebSocket desconectado"),
    );
    socketRef.current = ws;
    // Marca conectado depois de um tick (readyState OPEN).
    const tick = setInterval(() => {
      if (ws.readyState() === WebSocket.OPEN) {
        setConectado(true);
        clearInterval(tick);
      }
    }, 100);
    return () => {
      clearInterval(tick);
      ws.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, apiKey, apiKeyReady]);

  // Auto-scroll quando mensagens mudam.
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [historico, stream]);

  const handleEvent = useCallback((ev: ChatEvent): void => {
    if (ev.type === "token") {
      setStream((prev) => ({
        texto: (prev?.texto ?? "") + ev.text,
        toolCalls: prev?.toolCalls ?? [],
      }));
    } else if (ev.type === "tool_call") {
      setStream((prev) => ({
        texto: prev?.texto ?? "",
        toolCalls: [
          ...(prev?.toolCalls ?? []),
          {
            id: ev.call_id,
            nome: ev.name,
            args: ev.args,
            resultado: null,
            erro: null,
          },
        ],
      }));
    } else if (ev.type === "tool_result") {
      setStream((prev) => ({
        texto: prev?.texto ?? "",
        toolCalls: (prev?.toolCalls ?? []).map((tc) =>
          tc.id === ev.call_id
            ? {
                ...tc,
                resultado: ev.is_error ? null : ev.result,
                erro: ev.is_error
                  ? typeof ev.result === "object" &&
                    ev.result &&
                    "error" in (ev.result as Record<string, unknown>)
                    ? String(
                        (ev.result as { error: unknown }).error,
                      )
                    : "erro na tool"
                  : null,
              }
            : tc,
        ),
      }));
    } else if (ev.type === "done") {
      // Move o streaming pro histórico definitivo.
      setStream((prev) => {
        if (!prev) return null;
        setHistorico((h) => [
          ...h,
          {
            id: ev.message_id,
            notebook_id: notebookId,
            role: "assistant",
            content: prev.texto,
            tool_calls: prev.toolCalls,
            modelo: "gemini-3.5-flash",
            tokens_total: ev.tokens,
            criado_em: Date.now(),
          },
        ]);
        return null;
      });
    } else if (ev.type === "error") {
      setErroConexao(ev.message);
      setStream(null);
    }
  }, [notebookId]);

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const texto = input.trim();
    if (!texto || !socketRef.current) return;
    if (socketRef.current.readyState() !== WebSocket.OPEN) {
      setErroConexao("WebSocket não está aberto");
      return;
    }
    setErroConexao(null);
    // Anexa user message ao histórico local imediatamente.
    setHistorico((h) => [
      ...h,
      {
        id: `local-${Date.now()}`,
        notebook_id: notebookId,
        role: "user",
        content: texto,
        tool_calls: [],
        modelo: null,
        tokens_total: null,
        criado_em: Date.now(),
      },
    ]);
    socketRef.current.send({ type: "user_message", text: texto });
    setInput("");
    setStream({ texto: "", toolCalls: [] });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
    }
  }

  const podeEnviar = useMemo(
    () => conectado && input.trim().length > 0 && stream === null,
    [conectado, input, stream],
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-600" />
          <h1 className="text-sm font-medium text-gray-900">
            {documentoNome ?? "Notebook sem documento"}
          </h1>
          <span
            className={`ml-auto text-xs ${
              conectado ? "text-green-600" : "text-gray-400"
            }`}
          >
            {conectado ? "● online" : "○ offline"}
          </span>
        </div>
      </header>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto bg-gray-50 px-4 py-4 space-y-4"
      >
        {apiKeyReady && !apiKey && (
          <div className="mx-auto max-w-md text-center mt-12 space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4">
            <KeyRound className="mx-auto h-8 w-8 text-amber-600" />
            <p className="text-sm text-amber-900">
              Configure sua API key do Google para conversar com este documento.
            </p>
            <Link
              href="/admin/config"
              className="inline-flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              Configurar API key
            </Link>
          </div>
        )}

        {apiKeyReady && apiKey && historico.length === 0 && stream === null && (
          <div className="mx-auto max-w-md text-center text-sm text-gray-500 mt-12">
            <Bot className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2">
              Pergunte sobre o documento, ou peça referências de normas e
              jurisprudência relacionadas.
            </p>
          </div>
        )}

        {historico.map((m) => (
          <Bubble key={m.id} mensagem={m} />
        ))}

        {stream && (
          <Bubble
            mensagem={{
              role: "assistant",
              content: stream.texto,
              tool_calls: stream.toolCalls,
              criado_em: Date.now(),
            }}
          />
        )}

        {erroConexao && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {erroConexao}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-gray-200 bg-white p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte algo… (Enter para enviar, Shift+Enter para quebra)"
            rows={2}
            disabled={!conectado || stream !== null}
            className="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
          />
          <button
            type="submit"
            disabled={!podeEnviar}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Enviar
          </button>
        </div>
      </form>
    </div>
  );
}
