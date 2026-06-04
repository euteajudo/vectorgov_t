/**
 * Tabela administrativa de acórdãos do TCU carregados.
 *
 * Colunas: Acórdão (número/ano), Colegiado, Relator, Processo TC. Puramente
 * apresentacional — espelha `NormaTable` das leis, mas sem ações (a interface
 * de acórdãos é, por ora, só listagem + upload em `/admin/acordaos/nova`).
 */
"use client";

import type { JSX } from "react";
import { COLEGIADOS, type AcordaoListItem } from "../../lib/acordaos-api";

export interface AcordaoTableProps {
  acordaos: AcordaoListItem[];
}

const COLEGIADO_LABEL: Record<string, string> = Object.fromEntries(
  COLEGIADOS.map((c) => [c.value, c.label]),
);

export function AcordaoTable({ acordaos }: AcordaoTableProps): JSX.Element {
  if (acordaos.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-8 text-center text-gray-500">
        Nenhum acórdão carregado ainda. Use{" "}
        <span className="font-mono">/admin/acordaos/nova</span> para ingerir um PDF.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Acórdão</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Colegiado</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Relator</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Processo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {acordaos.map((a) => (
            <tr key={a.acordao_id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2 text-sm font-medium text-gray-800">
                Acórdão {a.numero}/{a.ano}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                {COLEGIADO_LABEL[a.colegiado] ?? a.colegiado ?? "—"}
              </td>
              <td className="px-3 py-2 text-sm text-gray-700" title={a.relator ?? ""}>
                {a.relator ?? "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-gray-600">
                {a.processo_tc ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
