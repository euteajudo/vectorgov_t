/**
 * Layout local da área `/admin/ingestao/*`.
 *
 * Mantemos um wrapper enxuto: cabeçalho com breadcrumb e container central.
 * O layout RAIZ (`apps/web-ui/src/app/layout.tsx`) é responsabilidade da
 * Track H — este layout fica aninhado, não substitui o global.
 *
 * Se a Track H entregar uma shell administrativa unificada (sidebar etc.),
 * basta remover o wrapper interno daqui e deixar só `{children}`.
 */
import type { JSX, ReactNode } from "react";
import Link from "next/link";

export default function IngestaoAdminLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-baseline gap-2 text-sm">
            <Link href="/" className="font-semibold text-gray-700 hover:text-gray-900">
              Vectorgov_t
            </Link>
            <span className="text-gray-300">/</span>
            <Link href="/admin/ingestao" className="text-gray-500 hover:text-gray-700">
              Admin
            </Link>
            <span className="text-gray-300">/</span>
            <span className="font-medium text-gray-900">Ingestão</span>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link
              href="/admin/ingestao"
              className="rounded px-3 py-1.5 text-gray-700 hover:bg-gray-100"
            >
              Listagem
            </Link>
            <Link
              href="/admin/ingestao/nova"
              className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
            >
              Nova ingestão
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
