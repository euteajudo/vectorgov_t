/**
 * Rota `/historico` — listagem paginada de petições já analisadas.
 */
import type { Metadata } from "next";
import { HistoricoTable } from "./_table";

export const metadata: Metadata = {
  title: "Histórico — Vectorgov_t",
};

export default function HistoricoPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-[color:var(--color-muted-foreground)] font-medium uppercase tracking-wide">
          Petições analisadas
        </p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Histórico
        </h1>
        <p className="text-base text-[color:var(--color-muted-foreground)] max-w-3xl">
          Todas as petições já submetidas, com vereditos, scores e indicação
          de quais possuem parecer formal aprovado.
        </p>
      </header>
      <HistoricoTable />
    </div>
  );
}
