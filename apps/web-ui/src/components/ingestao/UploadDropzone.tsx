/**
 * Dropzone para upload de PDF — drag-and-drop + click-to-select.
 *
 * Validações client-side:
 *  - Apenas .pdf (mime ou extensão — alguns SOs mandam octet-stream).
 *  - Tamanho máximo 50MB (espelha `MAX_PDF_BYTES` do handler do Worker).
 *
 * Quando um arquivo válido é selecionado, mostra preview com nome + tamanho
 * e dispara `onFile(file)`. Erros viram texto vermelho local + `onError`.
 */
"use client";

import { useCallback, useRef, useState, type DragEvent, type ChangeEvent, type JSX } from "react";

/** Limite de tamanho — 50MB. Igual ao MAX_PDF_BYTES do orquestrador. */
const MAX_BYTES = 50 * 1024 * 1024;

export interface UploadDropzoneProps {
  /** Disparado quando um arquivo válido é selecionado/dropado. */
  onFile: (file: File) => void;
  /** Disparado em erro de validação para o pai mostrar/limpar estado. */
  onError?: (msg: string) => void;
  /** Arquivo já selecionado — controla o preview. */
  file: File | null;
  /** Desabilita interação (ex.: enquanto sobe). */
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function validate(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf")) {
    return "Apenas arquivos .pdf são aceitos";
  }
  if (file.size === 0) {
    return "Arquivo vazio";
  }
  if (file.size > MAX_BYTES) {
    return `Arquivo excede 50MB (${formatBytes(file.size)})`;
  }
  return null;
}

export function UploadDropzone({
  onFile,
  onError,
  file,
  disabled = false,
}: UploadDropzoneProps): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (f: File) => {
      const err = validate(f);
      if (err) {
        setLocalError(err);
        onError?.(err);
        return;
      }
      setLocalError(null);
      onFile(f);
    },
    [onFile, onError],
  );

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files[0];
    if (dropped) accept(dropped);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    const picked = e.target.files?.[0];
    if (picked) accept(picked);
  }

  const baseClasses =
    "rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer";
  const stateClasses = disabled
    ? "border-gray-300 bg-gray-50 cursor-not-allowed opacity-60"
    : dragging
      ? "border-blue-500 bg-blue-50"
      : "border-gray-300 bg-white hover:border-gray-400";

  return (
    <div>
      <div
        className={`${baseClasses} ${stateClasses}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Selecionar arquivo PDF"
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleChange}
          disabled={disabled}
        />
        {file ? (
          <div className="space-y-1">
            <p className="font-medium text-gray-900">{file.name}</p>
            <p className="text-sm text-gray-500">
              {formatBytes(file.size)} | PDF
            </p>
            {!disabled && (
              <p className="text-xs text-blue-600 underline">
                Clique para trocar
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="font-medium text-gray-700">
              Arraste o PDF aqui ou clique para selecionar
            </p>
            <p className="text-sm text-gray-500">
              Apenas arquivos .pdf | até 50MB
            </p>
          </div>
        )}
      </div>
      {localError && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {localError}
        </p>
      )}
    </div>
  );
}
