/**
 * Tabela paginada do histórico de petições.
 *
 * Filtros (todos opcionais):
 *  - Busca textual (full-text em contrato/contratante/contratado/veredito)
 *  - Contratante (substring)
 *  - Contratado (substring)
 *  - Veredito (select de 4 valores)
 *  - Data início / data fim (YYYY-MM-DD)
 *
 * Paginação: page + page_size em querystring; controles "Anterior" / "Próxima"
 * baseados em `total`.
 *
 * Click em linha → `/peticoes/[id]`.
 */
"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDate } from "@/lib/utils";
import { listarHistorico, type HistoricoFilters } from "@/lib/api";

const VEREDITO_LABEL: Record<string, { texto: string; variant: "success" | "destructive" | "warning" | "secondary" }> = {
  procedente: { texto: "Procedente", variant: "success" },
  parcialmente_procedente: { texto: "Parcial", variant: "warning" },
  improcedente: { texto: "Improcedente", variant: "destructive" },
  inconclusiva: { texto: "Inconclusiva", variant: "secondary" },
};

const VEREDITOS = [
  { value: "", label: "Todos" },
  { value: "procedente", label: "Procedente" },
  { value: "parcialmente_procedente", label: "Parcialmente procedente" },
  { value: "improcedente", label: "Improcedente" },
  { value: "inconclusiva", label: "Inconclusiva" },
];

const PAGE_SIZE = 10;

export function HistoricoTable() {
  const router = useRouter();
  const [filters, setFilters] = React.useState<HistoricoFilters>({
    page: 1,
    page_size: PAGE_SIZE,
  });
  const [filtroAberto, setFiltroAberto] = React.useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["historico", filters],
    queryFn: () => listarHistorico(filters),
  });

  function atualizarFiltro<K extends keyof HistoricoFilters>(
    k: K,
    v: HistoricoFilters[K],
  ) {
    setFilters((f) => ({ ...f, [k]: v, page: 1 }));
  }

  function limparFiltros() {
    setFilters({ page: 1, page_size: PAGE_SIZE });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const currentPage = data?.page ?? 1;

  const temFiltro = !!(
    filters.contratante ||
    filters.contratado ||
    filters.veredito ||
    filters.data_inicio ||
    filters.data_fim ||
    filters.q
  );

  return (
    <div className="space-y-4">
      {/* Barra de busca + toggle de filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--color-muted-foreground)]" />
          <Input
            placeholder="Buscar por contrato, contratante, contratado…"
            className="pl-9"
            value={filters.q ?? ""}
            onChange={(e) => atualizarFiltro("q", e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setFiltroAberto((v) => !v)}
          className={cn(temFiltro && "border-[color:var(--color-primary)]")}
        >
          <Filter className="h-4 w-4" />
          Filtros
          {temFiltro ? (
            <Badge variant="default" className="ml-1">
              ativos
            </Badge>
          ) : null}
        </Button>
        {temFiltro ? (
          <Button variant="ghost" onClick={limparFiltros}>
            <X className="h-4 w-4" />
            Limpar
          </Button>
        ) : null}
      </div>

      {/* Painel de filtros (collapsable) */}
      {filtroAberto ? (
        <Card>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="f-contratante">Contratante</Label>
              <Input
                id="f-contratante"
                placeholder="Prefeitura, secretaria…"
                value={filters.contratante ?? ""}
                onChange={(e) => atualizarFiltro("contratante", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-contratado">Contratado</Label>
              <Input
                id="f-contratado"
                placeholder="Razão social do contratado"
                value={filters.contratado ?? ""}
                onChange={(e) => atualizarFiltro("contratado", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-veredito">Veredito</Label>
              <select
                id="f-veredito"
                className="h-10 w-full rounded-md border border-[color:var(--color-input)] bg-transparent px-3 text-sm"
                value={filters.veredito ?? ""}
                onChange={(e) => atualizarFiltro("veredito", e.target.value || undefined)}
              >
                {VEREDITOS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-inicio">Protocolo de</Label>
              <Input
                id="f-inicio"
                type="date"
                value={filters.data_inicio ?? ""}
                onChange={(e) => atualizarFiltro("data_inicio", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-fim">Protocolo até</Label>
              <Input
                id="f-fim"
                type="date"
                value={filters.data_fim ?? ""}
                onChange={(e) => atualizarFiltro("data_fim", e.target.value)}
              />
            </div>
          </div>
        </Card>
      ) : null}

      {/* Tabela */}
      <Card>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : isError ? (
          <div className="py-12 text-center text-sm text-[color:var(--color-destructive)]">
            {error instanceof Error ? error.message : "Erro ao carregar histórico"}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contrato</TableHead>
                <TableHead>Contratante</TableHead>
                <TableHead>Contratado</TableHead>
                <TableHead>Data protocolo</TableHead>
                <TableHead>Veredito</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Parecer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-[color:var(--color-muted-foreground)]"
                  >
                    Nenhuma petição encontrada com esses filtros.
                  </TableCell>
                </TableRow>
              ) : (
                data?.items.map((it) => {
                  const cfg = VEREDITO_LABEL[it.veredito] ?? {
                    texto: it.veredito,
                    variant: "secondary" as const,
                  };
                  const scorePct = Math.round(it.score_confianca * 100);
                  return (
                    <TableRow
                      key={it.id}
                      onClick={() => router.push(`/peticoes/${it.id}`)}
                      className="cursor-pointer"
                    >
                      <TableCell>
                        <Link
                          href={`/peticoes/${it.id}`}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {it.contrato_numero}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {it.contratante}
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {it.contratado}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatDate(it.data_protocolo)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={cfg.variant}>{cfg.texto}</Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-sm font-semibold",
                          scorePct >= 80
                            ? "text-[color:var(--color-success)]"
                            : scorePct >= 50
                              ? "text-[color:var(--color-warning)]"
                              : "text-[color:var(--color-destructive)]",
                        )}
                      >
                        {scorePct}%
                      </TableCell>
                      <TableCell>
                        {it.tem_parecer ? (
                          it.parecer_aprovado ? (
                            <Badge variant="success">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Aprovado
                            </Badge>
                          ) : (
                            <Badge variant="warning">Gerado</Badge>
                          )
                        ) : (
                          <span className="text-xs text-[color:var(--color-muted-foreground)]">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Paginação */}
      {data && data.total > 0 ? (
        <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
          <p className="text-[color:var(--color-muted-foreground)]">
            Mostrando {(currentPage - 1) * data.page_size + 1}–
            {Math.min(currentPage * data.page_size, data.total)} de {data.total}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => atualizarFiltro("page", currentPage - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <span className="text-sm px-3">
              Página {currentPage} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => atualizarFiltro("page", currentPage + 1)}
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
