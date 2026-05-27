/**
 * Formulário client-side para upload de petição.
 *
 * Fluxo:
 *  1. Usuário seleciona PDF/DOCX (max 50MB).
 *  2. Preenche metadados estruturados (12 campos do PeticaoSchema +
 *     identificação do contrato/partes).
 *  3. Clica "Analisar" → POST /api/peticoes/upload com header
 *     X-Google-API-Key (lida do store, sessionStorage).
 *  4. Backend roda PEVS engine real em background.
 *  5. UI faz polling em GET /api/peticoes/:id a cada 1.5s mostrando
 *     a fase do pipeline PEVS (PLAN → EXECUTE → ANALYZE → VERIFY → done).
 *  6. Quando fase=`done`, redireciona para `/peticoes/[id]`.
 */
"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileText,
  KeyRound,
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
import { useApiKey } from "@/lib/api-key-store";

const MAX_SIZE_BYTES = 50 * 1024 * 1024;

const FASES_PEVS = [
  { id: "PLAN", label: "Planejamento", descricao: "Decompondo a petição em subtarefas" },
  { id: "EXECUTE", label: "Pesquisa", descricao: "Buscando normas e jurisprudência relevantes" },
  { id: "ANALYZE", label: "Análise", descricao: "Integrando descobertas e cálculos" },
  { id: "VERIFY", label: "Verificação", descricao: "Auditor checando cada citação byte-a-byte" },
  { id: "SYNTHESIZE", label: "Síntese", descricao: "Consolidando análise técnica" },
] as const;

type FaseId = (typeof FASES_PEVS)[number]["id"];

const MODALIDADES: Array<{
  value: PeticaoMetadata["modalidade"];
  label: string;
}> = [
  { value: "pregao_eletronico", label: "Pregão eletrônico" },
  { value: "pregao_presencial", label: "Pregão presencial" },
  { value: "concorrencia", label: "Concorrência" },
  { value: "dispensa", label: "Dispensa" },
  { value: "inexigibilidade", label: "Inexigibilidade" },
  { value: "concurso", label: "Concurso" },
  { value: "leilao", label: "Leilão" },
  { value: "dialogo_competitivo", label: "Diálogo competitivo" },
  { value: "outro", label: "Outro" },
];

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

type FormState = PeticaoMetadata & { base_legal_raw: string };

const ESTADO_INICIAL: FormState = {
  contrato_numero: "",
  requerente: "",
  contratante: "",
  contratante_cnpj: "",
  contratado: "",
  contratado_cnpj: "",
  data_protocolo: new Date().toISOString().slice(0, 10),
  objeto: "",
  modalidade: "outro",
  valor_contrato_centavos: 0,
  data_assinatura: new Date().toISOString().slice(0, 10),
  fato_alegado: "",
  base_legal_invocada: [],
  base_legal_raw: "",
};

export function NovaPeticaoForm() {
  const router = useRouter();
  const { apiKey, ready: apiKeyReady } = useApiKey();
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

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error("Selecione um arquivo");
      if (!apiKey) throw new Error("API key ausente");
      const baseLegal = form.base_legal_raw
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const metadata: PeticaoMetadata = {
        contrato_numero: form.contrato_numero,
        requerente: form.requerente,
        contratante: form.contratante,
        contratante_cnpj: form.contratante_cnpj,
        contratado: form.contratado,
        contratado_cnpj: form.contratado_cnpj,
        data_protocolo: form.data_protocolo,
        objeto: form.objeto,
        modalidade: form.modalidade,
        valor_contrato_centavos: form.valor_contrato_centavos,
        data_assinatura: form.data_assinatura,
        fato_alegado: form.fato_alegado,
        base_legal_invocada: baseLegal,
      };
      return uploadPeticao(arquivo, metadata, apiKey);
    },
    onSuccess: (data) => {
      setPeticaoId(data.id);
    },
    onError: (err) => {
      setErro(err instanceof Error ? err.message : "Erro no upload");
    },
  });

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

  React.useEffect(() => {
    if (statusQuery.data?.fase === "done" && peticaoId) {
      const t = setTimeout(() => router.push(`/peticoes/${peticaoId}`), 700);
      return () => clearTimeout(t);
    }
  }, [statusQuery.data, peticaoId, router]);

  const valorBRL = form.valor_contrato_centavos / 100;

  const podeEnviar =
    !!arquivo &&
    !!apiKey &&
    form.contrato_numero.trim().length > 0 &&
    form.requerente.trim().length > 0 &&
    form.contratante.trim().length > 0 &&
    form.contratado.trim().length > 0 &&
    form.objeto.trim().length > 0 &&
    form.valor_contrato_centavos > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.data_assinatura) &&
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

  const concluido = statusQuery.data?.fase === "done";
  const falhou = statusQuery.data?.fase === "failed";

  // --------------------------- tela de progresso ---------------------------
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

  // --------------------------- empty state sem key ---------------------------
  if (apiKeyReady && !apiKey) {
    return (
      <Card>
        <CardContent className="py-10">
          <div className="max-w-md mx-auto text-center space-y-3">
            <KeyRound className="h-10 w-10 text-amber-500 mx-auto" />
            <p className="text-sm">
              Para analisar uma petição você precisa configurar sua API key do
              Google. O pipeline PEVS dispara várias chamadas ao Gemini.
            </p>
            <Link
              href="/admin/config"
              className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Configurar API key
            </Link>
          </div>
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
                onClick={() => setArquivo(null)}
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

      {/* Identificação das partes */}
      <Card>
        <CardHeader>
          <CardTitle>2. Identificação</CardTitle>
          <CardDescription>
            Quem é o requerente e quais são as partes do contrato.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <Label htmlFor="contratante">Contratante (razão social)</Label>
            <Input
              id="contratante"
              placeholder="Prefeitura Municipal de Exemplo/SP"
              value={form.contratante}
              onChange={(e) => atualizar("contratante", e.target.value)}
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
            <Label htmlFor="contratado">Contratado (razão social)</Label>
            <Input
              id="contratado"
              placeholder="Construtora Beta Ltda"
              value={form.contratado}
              onChange={(e) => atualizar("contratado", e.target.value)}
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

      {/* Contrato */}
      <Card>
        <CardHeader>
          <CardTitle>3. Dados do contrato</CardTitle>
          <CardDescription>
            Campos usados pelo Pesquisador para encontrar normas aplicáveis.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="contrato_numero">Número do contrato</Label>
            <Input
              id="contrato_numero"
              placeholder="012/2024"
              value={form.contrato_numero}
              onChange={(e) => atualizar("contrato_numero", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="modalidade">Modalidade de licitação</Label>
            <select
              id="modalidade"
              className="w-full rounded-md border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-sm"
              value={form.modalidade}
              onChange={(e) =>
                atualizar(
                  "modalidade",
                  e.target.value as PeticaoMetadata["modalidade"],
                )
              }
            >
              {MODALIDADES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="objeto">Objeto do contrato</Label>
            <Input
              id="objeto"
              placeholder="Construção de unidade básica de saúde no bairro X"
              value={form.objeto}
              onChange={(e) => atualizar("objeto", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="data_assinatura">Data de assinatura</Label>
            <Input
              id="data_assinatura"
              type="date"
              value={form.data_assinatura}
              onChange={(e) => atualizar("data_assinatura", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="valor_brl">Valor do contrato (R$)</Label>
            <Input
              id="valor_brl"
              type="number"
              step="0.01"
              placeholder="1500000.00"
              value={valorBRL === 0 ? "" : valorBRL.toFixed(2)}
              onChange={(e) => {
                const reais = Number.parseFloat(e.target.value);
                if (Number.isFinite(reais) && reais >= 0) {
                  atualizar(
                    "valor_contrato_centavos",
                    Math.round(reais * 100),
                  );
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="data_protocolo">Data do protocolo da petição</Label>
            <Input
              id="data_protocolo"
              type="date"
              value={form.data_protocolo}
              onChange={(e) => atualizar("data_protocolo", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Fato alegado + base legal */}
      <Card>
        <CardHeader>
          <CardTitle>4. Fato superveniente alegado</CardTitle>
          <CardDescription>
            Descrição em prosa do fato que justifica o pedido de reequilíbrio
            (mínimo 50 caracteres). É a entrada principal do Pesquisador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Textarea
              rows={6}
              placeholder="Ex.: Variação atípica do INCC em 12% no período de execução, gerando impacto direto nos insumos de concreto e aço…"
              value={form.fato_alegado}
              onChange={(e) => atualizar("fato_alegado", e.target.value)}
            />
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
              {form.fato_alegado.length} / 50 caracteres mínimos
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="base_legal">
              Base legal invocada (uma por linha)
            </Label>
            <Textarea
              id="base_legal"
              rows={3}
              placeholder={
                "Art. 124, II, d, Lei nº 14.133/2021\nLC 214/2025, art. 30"
              }
              value={form.base_legal_raw}
              onChange={(e) => atualizar("base_legal_raw", e.target.value)}
            />
            <p className="text-xs text-[color:var(--color-muted-foreground)]">
              Opcional. Cada linha é uma referência separada.
            </p>
          </div>
        </CardContent>
      </Card>

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
