/**
 * `/notebooks/[id]` — chat completo com um documento.
 *
 * Carrega metadata (titulo + nome do documento) via REST e renderiza o
 * componente <NotebookChat /> que cuida do WebSocket + UI.
 */
"use client";

import { useEffect, useState, type JSX } from "react";
import { useParams } from "next/navigation";
import { getNotebook } from "../../../lib/notebooks-api";
import type { NotebookMeta } from "@vectorgov-t/schemas";
import { NotebookChat } from "../../../components/notebook-chat";

export default function NotebookPage(): JSX.Element {
  const params = useParams();
  const id =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
        ? params.id[0]
        : null;
  const [meta, setMeta] = useState<NotebookMeta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelado = false;
    getNotebook(id)
      .then((m) => {
        if (!cancelado) setMeta(m);
      })
      .catch((err) => {
        if (!cancelado)
          setErro(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelado = true;
    };
  }, [id]);

  if (!id) {
    return (
      <div className="p-6 text-sm text-red-600">id de notebook inválido</div>
    );
  }
  if (erro) {
    return (
      <div className="p-6 text-sm text-red-600">
        Erro carregando notebook: {erro}
      </div>
    );
  }
  if (!meta) {
    return <div className="p-6 text-sm text-gray-500">Carregando…</div>;
  }
  return (
    <NotebookChat notebookId={id} documentoNome={meta.documento_nome} />
  );
}
