/**
 * `/admin/acordaos` — Ingestão de Acórdãos do TCU.
 *
 * Reconstruído a partir do bundle deployado (o source original foi feito em
 * outra máquina e nunca chegou a este repo). Fluxo:
 *  1. Usuário cola o segredo de ingestão (salvo no browser).
 *  2. Escolhe um arquivo Markdown + número/ano/colegiado.
 *  3. Submit → `POST /ingestao/iniciar` no Worker `vectorgov-a-mcp`.
 *  4. Página faz polling de `GET /ingestao/status/:id` e mostra as fases.
 */
"use client";

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { FileText, ShieldCheck, UploadCloud } from "lucide-react";
import {
  COLEGIADOS,
  EXTENSOES_ACEITAS,
  getSegredo,
  setSegredo,
  iniciarIngestaoAcordao,
  getStatusAcordao,
  type AcordaoStatus,
} from "../../../lib/acordaos-api";

interface FormState {
  numero: string;
  ano: string;
  colegiado: string;
}

const ESTADO_INICIAL: FormState = {
  numero: "",
  ano: String(new Date().getFullYear()),
  colegiado: COLEGIADOS[0].value,
};

/** Rótulos amigáveis para as fases conhecidas do pipeline. */
const FASE_LABEL: Record<string, string> = {
  recebido: "Aguardando início do pipeline",
  estruturando: "Lê o arquivo e estrutura o acórdão",
  normalizando: "Normaliza em Markdown por item",
  done: "Concluído",
  failed: "Falhou",
};

function temExtensaoMarkdown(nome: string): boolean {
  const lower = nome.toLowerCase();
  return EXTENSOES_ACEITAS.some((ext) => lower.endsWith(ext));
}

export default function AcordaosPage(): JSX.Element {
  const [segredo, setSegredoState] = useState("");
  const [form, setForm] = useState<FormState>(ESTADO_INICIAL);
  const [file, setFile] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState<AcordaoStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Carrega o segredo salvo no browser no primeiro mount.
  useEffect(() => {
    setSegredoState(getSegredo());
  }, []);

  // Limpa o polling ao desmontar.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function atualizar<K extends keyof FormState>(campo: K, valor: FormState[K]): void {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  function iniciarPolling(id: string): void {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await getStatusAcordao(id);
        if (!s) return;
        setStatus(s);
        const fase = s.fase ?? s.status;
        if (fase === "done" || fase === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setEnviando(false);
        }
      } catch {
        // erro transitório de rede — o próximo tick tenta de novo.
      }
    }, 2000);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErro(null);
    setStatus(null);

    if (!segredo.trim()) {
      setErro("Informe o segredo de ingestão.");
      return;
    }
    if (!file || !temExtensaoMarkdown(file.name)) {
      setErro("Selecione um arquivo Markdown (.md).");
      return;
    }
    const ano = Number.parseInt(form.ano, 10);
    if (!Number.isFinite(ano) || ano < 1900 || ano > 2100) {
      setErro("Ano deve estar entre 1900 e 2100.");
      return;
    }

    setSegredo(segredo); // persiste no browser
    setEnviando(true);
    try {
      const id = await iniciarIngestaoAcordao(
        file,
        { numero: form.numero.trim(), ano, colegiado: form.colegiado },
        segredo,
      );
      setStatus({ fase: "recebido", progresso_pct: 0 });
      iniciarPolling(id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setEnviando(false);
    }
  }

  const fase = status?.fase ?? status?.status ?? "";
  const concluido = fase === "done";
  const falhou = fase === "failed";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <UploadCloud className="h-6 w-6" />
          Ingestão de Acórdãos do TCU
        </h1>
        <p className="text-sm text-gray-500">
          Envie o acórdão em Markdown. O pipeline lê o arquivo e estrutura o
          acórdão, item a item, no repositório que alimenta a análise de
          reequilíbrio.
        </p>
      </div>

      {erro && (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {erro}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Segredo de ingestão */}
        <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
          <label
            htmlFor="segredo"
            className="flex items-center gap-2 text-sm font-medium text-gray-700"
          >
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            Segredo de ingestão
          </label>
          <input
            id="segredo"
            type="password"
            value={segredo}
            onChange={(e) => setSegredoState(e.target.value)}
            placeholder="Cole aqui o segredo (salvo neste navegador)"
            autoComplete="off"
            className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </section>

        {/* Arquivo Markdown */}
        <section>
          <label
            htmlFor="arquivo"
            className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700"
          >
            <FileText className="h-4 w-4" />
            Arquivo Markdown
          </label>
          <input
            id="arquivo"
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setErro(null);
            }}
            disabled={enviando}
            className="block w-full text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
          />
          {file && (
            <p className="mt-1 text-xs text-gray-500">
              Enviado como Markdown: <span className="font-mono">{file.name}</span>
            </p>
          )}
        </section>

        {/* Metadata */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="numero" className="mb-1 block text-sm font-medium text-gray-700">
              Número
            </label>
            <input
              id="numero"
              type="text"
              required
              placeholder="1234/2024"
              value={form.numero}
              onChange={(e) => atualizar("numero", e.target.value)}
              disabled={enviando}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>

          <div>
            <label htmlFor="ano" className="mb-1 block text-sm font-medium text-gray-700">
              Ano
            </label>
            <input
              id="ano"
              type="number"
              required
              min={1900}
              max={2100}
              value={form.ano}
              onChange={(e) => atualizar("ano", e.target.value)}
              disabled={enviando}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>

          <div>
            <label htmlFor="colegiado" className="mb-1 block text-sm font-medium text-gray-700">
              Colegiado
            </label>
            <select
              id="colegiado"
              value={form.colegiado}
              onChange={(e) => atualizar("colegiado", e.target.value)}
              disabled={enviando}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            >
              {COLEGIADOS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <button
            type="submit"
            disabled={enviando}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {enviando ? "Enviando..." : "Ingerir acórdão"}
          </button>
        </div>
      </form>

      {/* Status da ingestão */}
      {status && (
        <section
          className={`rounded-lg border p-4 ${
            falhou
              ? "border-red-300 bg-red-50"
              : concluido
                ? "border-green-200 bg-green-50/40"
                : "border-blue-300 bg-blue-50"
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              Status da ingestão
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                falhou
                  ? "bg-red-100 text-red-800"
                  : concluido
                    ? "bg-green-100 text-green-800"
                    : "bg-blue-100 text-blue-800 animate-pulse"
              }`}
            >
              {FASE_LABEL[fase] ?? fase ?? "—"}
            </span>
          </div>

          {typeof status.progresso_pct === "number" && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full ${
                  falhou ? "bg-red-500" : concluido ? "bg-green-500" : "bg-blue-500"
                }`}
                style={{ width: `${Math.max(0, Math.min(100, status.progresso_pct))}%` }}
              />
            </div>
          )}

          <dl className="mt-3 space-y-1 text-sm text-gray-700">
            {status.mensagem && (
              <div>
                <span className="text-gray-500">Mensagem: </span>
                {status.mensagem}
              </div>
            )}
            {typeof status.tokens_consumidos === "number" && (
              <div>
                <span className="text-gray-500">Tokens: </span>
                {status.tokens_consumidos}
              </div>
            )}
            {status.acordao_id && (
              <div>
                <span className="text-gray-500">Acórdão: </span>
                <span className="font-mono">{status.acordao_id}</span>
              </div>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}
