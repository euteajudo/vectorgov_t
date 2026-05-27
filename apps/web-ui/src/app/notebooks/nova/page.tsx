/**
 * `/notebooks/nova` — cria notebook + faz upload de PDF.
 *
 * Fluxo:
 *  1. Usuário escolhe PDF (e opcionalmente um título).
 *  2. POST /api/notebooks → recebe id novo.
 *  3. POST /api/notebooks/:id/upload com o PDF → server parseia.
 *  4. Redireciona para /notebooks/[id].
 */
"use client";

import { useRouter } from "next/navigation";
import {
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from "react";
import { Upload } from "lucide-react";
import { criarNotebook, uploadDocumento } from "../../../lib/notebooks-api";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NovoNotebookPage(): JSX.Element {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [titulo, setTitulo] = useState<string>("");
  const [fase, setFase] = useState<
    "idle" | "criando" | "enviando" | "parseando"
  >("idle");
  const [erro, setErro] = useState<string | null>(null);

  function onFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > MAX_PDF_BYTES) {
      setErro(`Arquivo grande demais (${formatBytes(f.size)}). Máximo: 50 MB.`);
      setFile(null);
      return;
    }
    if (f && f.type && !f.type.includes("pdf")) {
      setErro("O arquivo precisa ser um PDF.");
      setFile(null);
      return;
    }
    setErro(null);
    setFile(f);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!file) {
      setErro("Selecione um PDF primeiro.");
      return;
    }
    setErro(null);
    try {
      setFase("criando");
      const tituloFinal = titulo.trim().length > 0
        ? titulo.trim()
        : file.name.replace(/\.pdf$/i, "");
      const meta = await criarNotebook(tituloFinal);

      setFase("enviando");
      await uploadDocumento(meta.id, file);

      router.push(`/notebooks/${meta.id}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setFase("idle");
    }
  }

  const enviando = fase !== "idle";

  return (
    <div className="p-6 md:p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nova conversa</h1>
        <p className="text-sm text-gray-500">
          Suba um PDF (petição, contrato, parecer, ato administrativo). Vamos
          parsear o documento e abrir uma conversa.
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

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="titulo"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Título (opcional)
          </label>
          <input
            id="titulo"
            type="text"
            value={titulo}
            placeholder="Petição de reequilíbrio — contrato XYZ"
            onChange={(e) => setTitulo(e.target.value)}
            disabled={enviando}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
          />
        </div>

        <div>
          <label
            htmlFor="pdf"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            PDF do documento
          </label>
          <label
            htmlFor="pdf"
            className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-sm text-gray-600 hover:bg-gray-100"
          >
            <Upload className="h-4 w-4" />
            {file ? (
              <span>
                <strong>{file.name}</strong> ({formatBytes(file.size)})
              </span>
            ) : (
              <span>Selecione um PDF (até 50 MB)</span>
            )}
            <input
              id="pdf"
              type="file"
              accept="application/pdf,.pdf"
              required
              className="sr-only"
              onChange={onFileChange}
              disabled={enviando}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            type="submit"
            disabled={enviando || !file}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {fase === "criando" && "Criando notebook…"}
            {fase === "enviando" && "Enviando PDF…"}
            {fase === "parseando" && "Parseando documento…"}
            {fase === "idle" && "Criar e abrir"}
          </button>
        </div>
      </form>

      {enviando && (
        <p className="text-xs text-gray-500">
          O parse pode levar alguns segundos. Em PDFs grandes (centenas de
          páginas) pode demorar até 6 minutos.
        </p>
      )}
    </div>
  );
}
