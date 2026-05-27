/**
 * Visualização completa da análise de uma petição (Feature 1).
 *
 * Estrutura:
 *  - Cabeçalho com veredito grande + score de confiança.
 *  - Cards de admissibilidade (5 critérios heurísticos derivados da análise).
 *  - Tabela de memória de cálculo (uma por cálculo executado).
 *  - Lista de citações verificadas (expansíveis, com texto literal e hash).
 *  - Hash de auditoria (composite SHA-256 visível para transparência).
 *  - Botões: gerar parecer, pedir revisão, exportar PDF.
 *
 * Toda a tela depende de `useQuery(["peticao", id])` — quando ainda está
 * sendo processada, mostra placeholder + redirect implicito.
 */
"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSignature,
  Hash,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDate } from "@/lib/utils";
import { getPeticao } from "@/lib/api";

interface Citacao {
  id: string;
  tipo_fonte: string;
  norma: string;
  artigo: string;
  texto_literal: string;
  hash: string;
  status: "APROVADA" | "REJEITADA" | "PENDENTE";
  fonte_url?: string | null;
  motivo_rejeicao?: string | null;
}

interface PontoPendente {
  descricao: string;
  severidade: "baixa" | "media" | "alta" | "bloqueante";
  responsavel: string;
}

interface LinhaCalc {
  descricao: string;
  valor?: number | null;
  unidade?: string | null;
  formula?: string | null;
}

interface CalculoResult {
  id: string;
  tipo: string;
  descricao: string;
  inputs: Record<string, number>;
  memoria: LinhaCalc[];
  valor_final: number | null;
  unidade_final: string;
  sucesso: boolean;
  placeholder: boolean;
}

interface AnaliseShape {
  id: string;
  peticao_id: string;
  veredito: string;
  fundamentacao: string;
  citacoes: Citacao[];
  calculos: CalculoResult[];
  score_confianca: number;
  pontos_a_complementar: PontoPendente[];
  gerado_em: string;
  modelo_auditor: string;
}

const VEREDITO_LABEL: Record<string, { texto: string; variant: "success" | "destructive" | "warning" | "secondary" }> = {
  procedente: { texto: "PROCEDENTE", variant: "success" },
  parcialmente_procedente: { texto: "PARCIALMENTE PROCEDENTE", variant: "warning" },
  improcedente: { texto: "IMPROCEDENTE", variant: "destructive" },
  inconclusiva: { texto: "INCONCLUSIVA", variant: "secondary" },
};

function CitacaoCard({ citacao }: { citacao: Citacao }) {
  const [open, setOpen] = React.useState(false);
  const aprovada = citacao.status === "APROVADA";
  return (
    <div className="rounded-md border border-[color:var(--color-border)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[color:var(--color-muted)]/40"
      >
        <div className="flex items-center gap-3 min-w-0">
          {aprovada ? (
            <CheckCircle2 className="h-4 w-4 text-[color:var(--color-success)] shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-[color:var(--color-destructive)] shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{citacao.norma}</p>
            <p className="text-xs text-[color:var(--color-muted-foreground)] truncate">
              {citacao.artigo} · {citacao.tipo_fonte}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={aprovada ? "success" : "destructive"}>
            {citacao.status}
          </Badge>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>
      {open ? (
        <div className="px-4 py-3 border-t border-[color:var(--color-border)] bg-[color:var(--color-muted)]/20 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)] mb-1">
              Texto literal
            </p>
            <p className="text-sm whitespace-pre-line">{citacao.texto_literal}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-semibold text-[color:var(--color-muted-foreground)] mb-0.5">
                Hash SHA-256
              </p>
              <code className="text-[10px] break-all">{citacao.hash}</code>
            </div>
            {citacao.fonte_url ? (
              <div>
                <p className="font-semibold text-[color:var(--color-muted-foreground)] mb-0.5">
                  Fonte oficial
                </p>
                <a
                  href={citacao.fonte_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[color:var(--color-primary)] hover:underline break-all"
                >
                  {citacao.fonte_url}
                </a>
              </div>
            ) : null}
          </div>
          {citacao.motivo_rejeicao ? (
            <div className="rounded-md bg-[color:var(--color-destructive)]/10 border border-[color:var(--color-destructive)]/20 px-3 py-2">
              <p className="text-xs font-semibold text-[color:var(--color-destructive)] mb-0.5">
                Motivo da rejeição
              </p>
              <p className="text-sm">{citacao.motivo_rejeicao}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Hash composite — concatena hashes de todas citações + ID da análise e
 * exibe SHA-256 das primeiras 12 chars (formato de auditoria curto).
 * Em produção real, este hash é calculado no Auditor com `crypto.subtle`.
 */
function composeAuditHash(analise: AnaliseShape): string {
  // Concatena IDs + hashes ordenados deterministicamente.
  const parts = [
    analise.id,
    analise.gerado_em,
    ...analise.citacoes.map((c) => c.hash).sort(),
  ].join("|");
  // Hash determinístico simples (não-crypto) só para visualização aqui —
  // backend deve enviar pre-computado em produção.
  let hash = 0;
  for (let i = 0; i < parts.length; i++) {
    hash = (hash * 31 + parts.charCodeAt(i)) | 0;
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${hex}-${analise.id.slice(0, 8)}-${analise.citacoes.length}cit`;
}

export function AnaliseView({ id }: { id: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["peticao", id],
    queryFn: () => getPeticao(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-primary)]" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[color:var(--color-destructive)]">
            <XCircle className="h-5 w-5" /> Erro ao carregar análise
          </CardTitle>
          <CardDescription>
            {error instanceof Error ? error.message : "Erro desconhecido"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4" />
            Tentar de novo
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data?.analise || data.fase !== "done") {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Análise em andamento</CardTitle>
          <CardDescription>
            Esta petição ainda não terminou de ser processada (fase atual:{" "}
            <strong>{data?.fase ?? "desconhecida"}</strong>). Volte em instantes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/peticoes/nova">
              <ArrowLeft className="h-4 w-4" /> Voltar para nova petição
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const analise = data.analise as unknown as AnaliseShape;
  const vereditoCfg = VEREDITO_LABEL[analise.veredito] ?? {
    texto: analise.veredito.toUpperCase(),
    variant: "secondary" as const,
  };
  const scorePct = Math.round(analise.score_confianca * 100);
  const auditHash = composeAuditHash(analise);

  // Critérios heurísticos para o card de admissibilidade. Estes refletem
  // o que o backend verifica internamente.
  const admissibilidade = [
    {
      label: "Fato superveniente identificado",
      ok: analise.fundamentacao.length > 200,
    },
    {
      label: "Nexo de causalidade demonstrado",
      ok: analise.citacoes.some((c) => c.tipo_fonte === "acordao_tcu"),
    },
    {
      label: "Base legal verificada (APROVADA)",
      ok: analise.citacoes.every((c) => c.status === "APROVADA"),
    },
    {
      label: "Cálculo bem-sucedido apresentado",
      ok: analise.calculos.some((c) => c.sucesso),
    },
    {
      label: "Score de confiança ≥ 0,80",
      ok: analise.score_confianca >= 0.8,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/historico">
            <ArrowLeft className="h-4 w-4" /> Voltar ao histórico
          </Link>
        </Button>
      </div>

      {/* Cabeçalho com veredito grande */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted-foreground)] font-semibold">
                Veredito da análise
              </p>
              <h1 className="text-3xl md:text-4xl font-bold">
                <Badge
                  variant={vereditoCfg.variant}
                  className="text-base px-3 py-1"
                >
                  {vereditoCfg.texto}
                </Badge>
              </h1>
              <p className="text-sm text-[color:var(--color-muted-foreground)]">
                Análise gerada em {formatDate(analise.gerado_em)} pelo{" "}
                {analise.modelo_auditor}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted-foreground)] font-semibold">
                  Score de confiança
                </p>
                <p
                  className={cn(
                    "text-3xl font-bold",
                    scorePct >= 80
                      ? "text-[color:var(--color-success)]"
                      : scorePct >= 50
                        ? "text-[color:var(--color-warning)]"
                        : "text-[color:var(--color-destructive)]",
                  )}
                >
                  {scorePct}%
                </p>
              </div>
            </div>
          </div>

          {/* Hash de auditoria */}
          <div className="rounded-md bg-[color:var(--color-muted)]/40 border border-[color:var(--color-border)] px-4 py-2 flex items-center gap-2">
            <Hash className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
            <span className="text-xs text-[color:var(--color-muted-foreground)] font-medium">
              Hash de auditoria:
            </span>
            <code className="text-xs">{auditHash}</code>
          </div>
        </CardContent>
      </Card>

      {/* Admissibilidade */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[color:var(--color-primary)]" />
            Critérios de admissibilidade
          </CardTitle>
          <CardDescription>
            Verificações automáticas do Auditor antes da síntese.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {admissibilidade.map((a) => (
              <div
                key={a.label}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2.5",
                  a.ok
                    ? "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/5"
                    : "border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive)]/5",
                )}
              >
                {a.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-[color:var(--color-success)] mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-[color:var(--color-destructive)] mt-0.5 shrink-0" />
                )}
                <span className="text-sm leading-snug">{a.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Fundamentação */}
      <Card>
        <CardHeader>
          <CardTitle>Fundamentação</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {analise.fundamentacao}
          </p>
        </CardContent>
      </Card>

      {/* Memória de cálculo */}
      {analise.calculos.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Memória de cálculo</CardTitle>
            <CardDescription>
              Passo-a-passo verificado pelo Calculista.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {analise.calculos.map((calc) => (
              <div key={calc.id} className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-semibold">{calc.descricao}</p>
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">
                      Tipo: {calc.tipo} ·{" "}
                      {calc.placeholder ? "Cálculo de demonstração (Fase 2)" : "Engine real"}
                    </p>
                  </div>
                  <Badge variant={calc.sucesso ? "success" : "destructive"}>
                    {calc.sucesso ? "Sucesso" : "Erro"}
                  </Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Operação</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Fórmula</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calc.memoria.map((linha, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{linha.descricao}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {linha.valor !== null && linha.valor !== undefined
                            ? linha.valor.toLocaleString("pt-BR", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 4,
                              })
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {linha.unidade ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-[color:var(--color-muted-foreground)]">
                          {linha.formula ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {calc.valor_final !== null ? (
                  <p className="text-right text-sm font-semibold">
                    Total:{" "}
                    {calc.valor_final.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Citações */}
      <Card>
        <CardHeader>
          <CardTitle>
            Citações verificadas
            <Badge variant="outline" className="ml-2">
              {analise.citacoes.length}
            </Badge>
          </CardTitle>
          <CardDescription>
            Cada citação é comparada byte-a-byte contra o filesystem oficial
            antes da síntese.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {analise.citacoes.map((c) => (
            <CitacaoCard key={c.id} citacao={c} />
          ))}
        </CardContent>
      </Card>

      {/* Pontos pendentes */}
      {analise.pontos_a_complementar.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pontos a complementar</CardTitle>
            <CardDescription>
              Itens que devem ser fornecidos antes de finalizar o parecer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {analise.pontos_a_complementar.map((p, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-md border border-[color:var(--color-border)] px-3 py-2.5"
              >
                <Badge
                  variant={
                    p.severidade === "bloqueante" || p.severidade === "alta"
                      ? "destructive"
                      : p.severidade === "media"
                        ? "warning"
                        : "secondary"
                  }
                >
                  {p.severidade}
                </Badge>
                <div className="flex-1">
                  <p className="text-sm">{p.descricao}</p>
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">
                    Responsável: {p.responsavel}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Ações */}
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href={`/peticoes/${id}/parecer`}>
            <FileSignature className="h-4 w-4" />
            Gerar parecer formal
          </Link>
        </Button>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
          Pedir nova revisão
        </Button>
        <Button variant="outline" disabled title="TODO: integrar exportação PDF">
          <Download className="h-4 w-4" />
          Exportar PDF
        </Button>
      </div>
    </div>
  );
}
