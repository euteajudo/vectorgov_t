/**
 * Rota `/skills` — listagem geral de skills (active + candidate).
 */
import type { Metadata } from "next";
import { SkillsList } from "./_list";

export const metadata: Metadata = {
  title: "Skills — Vectorgov_t",
};

export default function SkillsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-[color:var(--color-muted-foreground)] font-medium uppercase tracking-wide">
          Instruções dos agentes
        </p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Skills
        </h1>
        <p className="text-base text-[color:var(--color-muted-foreground)] max-w-3xl">
          Skills são instruções markdown que os agentes carregam sob demanda.
          Aqui você edita, testa A/B e promove novas versões para produção.
        </p>
      </header>
      <SkillsList />
    </div>
  );
}
