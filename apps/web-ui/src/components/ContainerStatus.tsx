/**
 * Indicador de prontidão do ambiente de leitura de documentos (Container).
 *
 * Usado no topo das telas de ingestão (leis e acórdãos). Ao montar, dispara o
 * warm-up automático e mostra o progresso ao cliente — sem jargão técnico:
 *   ⏳ "Preparando o ambiente…" → ✓ "Pronto".
 * O cliente não precisa fazer nada; há um botão "Reativar" só como fallback.
 */
"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Loader2, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { pingContainerHealth } from "../lib/container-status";

type Estado = "verificando" | "aquecendo" | "pronto" | "falha";

const MAX_TENTATIVAS = 12; // ~12 × 3s ≈ 36s de janela de warm-up
const INTERVALO_MS = 3000;

export function ContainerStatus(): JSX.Element | null {
  const [estado, setEstado] = useState<Estado>("verificando");
  const tentativas = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vivo = useRef(true);

  const checar = useCallback(async () => {
    const h = await pingContainerHealth();
    if (!vivo.current) return;
    if (h.ready) {
      setEstado("pronto");
      return;
    }
    tentativas.current += 1;
    if (tentativas.current >= MAX_TENTATIVAS) {
      setEstado("falha");
      return;
    }
    setEstado("aquecendo");
    timer.current = setTimeout(() => void checar(), INTERVALO_MS);
  }, []);

  const reativar = useCallback(() => {
    tentativas.current = 0;
    if (timer.current) clearTimeout(timer.current);
    setEstado("verificando");
    void checar();
  }, [checar]);

  useEffect(() => {
    vivo.current = true;
    void checar();
    return () => {
      vivo.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [checar]);

  if (estado === "pronto") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>Sistema pronto para receber documentos.</span>
      </div>
    );
  }

  if (estado === "falha") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          O ambiente está demorando para iniciar. Você pode tentar de novo — ou
          enviar o documento mesmo assim (a primeira leitura pode levar alguns
          segundos a mais).
        </span>
        <button
          type="button"
          onClick={reativar}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-amber-400 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
        >
          <RefreshCw className="h-3 w-3" /> Reativar
        </button>
      </div>
    );
  }

  // verificando | aquecendo
  return (
    <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      <span>
        Preparando o ambiente de leitura de documentos… (pode levar alguns
        segundos). Você já pode escolher o arquivo.
      </span>
      <button
        type="button"
        onClick={reativar}
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
        title="Reativar o ambiente"
      >
        <RefreshCw className="h-3 w-3" /> Reativar
      </button>
    </div>
  );
}
