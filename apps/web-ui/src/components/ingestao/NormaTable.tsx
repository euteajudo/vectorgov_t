/**
 * Tabela administrativa de normas ingeridas.
 *
 * Colunas: ID, tipo, número, ano, ementa (truncada em 80 chars), data de
 * ingestão (curta) e total de dispositivos. Coluna "Ações" com: ver detalhes
 * (link interno), re-ingerir, remover (confirmação inline).
 *
 * As ações chamam callbacks do pai — esse componente não fala com a API
 * direto, mantendo `NormaTable` puramente apresentacional.
 */
"use client";

import { useState, type JSX } from "react";
import type { NormaListItem } from "../../lib/ingestao-api";

export interface NormaTableProps {
  normas: NormaListItem[];
  onReingerir?: (normaId: string) => void | Promise<void>;
  onRemover?: (normaId: string) => void | Promise<void>;
}

/**
 * Trunca string mantendo ellipsis em até `max` caracteres.
 */
function truncar(s: string | null, max: number): string {
  if (!s) return "—";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "...";
}

/**
 * Formata data ISO em pt-BR curto (sem hora, sem timezone visível).
 */
function fmtData(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return iso;
  }
}

export function NormaTable({
  normas,
  onReingerir,
  onRemover,
}: NormaTableProps): JSX.Element {
  // Controle de qual linha está pedindo confirmação de remoção.
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<string | null>(null);
  const [executando, setExecutando] = useState<string | null>(null);

  async function handleReingerir(id: string): Promise<void> {
    if (!onReingerir) return;
    setExecutando(id);
    try {
      await onReingerir(id);
    } finally {
      setExecutando(null);
    }
  }

  async function handleRemoverConfirmado(id: string): Promise<void> {
    if (!onRemover) return;
    setExecutando(id);
    try {
      await onRemover(id);
      setConfirmandoRemocao(null);
    } finally {
      setExecutando(null);
    }
  }

  if (normas.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-8 text-center text-gray-500">
        Nenhuma norma ingerida ainda. Use <span className="font-mono">/admin/ingestao/nova</span> para começar.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">ID</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Tipo</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Num.</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Ano</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Ementa</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Ingerida</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Disp.</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Status</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {normas.map((n) => {
            const isExecutando = executando === n.norma_id;
            const isConfirmando = confirmandoRemocao === n.norma_id;
            return (
              <tr key={n.norma_id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-gray-700">
                  {n.norma_id}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                  {n.tipo}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                  {n.numero}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                  {n.ano}
                </td>
                <td
                  className="max-w-md px-3 py-2 text-sm text-gray-600"
                  title={n.ementa ?? ""}
                >
                  {truncar(n.ementa, 80)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                  {fmtData(n.data_ingestao)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums text-gray-700">
                  {n.total_dispositivos ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    {n.status ?? "vigente"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-sm">
                  {isConfirmando ? (
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleRemoverConfirmado(n.norma_id)}
                        disabled={isExecutando}
                        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {isExecutando ? "Removendo..." : "Confirmar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmandoRemocao(null)}
                        disabled={isExecutando}
                        className="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="inline-flex gap-3">
                      <a
                        href={`/admin/ingestao#${n.norma_id}`}
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        Detalhes
                      </a>
                      <button
                        type="button"
                        onClick={() => handleReingerir(n.norma_id)}
                        disabled={isExecutando}
                        className="text-amber-600 hover:text-amber-800 hover:underline disabled:opacity-50"
                      >
                        Re-ingerir
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmandoRemocao(n.norma_id)}
                        disabled={isExecutando}
                        className="text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
                      >
                        Remover
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
