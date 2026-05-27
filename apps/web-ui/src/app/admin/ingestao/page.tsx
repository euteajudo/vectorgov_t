/**
 * `/admin/ingestao` — listagem de normas já ingeridas.
 *
 * Client component (precisa de useState/useEffect para o fetch + ações).
 * Em produção, o backend ainda não expõe `GET /normas` — o cliente cai no
 * mock determinístico de `lib/ingestao-api.ts`. Quando o endpoint REST
 * existir, basta editar `listarNormas` lá.
 */
"use client";

import { useCallback, useEffect, useState, type JSX } from "react";
import { NormaTable } from "../../../components/ingestao/NormaTable";
import {
  listarNormas,
  reingerirNorma,
  removerNorma,
  type NormaListItem,
} from "../../../lib/ingestao-api";

export default function ListagemNormasPage(): JSX.Element {
  const [normas, setNormas] = useState<NormaListItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const lista = await listarNormas();
      setNormas(lista);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErro(`Falha ao listar normas: ${msg}`);
      setNormas([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, refreshTick]);

  const handleReingerir = useCallback(async (id: string) => {
    try {
      await reingerirNorma(id);
      // TODO(merge backend): quando o endpoint real existir, redirecionar
      // para /admin/ingestao/status/<novo_id>.
      window.alert(`Re-ingestão de ${id} solicitada (mock — backend ainda não expõe).`);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`Erro: ${msg}`);
    }
  }, []);

  const handleRemover = useCallback(async (id: string) => {
    try {
      await removerNorma(id);
      window.alert(`Remoção de ${id} solicitada (mock — backend ainda não expõe).`);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`Erro: ${msg}`);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Normas ingeridas</h1>
          <p className="text-sm text-gray-500">
            Catálogo do <span className="font-mono">_index.json</span> do bucket R2.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshTick((t) => t + 1)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Atualizar
        </button>
      </div>

      {erro && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {erro}
        </div>
      )}

      {normas === null ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          Carregando catálogo...
        </div>
      ) : (
        <NormaTable
          normas={normas}
          onReingerir={handleReingerir}
          onRemover={handleRemover}
        />
      )}
    </div>
  );
}
