/**
 * `/admin/acordaos/nova` — Ingestão de Acórdãos do TCU.
 *
 * Igual à interface de ingestão de leis: upload de **PDF**, **sem segredo**.
 * Fluxo:
 *  1. Usuário escolhe um PDF + número/ano/colegiado.
 *  2. Submit → `POST /ingestao/iniciar` no Worker `vectorgov-a-mcp`.
 *  3. Página faz polling de `GET /ingestao/status/:id` e mostra as fases.
 *
 * NOTA: o backend `vectorgov-a-mcp` (fora deste repo) precisa aceitar PDF para
 * o fluxo funcionar de ponta a ponta — validar com um upload real.
 */
"use client";

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { UploadCloud } from "lucide-react";
import { UploadDropzone } from "../../../../components/ingestao/UploadDropzone";
import { ContainerStatus } from "../../../../components/ContainerStatus";
import {
  COLEGIADOS,
  iniciarIngestaoAcordao,
  getStatusAcordao,
  type AcordaoStatus,
} from "../../../../lib/acordaos-api";

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

export default function AcordaosPage(): JSX.Element {
  const [form, setForm] = useState<FormState>(ESTADO_INICIAL);
  const [file, setFile] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState<AcordaoStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    if (!file) {
      setErro("Selecione um PDF antes de enviar.");
      return;
    }
    const ano = Number.parseInt(form.ano, 10);
    if (!Number.isFinite(ano) || ano < 1900 || ano > 2100) {
      setErro("Ano deve estar entre 1900 e 2100.");
      return;
    }

    setEnviando(true);
    try {
      const id = await iniciarIngestaoAcordao(file, {
        numero: form.numero.trim(),
        ano,
        colegiado: form.colegiado,
      });
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
          Envie o acórdão em PDF. O pipeline lê o arquivo e estrutura o acórdão,
          item a item, no repositório que alimenta a análise de reequilíbrio.
        </p>
      </div>

      <ContainerStatus />

      {erro && (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {erro}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Arquivo PDF */}
        <section>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Arquivo PDF
          </label>
          <UploadDropzone
            file={file}
            onFile={(f) => {
              setFile(f);
              setErro(null);
            }}
            onError={(msg) => setErro(msg)}
            disabled={enviando}
          />
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
