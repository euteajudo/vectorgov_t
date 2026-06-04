/**
 * `/admin/acordaos` — listagem dos acórdãos do TCU já carregados.
 *
 * Espelha `/admin/ingestao` (lista de leis). Lê via tool MCP `listar_acordaos`
 * (no `vectorgov-t-mcp`, binding read-only do D1 `vectorgov-a-db`). A ingestão
 * de um novo acórdão fica em `/admin/acordaos/nova`.
 */
"use client";

import { useCallback, useEffect, useState, type JSX } from "react";
import Link from "next/link";
import { AcordaoTable } from "../../../components/acordaos/AcordaoTable";
import { listarAcordaos, type AcordaoListItem } from "../../../lib/acordaos-api";

export default function ListagemAcordaosPage(): JSX.Element {
  const [acordaos, setAcordaos] = useState<AcordaoListItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const lista = await listarAcordaos();
      setAcordaos(lista);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErro(`Falha ao listar acórdãos: ${msg}`);
      setAcordaos([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, refreshTick]);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Acórdãos carregados</h1>
          <p className="text-sm text-gray-500">
            Jurisprudência do TCU ingerida (D1{" "}
            <span className="font-mono">vectorgov-a-db</span>).
            {acordaos !== null && ` ${acordaos.length} acórdão(s).`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Atualizar
          </button>
          <Link
            href="/admin/acordaos/nova"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Novo acórdão
          </Link>
        </div>
      </div>

      {erro && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {erro}
        </div>
      )}

      {acordaos === null ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          Carregando acórdãos...
        </div>
      ) : (
        <AcordaoTable acordaos={acordaos} />
      )}
    </div>
  );
}
