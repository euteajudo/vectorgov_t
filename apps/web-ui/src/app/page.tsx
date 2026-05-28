/**
 * Página inicial — dashboard com cards de estatísticas (dados reais via
 * DashboardStats) e atalhos para as principais features.
 */
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, FilePlus, Sparkles, Activity } from "lucide-react";
import { DashboardStats } from "./_stats";

export default function HomePage() {
  return (
    <div className="space-y-8">
      {/* Cabeçalho */}
      <header className="space-y-1">
        <p className="text-sm text-[color:var(--color-muted-foreground)] font-medium uppercase tracking-wide">
          Painel principal
        </p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Bem-vindo ao Vectorgov<span className="text-[color:var(--color-primary)]">_t</span>
        </h1>
        <p className="text-base text-[color:var(--color-muted-foreground)] max-w-2xl">
          Análise multi-agente de pedidos de reequilíbrio econômico-financeiro
          em contratos administrativos, com fundamentação verificada contra a
          base oficial de leis e jurisprudência.
        </p>
      </header>

      {/* Cards de stats (dados reais) */}
      <DashboardStats />

      {/* Ações rápidas */}
      <section aria-labelledby="quick-actions-heading" className="space-y-4">
        <h2 id="quick-actions-heading" className="text-xl font-semibold">
          Ações rápidas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <div className="h-9 w-9 rounded-md bg-[color:var(--color-primary)]/10 flex items-center justify-center text-[color:var(--color-primary)]">
                <FilePlus className="h-5 w-5" />
              </div>
              <CardTitle className="mt-3">Analisar nova petição</CardTitle>
              <CardDescription>
                Faça upload do PDF e os agentes geram análise técnica com
                fundamentação verificada.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild className="w-full">
                <Link href="/peticoes/nova">
                  Começar análise
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <div className="h-9 w-9 rounded-md bg-[color:var(--color-success)]/10 flex items-center justify-center text-[color:var(--color-success)]">
                <Activity className="h-5 w-5" />
              </div>
              <CardTitle className="mt-3">Ver histórico</CardTitle>
              <CardDescription>
                Petições já analisadas, pareceres aprovados e filtros por
                contratante e contratado.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="outline" className="w-full">
                <Link href="/historico">
                  Abrir histórico
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <div className="h-9 w-9 rounded-md bg-[color:var(--color-warning)]/10 flex items-center justify-center text-[color:var(--color-warning)]">
                <Sparkles className="h-5 w-5" />
              </div>
              <CardTitle className="mt-3">Gerenciar skills</CardTitle>
              <CardDescription>
                Edite instruções dos agentes, rode A/B tests e promova versões
                candidatas.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="outline" className="w-full">
                <Link href="/skills">
                  Ver skills
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </section>
    </div>
  );
}
