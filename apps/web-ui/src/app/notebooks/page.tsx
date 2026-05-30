/**
 * `/notebooks` — lista de notebooks (chats com documento).
 *
 * Cards com título + nome do documento + data. Botão "Novo notebook"
 * leva ao upload em `/notebooks/nova`.
 */
"use client";

import Link from "next/link";
import { useEffect, useState, type JSX } from "react";
import { FilePlus, MessageSquare, Trash2 } from "lucide-react";
import {
  deletarNotebook,
  listarNotebooks,
  type NotebookIdxEntry,
} from "../../lib/notebooks-api";

function formatarData(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotebooksPage(): JSX.Element {
  const [notebooks, setNotebooks] = useState<NotebookIdxEntry[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    listarNotebooks()
      .then((nbs) => {
        if (!cancelado) setNotebooks(nbs);
      })
      .catch((err) => {
        if (!cancelado) setErro(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function handleExcluir(id: string, titulo: string): Promise<void> {
    if (
      !window.confirm(
        `Excluir a conversa "${titulo}"? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    setExcluindo(id);
    try {
      await deletarNotebook(id);
      setNotebooks((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));
    } catch (err) {
      window.alert(
        `Falha ao excluir: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setExcluindo(null);
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conversas</h1>
          <p className="text-sm text-gray-500">
            Suba um documento e converse com ele em linguagem natural. O assistente
            consulta a base normativa e os especialistas quando necessário.
          </p>
        </div>
        <Link
          href="/notebooks/nova"
          className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <FilePlus className="h-4 w-4" />
          Nova conversa
        </Link>
      </div>

      {erro && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {erro}
        </div>
      )}

      {!notebooks && !erro && (
        <div className="text-sm text-gray-500">Carregando…</div>
      )}

      {notebooks && notebooks.length === 0 && (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-2 text-sm text-gray-500">
            Nenhuma conversa ainda. Comece criando uma nova.
          </p>
        </div>
      )}

      {notebooks && notebooks.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((nb) => (
            <div key={nb.id} className="relative">
              <Link
                href={`/notebooks/${nb.id}`}
                className="block rounded-lg border border-gray-200 bg-white p-4 pr-10 transition-colors hover:border-blue-300 hover:bg-blue-50/30"
              >
                <div className="flex items-start gap-2">
                  <MessageSquare className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-medium text-gray-900 truncate">
                      {nb.titulo}
                    </h2>
                    <p className="text-xs text-gray-500 truncate">
                      {nb.documento_nome ?? "(sem documento anexado)"}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {formatarData(nb.atualizado_em)}
                    </p>
                  </div>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => void handleExcluir(nb.id, nb.titulo)}
                disabled={excluindo === nb.id}
                title="Excluir conversa"
                aria-label="Excluir conversa"
                className="absolute right-2 top-2 rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
