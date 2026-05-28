/**
 * Cards de estatísticas do dashboard — dados REAIS.
 *
 * Busca via React Query (`getDashboardStats`), que agrega histórico de
 * petições, skills e normas indexadas. Enquanto carrega mostra skeleton;
 * se uma fonte falha, o card exibe "—" (degradação independente).
 */
"use client";
import { useQuery } from "@tanstack/react-query";
import {
  FileCheck,
  FileSignature,
  Sparkles,
  BookOpen,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { getDashboardStats } from "@/lib/api";

function pct(part: number | null, total: number | null): string {
  if (part === null || total === null || total === 0) return "—";
  return `${((part / total) * 100).toFixed(1).replace(".", ",")}% das análises`;
}

export function DashboardStats() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
    staleTime: 60_000,
  });

  const fmt = (n: number | null | undefined): string =>
    typeof n === "number" ? n.toLocaleString("pt-BR") : "—";

  const cards = [
    {
      label: "Petições analisadas",
      value: fmt(data?.peticoes),
      helper: "no histórico",
      icon: <FileCheck className="h-5 w-5" />,
      accent: "text-[color:var(--color-primary)]",
    },
    {
      label: "Pareceres gerados",
      value: fmt(data?.pareceres),
      helper: pct(data?.pareceres ?? null, data?.peticoes ?? null),
      icon: <FileSignature className="h-5 w-5" />,
      accent: "text-[color:var(--color-success)]",
    },
    {
      label: "Skills ativas",
      value: fmt(data?.skills),
      helper: "instruções dos agentes",
      icon: <Sparkles className="h-5 w-5" />,
      accent: "text-[color:var(--color-warning)]",
    },
    {
      label: "Normas indexadas",
      value: fmt(data?.normas),
      helper: "leis, decretos e INs",
      icon: <BookOpen className="h-5 w-5" />,
      accent: "text-[color:var(--color-primary)]",
    },
  ];

  return (
    <section
      aria-labelledby="stats-heading"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <h2 id="stats-heading" className="sr-only">
        Estatísticas
      </h2>
      {cards.map((s) => (
        <Card key={s.label} className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>{s.label}</CardDescription>
              <span className={s.accent}>{s.icon}</span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold leading-none flex items-center gap-2">
              {isLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
              ) : (
                s.value
              )}
            </p>
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
              {isError ? "indisponível" : s.helper}
            </p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
