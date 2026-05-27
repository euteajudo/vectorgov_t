/**
 * Tela de geração e edição do parecer formal (Feature 2).
 *
 * Fluxo:
 *  1. Se ainda não há parecer, mostra botão "Gerar parecer" com indicador
 *     de progresso PEVS.
 *  2. Após gerar (ou se já existe), exibe editor side-by-side:
 *     - Markdown source (textarea editável local)
 *     - Preview (markdown → HTML simples, renderizado server-style).
 *  3. Seções colapsáveis (I-V).
 *  4. Botões: exportar DOCX, exportar PDF, marcar aprovado.
 *  5. Histórico de edições — versionamento simples em-memória (TODO: persistir).
 *
 * Renderização markdown: usamos uma função leve `renderMarkdown` que cobre
 * cabeçalhos, listas, parágrafos e ênfase. Para HTML rich seria melhor
 * adicionar `react-markdown`, mas evitamos a dep extra agora.
 */
"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileSignature,
  Loader2,
  RotateCcw,
  Save,
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
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDate } from "@/lib/utils";
import { gerarParecer, getParecer, getPeticao } from "@/lib/api";

interface ParecerSecao {
  numero: "I" | "II" | "III" | "IV" | "V";
  titulo: string;
  conteudo: string;
}

interface ParecerShape {
  id: string;
  analise_id: string;
  cabecalho: {
    numero: string;
    parecerista: string;
    orgao: string;
    assunto: string;
    data: string;
  };
  secoes: ParecerSecao[];
  conclusao_objetiva: string;
  recomendacoes: Array<{
    descricao: string;
    prioridade: string;
    prazo_dias?: number | null;
  }>;
  citacoes: unknown[];
  calculos: unknown[];
  gerado_em: string;
}

/**
 * Converte um parecer estruturado em markdown editável (fonte única).
 */
function parecerToMarkdown(p: ParecerShape): string {
  const lines: string[] = [];
  lines.push(`# Parecer ${p.cabecalho.numero}`);
  lines.push("");
  lines.push(`**Parecerista:** ${p.cabecalho.parecerista}  `);
  lines.push(`**Órgão:** ${p.cabecalho.orgao}  `);
  lines.push(`**Assunto:** ${p.cabecalho.assunto}  `);
  lines.push(`**Data:** ${formatDate(p.cabecalho.data)}`);
  lines.push("");
  for (const s of p.secoes) {
    lines.push(`## ${s.numero}. ${s.titulo}`);
    lines.push("");
    lines.push(s.conteudo);
    lines.push("");
  }
  lines.push(`## Conclusão objetiva`);
  lines.push("");
  lines.push(`> ${p.conclusao_objetiva}`);
  lines.push("");
  if (p.recomendacoes.length > 0) {
    lines.push(`## Recomendações`);
    lines.push("");
    for (const r of p.recomendacoes) {
      const prazo = r.prazo_dias ? ` (prazo: ${r.prazo_dias} dias)` : "";
      lines.push(`- **[${r.prioridade.toUpperCase()}]** ${r.descricao}${prazo}`);
    }
  }
  return lines.join("\n");
}

/**
 * Renderizador markdown minimalista para o preview.
 *
 * Cobre: headings (#, ##), bold (**), italic (*), blockquotes (>), listas (-),
 * parágrafos e quebras. Suficiente para o conteúdo padrão do parecer.
 */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let buffer: string[] = [];
  let listOpen = false;

  function flushParagraph() {
    if (buffer.length === 0) return;
    out.push(
      <p key={`p-${out.length}`} className="mb-3 leading-relaxed text-sm">
        {renderInline(buffer.join(" "))}
      </p>,
    );
    buffer = [];
  }
  function flushList(items: React.ReactNode[]) {
    out.push(
      <ul key={`ul-${out.length}`} className="mb-3 list-disc pl-5 space-y-1 text-sm">
        {items}
      </ul>,
    );
  }

  let listBuffer: React.ReactNode[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("# ")) {
      flushParagraph();
      if (listOpen) {
        flushList(listBuffer);
        listBuffer = [];
        listOpen = false;
      }
      out.push(
        <h1
          key={`h1-${out.length}`}
          className="text-2xl font-bold mt-4 mb-2"
        >
          {renderInline(line.slice(2))}
        </h1>,
      );
    } else if (line.startsWith("## ")) {
      flushParagraph();
      if (listOpen) {
        flushList(listBuffer);
        listBuffer = [];
        listOpen = false;
      }
      out.push(
        <h2
          key={`h2-${out.length}`}
          className="text-xl font-semibold mt-5 mb-2 border-b border-[color:var(--color-border)] pb-1"
        >
          {renderInline(line.slice(3))}
        </h2>,
      );
    } else if (line.startsWith("> ")) {
      flushParagraph();
      if (listOpen) {
        flushList(listBuffer);
        listBuffer = [];
        listOpen = false;
      }
      out.push(
        <blockquote
          key={`bq-${out.length}`}
          className="mb-3 border-l-4 border-[color:var(--color-primary)] pl-3 italic text-sm"
        >
          {renderInline(line.slice(2))}
        </blockquote>,
      );
    } else if (line.startsWith("- ")) {
      flushParagraph();
      listOpen = true;
      listBuffer.push(
        <li key={`li-${listBuffer.length}`}>{renderInline(line.slice(2))}</li>,
      );
    } else if (line === "") {
      flushParagraph();
      if (listOpen) {
        flushList(listBuffer);
        listBuffer = [];
        listOpen = false;
      }
    } else {
      if (listOpen) {
        flushList(listBuffer);
        listBuffer = [];
        listOpen = false;
      }
      buffer.push(line);
    }
  }
  flushParagraph();
  if (listOpen) flushList(listBuffer);
  return out;
}

/**
 * Renderiza ênfases inline (**bold**, *ital*). Simples sem nested.
 */
function renderInline(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    if (match[1]) {
      nodes.push(<strong key={`s-${i++}`}>{match[1]}</strong>);
    } else if (match[2]) {
      nodes.push(<em key={`e-${i++}`}>{match[2]}</em>);
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) nodes.push(text.slice(lastIdx));
  return nodes;
}

interface Versao {
  id: number;
  conteudo: string;
  salvo_em: string;
}

export function ParecerView({ peticaoId }: { peticaoId: string }) {
  const queryClient = useQueryClient();

  // Verifica primeiro se a petição existe e está pronta
  const peticaoQuery = useQuery({
    queryKey: ["peticao", peticaoId],
    queryFn: () => getPeticao(peticaoId),
  });

  // Verifica se já existe parecer
  const parecerQuery = useQuery({
    queryKey: ["parecer", peticaoId],
    queryFn: () => getParecer(peticaoId),
    enabled: peticaoQuery.data?.fase === "done",
    retry: (count, err) => {
      // 404 é esperado quando ainda não foi gerado.
      if (err instanceof Error && err.message.startsWith("404")) return false;
      return count < 1;
    },
  });

  const gerarMutation = useMutation({
    mutationFn: () => gerarParecer(peticaoId),
    onSuccess: (parecer) => {
      queryClient.setQueryData(["parecer", peticaoId], parecer);
    },
  });

  // Estado local do editor markdown + histórico de versões.
  const [markdown, setMarkdown] = React.useState("");
  const [aprovado, setAprovado] = React.useState(false);
  const [versoes, setVersoes] = React.useState<Versao[]>([]);
  const [secoesAbertas, setSecoesAbertas] = React.useState<Record<string, boolean>>({
    I: true,
    II: true,
    III: true,
    IV: false,
    V: false,
  });

  // Sincroniza markdown com o parecer assim que ele chega.
  React.useEffect(() => {
    const p = parecerQuery.data as ParecerShape | undefined;
    if (p && markdown === "") {
      setMarkdown(parecerToMarkdown(p));
    }
  }, [parecerQuery.data, markdown]);

  const parecer = parecerQuery.data as ParecerShape | undefined;
  const naoExiste =
    parecerQuery.isFetched &&
    parecerQuery.error instanceof Error &&
    parecerQuery.error.message.startsWith("404");

  function salvarVersao() {
    setVersoes((vs) => [
      ...vs,
      {
        id: vs.length + 1,
        conteudo: markdown,
        salvo_em: new Date().toISOString(),
      },
    ]);
  }

  function restaurarVersao(v: Versao) {
    setMarkdown(v.conteudo);
  }

  function toggleSecao(num: string) {
    setSecoesAbertas((s) => ({ ...s, [num]: !s[num] }));
  }

  // ---------------------------------------------------------------------
  // Renderização
  // ---------------------------------------------------------------------
  if (peticaoQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (peticaoQuery.data?.fase !== "done") {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Análise ainda em processamento</CardTitle>
          <CardDescription>
            Aguarde a conclusão da análise antes de gerar o parecer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href={`/peticoes/${peticaoId}`}>
              <ArrowLeft className="h-4 w-4" /> Voltar à análise
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (naoExiste && !gerarMutation.isPending && !parecer) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={`/peticoes/${peticaoId}`}>
              <ArrowLeft className="h-4 w-4" /> Voltar à análise
            </Link>
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Gerar parecer formal</CardTitle>
            <CardDescription>
              O Redator consome a análise verificada e produz parecer em 5
              seções (I-V) seguindo padrão AGU/Procuradorias.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => gerarMutation.mutate()}
              disabled={gerarMutation.isPending}
            >
              {gerarMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Gerando…
                </>
              ) : (
                <>
                  <FileSignature className="h-4 w-4" />
                  Gerar parecer
                </>
              )}
            </Button>
            {gerarMutation.error ? (
              <p className="mt-2 text-sm text-[color:var(--color-destructive)]">
                {gerarMutation.error instanceof Error
                  ? gerarMutation.error.message
                  : "Erro desconhecido"}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (parecerQuery.isLoading || gerarMutation.isPending) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-primary)]" />
            Redator em ação
          </CardTitle>
          <CardDescription>
            O agente Redator está sintetizando o parecer formal a partir da
            análise verificada. Isso costuma levar 10–30 segundos.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!parecer) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header com volta + ações principais */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/peticoes/${peticaoId}`}>
            <ArrowLeft className="h-4 w-4" /> Voltar à análise
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={salvarVersao}
            disabled={!markdown}
          >
            <Save className="h-4 w-4" />
            Salvar versão
          </Button>
          <Button variant="outline" size="sm" disabled title="TODO: exportar DOCX">
            <Download className="h-4 w-4" />
            DOCX
          </Button>
          <Button variant="outline" size="sm" disabled title="TODO: exportar PDF">
            <Download className="h-4 w-4" />
            PDF
          </Button>
          <Button
            variant={aprovado ? "success" : "default"}
            size="sm"
            onClick={() => setAprovado((v) => !v)}
          >
            <CheckCircle2 className="h-4 w-4" />
            {aprovado ? "Aprovado" : "Marcar como aprovado"}
          </Button>
        </div>
      </div>

      {/* Cabeçalho do parecer */}
      <Card>
        <CardHeader>
          <CardTitle>Parecer {parecer.cabecalho.numero}</CardTitle>
          <CardDescription>
            {parecer.cabecalho.assunto}
            {aprovado ? (
              <Badge variant="success" className="ml-2">
                APROVADO
              </Badge>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-[color:var(--color-muted-foreground)] uppercase">
              Parecerista
            </p>
            <p>{parecer.cabecalho.parecerista}</p>
          </div>
          <div>
            <p className="text-xs text-[color:var(--color-muted-foreground)] uppercase">
              Órgão
            </p>
            <p>{parecer.cabecalho.orgao}</p>
          </div>
          <div>
            <p className="text-xs text-[color:var(--color-muted-foreground)] uppercase">
              Data
            </p>
            <p>{formatDate(parecer.cabecalho.data)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Seções colapsáveis (visualização estruturada) */}
      <Card>
        <CardHeader>
          <CardTitle>Seções do parecer</CardTitle>
          <CardDescription>
            Estrutura formal I-V — clique para expandir/colapsar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {parecer.secoes.map((s) => {
            const open = secoesAbertas[s.numero];
            return (
              <div
                key={s.numero}
                className="rounded-md border border-[color:var(--color-border)] overflow-hidden"
              >
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-[color:var(--color-muted)]/40"
                  onClick={() => toggleSecao(s.numero)}
                >
                  <span className="font-semibold text-sm">
                    {s.numero}. {s.titulo}
                  </span>
                  {open ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                {open ? (
                  <div className="px-4 py-3 border-t border-[color:var(--color-border)] bg-[color:var(--color-muted)]/20 text-sm leading-relaxed whitespace-pre-line">
                    {s.conteudo}
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Editor side-by-side */}
      <Card>
        <CardHeader>
          <CardTitle>Editor (markdown + preview)</CardTitle>
          <CardDescription>
            Alterações ficam locais até &quot;Salvar versão&quot;. Mude o texto
            à esquerda e veja a renderização à direita.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)] mb-1">
                Markdown
              </p>
              <Textarea
                rows={24}
                className="font-mono text-xs"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)] mb-1">
                Preview
              </p>
              <div className="rounded-md border border-[color:var(--color-border)] bg-white p-4 min-h-[480px] overflow-auto">
                {renderMarkdown(markdown)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Histórico de versões */}
      {versoes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Histórico de edições
            </CardTitle>
            <CardDescription>
              Versionamento local — apenas nesta sessão. (TODO: persistir em D1)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {versoes.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--color-border)] px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Versão #{v.id}</p>
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">
                    Salvo em {formatDate(v.salvo_em)} ·{" "}
                    {v.conteudo.length.toLocaleString("pt-BR")} chars
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => restaurarVersao(v)}
                >
                  <RotateCcw className="h-4 w-4" />
                  Restaurar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Recomendações */}
      {parecer.recomendacoes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recomendações práticas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {parecer.recomendacoes.map((r, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-start gap-3 rounded-md border px-3 py-2.5",
                  r.prioridade === "urgente" || r.prioridade === "alta"
                    ? "border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/5"
                    : "border-[color:var(--color-border)]",
                )}
              >
                <Badge
                  variant={
                    r.prioridade === "urgente" || r.prioridade === "alta"
                      ? "warning"
                      : "secondary"
                  }
                >
                  {r.prioridade}
                </Badge>
                <div className="flex-1">
                  <p className="text-sm">{r.descricao}</p>
                  {r.prazo_dias ? (
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">
                      Prazo: {r.prazo_dias} dias
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
