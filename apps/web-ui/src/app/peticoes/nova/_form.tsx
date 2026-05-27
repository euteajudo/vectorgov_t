/**
 * Formulário client-side para upload de petição.
 *
 * Fluxo:
 *  1. Usuário dropa PDF/DOCX (max 50MB).
 *  2. Preenche metadados (contrato, contratante/contratado, requerente,
 *     data do protocolo, descrição do fato alegado).
 *  3. Clica "Analisar" → POST /api/peticoes/upload (multipart).
 *  4. Backend responde com `id` e fase=`queued`.
 *  5. UI faz polling em GET /api/peticoes/:id a cada 1.5s mostrando
 *     a fase do pipeline PEVS (PLAN → EXECUTE → ANALYZE → VERIFY → SYNTHESIZE).
 *  6. Quando fase=`done`, redireciona para `/peticoes/[id]`.
 *
 * Validação:
 *  - PDF/DOCX obrigatório.
 *  - Razão social do contratante e contratado obrigatórias.
 *  - Fato alegado: mínimo 50 chars (mesmo que PeticaoSchema).
 *  - Data: YYYY-MM-DD (input type=date).
 */
"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileText,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  type PeticaoMetadata,
  uploadPeticao,
  getPeticao,
} from "@/lib/api";

const MAX_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Fases visíveis no progresso (em ordem de apresentação).
 */
const FASES_PEVS = [
  { id: "PLAN", label: "Planejamento", descricao: "Decompondo a petição em subtarefas" },
  { id: "EXECUTE", label: "Pesquisa", descricao: "Buscando normas e jurisprudência relevantes" },
  { id: "ANALYZE", label: "Análise", descricao: "Integrando descobertas e cálculos" },
  { id: "VERIFY", label: "Verificação", descricao: "Auditor checando cada citação byte-a-byte" },
  { id: "SYNTHESIZE", label: "Síntese", descricao: "Consolidando análise técnica" },
] as const;

type FaseId = (typeof FASES_PEVS)[number]["id"];

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

interface FormState extends PeticaoMetadata {}

const ESTADO_INICIAL: FormState = {
  contrato: "",
  contratante_razao_social: "",
  contratante_cnpj: "",
  contratado_razao_social: "",
  contratado_cnpj: "",
  requerente: "",
  data_protocolo: new Date().toISOString().slice(0, 10),
  fato_alegado: "",
};

export function NovaPeticaoForm() {
  const router = useRouter();
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(ESTADO_INICIAL);
  const [peticaoId, setPeticaoId] = React.useState<string | null>(null);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    maxSize: MAX_SIZE_BYTES,
    multiple: false,
    onDrop: (accepted) => {
      const file = accepted[0];
      if (file) {
        setArquivo(file);
        setErro(null);
      }
    },
    onDropRejected: (rejections) => {
      const first = rejections[0]?.errors[0];
      setErro(first?.message ?? "Arquivo rejeitado");
    },
  });

  // Mutation: faz o upload + recebe id da petição.
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error("Selecione um arquivo");
      return uploadPeticao(arquivo, form);
    },
    onSuccess: (data) => {
      setPeticaoId(data.id);
    },
    onError: (err) => {
      setErro(err instanceof Error ? err.message : "Erro no upload");
    },
  });

  // Polling: enquanto tem id e ainda não chegou em "done", refetch a cada 1.5s.
  const statusQuery = useQuery({
    queryKey: ["peticao-status", peticaoId],
    queryFn: () => (peticaoId ? getPeticao(peticaoId) : Promise.reject()),
    enabled: !!peticaoId,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 1500;
      if (data.fase === "done" || data.fase === "failed") return false;
      return 1500;
    },
  });

  // Redireciona quando fica "done".
  React.useEffect(() => {
    if (statusQuery.data?.fase === "done" && peticaoId) {
      // Pequeno delay para o usuário ver o "concluído".
      const t = setTimeout(() => router.push(`/peticoes/${peticaoId}`), 700);
      return () => clearTimeout(t);
    }
  }, [statusQuery.data, peticaoId, router]);

  // Validação básica antes de habilitar o botão.
  const podeEnviar =
    !!arquivo &&
    form.contratante_razao_social.trim().length > 0 &&
    form.contratado_razao_social.trim().length > 0 &&
    form.requerente.trim().length > 0 &&
    form.fato_alegado.trim().length >= 50 &&
    !uploadMutation.isPending;

  function atualizar<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    uploadMutation.mutate();
  }

  function removerArquivo() {
    setArquivo(null);
  }

  // Estado de "processando" — quando já tem ID e fase != done/failed.
  const processando =
    !!peticaoId &&
    statusQuery.data?.fase !== undefined &&
    statusQuery.data.fase !== "done" &&
    statusQuery.data.fase !== "failed";

  const concluido = statusQuery.data?.fase === "done";
  const falhou = statusQuery.data?.fase === "failed";

  // -----------------------------------------------------------------------
  // Render: split entre formulário e tela de progresso.
  // -----------------------------------------------------------------------
  if (peticaoId) {
    const faseAtual = statusQuery.data?.fase ?? "queued";
    const pct = statusQuery.data?.progresso_pct ?? 0;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {concluido ? (
              <CheckCircle2 className="h-5 w-5 text-[color:var(--color-success)]" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-primary)]" />
            )}
            {concluido
              ? "Análise concluída"
              : falhou
                ? "Falha na análise"
                : "Processando análise"}
          </CardTitle>
          <CardDescription>
            ID da petição:{" "}
            <code className="text-xs bg-[color:var(--color-muted)] px-1.5 py-0.5 rounded">
              {peticaoId}
            </code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Progress value={pct} />
          <ol className="space-y-3">
            {FASES_PEVS.map((fase) => {
              const order = (f: FaseId | "queued") =>
                ["queued", "PLAN", "EXECUTE", "ANALYZE", "VERIFY", "SYNTHESIZE", "done"].indexOf(f);
              const atualIdx = order(faseAtual as FaseId);
              const meuIdx = order(fase.id);
              const ativa = meuIdx === atualIdx;
              const passada = meuIdx < atualIdx || concluido;
              return (
                <li key={fase.id} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 h-5 w-5 rounded-full flex items-center justify-center text-xs font-semibold border",
                      passada
                        ? "bg-[color:var(--color-success)] text-white border-transparent"
                        : ativa
                          ? "bg-[color:var(--color-primary)] text-white border-transparent animate-pulse"
                          : "bg-transparent text-[color:var(--color-muted-foreground)] border-[color:var(--color-border)]",
                    )}
                  >
                    {passada ? "✓" : meuIdx}
                  </span>
                  <div className="flex-1 -mt-0.5">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        ativa
                          ? "text-[color:var(--color-primary)]"
                          : passada
                            ? "text-[color:var(--color-foreground)]"
                            : "text-[color:var(--color-muted-foreground)]",
                      )}
                    >
                      {fase.label}
                    </p>
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">
                      {fase.descricao}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {falhou && statusQuery.data?.erro ? (
            <p className="text-sm text-[color:var(--color-destructive)]">
              {statusQuery.data.erro}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Dropzone */}
      <Card>
        <CardHeader>
          <CardTitle>1. Arquivo da petição</CardTitle>
          <CardDescription>
            Aceitos: PDF e DOCX. Máximo 50 MB.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {arquivo ? (
            <div className="flex items-center gap-3 p-4 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/30">
              <FileText className="h-8 w-8 text-[color:var(--color-primary)]" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{arquivo.name}</p>
                <p className="text-xs text-[color:var(--color-muted-foreground)]">
                  {formatBytes(arquivo.size)} ·{" "}
                  {arquivo.type || "tipo desconhecido"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={removerArquivo}
                aria-label="Remover arquivo"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div
              {...getRootProps()}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center cursor-pointer transition-colors",
                isDragActive
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/5"
                  : "border-[color:var(--color-border)] hover:bg-[color:var(--color-accent)]",
              )}
            >
              <input {...getInputProps()} />
              <UploadCloud className="h-10 w-10 text-[color:var(--color-muted-foreground)]" />
              <p className="text-sm font-medium">
                {isDragActive
                  ? "Solte o arquivo aqui…"
                  : "Arraste o PDF ou clique para selecionar"}
              </p>
              <p className="text-xs text-[color:var(--color-muted-foreground)]">
                PDF ou DOCX · até 50 MB
              </p>
            </div>
          )}
          {erro ? (
            <p className="mt-2 text-sm text-[color:var(--color-destructive)]">
              {erro}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Metadados */}
      <Card>
        <CardHeader>
          <CardTitle>2. Dados do contrato e das partes</CardTitle>
          <CardDescription>
            Informações que serão referenciadas no parecer final.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="contrato">Número do contrato</Label>
            <Input
              id="contrato"
              placeholder="012/2024"
              value={form.contrato}
              onChange={(e) => atualizar("contrato", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="data_protocolo">Data do protocolo</Label>
            <Input
              id="data_protocolo"
              type="date"
              value={form.data_protocolo}
              onChange={(e) => atualizar("data_protocolo", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="requerente">Requerente (quem assinou)</Label>
            <Input
              id="requerente"
              placeholder="Dr. Fulano de Tal — OAB/SP 12.345"
              value={form.requerente}
              onChange={(e) => atualizar("requerente", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contratante_razao_social">Contratante (razão social)</Label>
            <Input
              id="contratante_razao_social"
              placeholder="Prefeitura Municipal de Exemplo/SP"
              value={form.contratante_razao_social}
              onChange={(e) =>
                atualizar("contratante_razao_social", e.target.value)
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contratante_cnpj">Contratante (CNPJ)</Label>
            <Input
              id="contratante_cnpj"
              placeholder="00.000.000/0000-00"
              value={form.contratante_cnpj ?? ""}
              onChange={(e) => atualizar("contratante_cnpj", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contratado_razao_social">Contratado (razão social)</Label>
            <Input
              id="contratado_razao_social"
              placeholder="Construtora Beta Ltda"
              value={form.contratado_razao_social}
              onChange={(e) =>
                atualizar("contratado_razao_social", e.target.value)
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contratado_cnpj">Contratado (CNPJ)</Label>
            <Input
              id="contratado_cnpj"
              placeholder="00.000.000/0000-00"
              value={form.contratado_cnpj ?? ""}
              onChange={(e) => atualizar("contratado_cnpj", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Fato alegado */}
      <Card>
        <CardHeader>
          <CardTitle>3. Fato superveniente alegado</CardTitle>
          <CardDescription>
            Descrição em prosa do fato que justifica o pedido de reequilíbrio
            (mínimo 50 caracteres).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={6}
            placeholder="Ex.: Variação atípica do INCC em 12% no período de execução, gerando impacto direto nos insumos de concreto e aço…"
            value={form.fato_alegado}
            onChange={(e) => atualizar("fato_alegado", e.target.value)}
          />
          <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
            {form.fato_alegado.length} / 50 caracteres mínimos
          </p>
        </CardContent>
      </Card>

      {/* Ações */}
      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setForm(ESTADO_INICIAL);
            setArquivo(null);
            setErro(null);
          }}
        >
          Limpar formulário
        </Button>
        <Button type="submit" disabled={!podeEnviar}>
          {uploadMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Enviando…
            </>
          ) : (
            "Analisar petição"
          )}
        </Button>
      </div>
    </form>
  );
}
