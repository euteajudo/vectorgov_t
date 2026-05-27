/**
 * Rota `/peticoes/nova` — wrapper server-component que monta o formulário
 * (client component) responsável pelo upload e polling.
 *
 * Separação dos arquivos:
 *  - este `page.tsx`: server component leve, define metadata e header.
 *  - `_form.tsx` (client): toda interação de UI (dropzone, mutation,
 *    polling do status).
 */
import type { Metadata } from "next";
import { NovaPeticaoForm } from "./_form";

export const metadata: Metadata = {
  title: "Nova petição — Vectorgov_t",
};

export default function NovaPeticaoPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <header className="space-y-1">
        <p className="text-sm text-[color:var(--color-muted-foreground)] font-medium uppercase tracking-wide">
          Análise técnica
        </p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Nova petição
        </h1>
        <p className="text-base text-[color:var(--color-muted-foreground)]">
          Faça upload do PDF da petição de reequilíbrio e os agentes geram a
          análise técnica com fundamentação verificada contra a base oficial.
        </p>
      </header>
      <NovaPeticaoForm />
    </div>
  );
}
