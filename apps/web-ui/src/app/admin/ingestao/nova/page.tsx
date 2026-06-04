/**
 * `/admin/ingestao/nova` — formulário de upload + metadata.
 *
 * Fluxo:
 *  1. Usuário escolhe PDF + preenche 5 campos de metadata.
 *  2. Submit → POST `/ingestao/iniciar` via `uploadNorma()`.
 *  3. Em sucesso (202), redireciona para `/admin/ingestao/status/[id]`.
 *  4. Em erro, mostra mensagem no topo do form e mantém os campos.
 *
 * Validação:
 *  - PDF: feita pelo `UploadDropzone`.
 *  - Metadata: HTML5 `required` + verificação manual antes do submit
 *    (lei_id slug, ano > 1900, data ISO).
 */
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type JSX } from "react";
import { UploadDropzone } from "../../../../components/ingestao/UploadDropzone";
import { ContainerStatus } from "../../../../components/ContainerStatus";
import { uploadNorma } from "../../../../lib/ingestao-api";

/** Espelha `NormaTipoSchema` do `@vectorgov-t/schemas/pipeline`. */
const TIPOS = [
  { value: "lei_complementar", label: "Lei Complementar" },
  { value: "lei", label: "Lei" },
  { value: "decreto", label: "Decreto" },
  { value: "emenda_constitucional", label: "Emenda Constitucional" },
  { value: "instrucao_normativa", label: "Instrução Normativa" },
];

const SLUG_REGEX = /^[a-z0-9-]+$/;
const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface FormState {
  lei_id: string;
  lei_tipo: string;
  numero: string;
  ano: string; // string no estado para casar com input HTML
  data_publicacao: string;
}

const ESTADO_INICIAL: FormState = {
  lei_id: "",
  lei_tipo: "lei_complementar",
  numero: "",
  ano: String(new Date().getFullYear()),
  data_publicacao: "",
};

function validarForm(s: FormState, file: File | null): string | null {
  if (!file) return "Selecione um PDF antes de enviar";
  if (!SLUG_REGEX.test(s.lei_id)) {
    return "lei_id deve ser slug minúsculo (a-z, 0-9, -). Ex.: lc-214-2025";
  }
  if (!s.numero.trim()) return "Número da norma é obrigatório";
  const ano = Number.parseInt(s.ano, 10);
  if (!Number.isFinite(ano) || ano < 1900 || ano > 2100) {
    return "Ano deve estar entre 1900 e 2100";
  }
  if (!DATA_REGEX.test(s.data_publicacao)) {
    return "data_publicacao deve estar no formato YYYY-MM-DD";
  }
  return null;
}

export default function NovaIngestaoPage(): JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(ESTADO_INICIAL);
  const [file, setFile] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function atualizar<K extends keyof FormState>(campo: K, valor: FormState[K]): void {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErro(null);

    const erroValidacao = validarForm(form, file);
    if (erroValidacao) {
      setErro(erroValidacao);
      return;
    }
    // `file` é não-null aqui por causa da validação acima.
    const arquivoOk = file as File;

    // Id gerado no cliente: navegamos para a tela de status IMEDIATAMENTE (ela
    // faz polling e mostra a barra desde o início). O upload (sync) roda em
    // background e sobrevive à navegação SPA; o orquestrador grava o status no
    // KV a cada fase. Falha do pipeline aparece como status "failed" na tela.
    const ingestaoId = crypto.randomUUID();
    setEnviando(true);
    void uploadNorma(
      arquivoOk,
      {
        lei_id: form.lei_id.trim(),
        lei_tipo: form.lei_tipo,
        numero: form.numero.trim(),
        ano: Number.parseInt(form.ano, 10),
        data_publicacao: form.data_publicacao,
      },
      ingestaoId,
    ).catch(() => {
      // A tela de status reflete falha/404 — nada a tratar aqui.
    });
    router.push(`/admin/ingestao/status/${ingestaoId}`);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nova ingestão</h1>
        <p className="text-sm text-gray-500">
          Faça upload do PDF da norma e preencha os metadados. O pipeline roda em
          background e o progresso aparece na próxima tela.
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

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="lei_id" className="mb-1 block text-sm font-medium text-gray-700">
              lei_id (slug)
            </label>
            <input
              id="lei_id"
              type="text"
              required
              placeholder="lc-214-2025"
              value={form.lei_id}
              onChange={(e) => atualizar("lei_id", e.target.value.toLowerCase())}
              disabled={enviando}
              className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
            <p className="mt-1 text-xs text-gray-500">
              Identificador único — apenas a-z, 0-9 e hífen.
            </p>
          </div>

          <div>
            <label htmlFor="lei_tipo" className="mb-1 block text-sm font-medium text-gray-700">
              Tipo
            </label>
            <select
              id="lei_tipo"
              required
              value={form.lei_tipo}
              onChange={(e) => atualizar("lei_tipo", e.target.value)}
              disabled={enviando}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="numero" className="mb-1 block text-sm font-medium text-gray-700">
              Número
            </label>
            <input
              id="numero"
              type="text"
              required
              placeholder="214"
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
            <label
              htmlFor="data_publicacao"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Data de publicação
            </label>
            <input
              id="data_publicacao"
              type="date"
              required
              value={form.data_publicacao}
              onChange={(e) => atualizar("data_publicacao", e.target.value)}
              disabled={enviando}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
        </section>

        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => {
              setForm(ESTADO_INICIAL);
              setFile(null);
              setErro(null);
            }}
            disabled={enviando}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Limpar
          </button>
          <button
            type="submit"
            disabled={enviando}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {enviando ? "Enviando..." : "Ingerir"}
          </button>
        </div>
      </form>
    </div>
  );
}
