/**
 * `/admin/ingestao/status/[id]` — visualização de progresso com polling.
 *
 * Polling a cada 2s no `GET /ingestao/status/:id`. Interrompe quando:
 *  - `status.fase === "done"` ou `"failed"` (estado terminal).
 *  - O componente desmonta.
 *  - O backend responde 404 (TTL do KV expirou).
 *
 * Quando termina com sucesso, mostra botão "Ver norma" que volta para a
 * listagem (em `/admin/ingestao`). Em falha, oferece "Tentar nova ingestão".
 */
"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import Link from "next/link";
import type { IngestaoStatus } from "@vectorgov-t/schemas";
import { PipelinePhaseTracker } from "../../../../../components/ingestao/PipelinePhaseTracker";
import { getStatus } from "../../../../../lib/ingestao-api";

/** Intervalo do polling em ms. */
const POLL_INTERVAL_MS = 2000;
/**
 * Quantos 404 tolerar antes de declarar "não encontrada". Cobre a janela entre
 * a navegação imediata (cliente cria o id) e a criação do registro no KV pelo
 * orquestrador (que só acontece depois do upload do PDF). 30 × 2s = 60s.
 */
const MAX_404_RETRIES = 30;

type Props = {
  params: Promise<{ id: string }>;
};

export default function StatusIngestaoPage({ params }: Props): JSX.Element {
  // Next 15 entrega params como Promise — desembrulha no client.
  const [ingestaoId, setIngestaoId] = useState<string | null>(null);
  const [status, setStatus] = useState<IngestaoStatus | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jaViu = useRef(false);
  const tentativas404 = useRef(0);

  // Desembrulha params.
  useEffect(() => {
    let cancelado = false;
    void params.then((p) => {
      if (!cancelado) setIngestaoId(p.id);
    });
    return () => {
      cancelado = true;
    };
  }, [params]);

  // Polling.
  useEffect(() => {
    if (!ingestaoId) return;

    let cancelado = false;

    async function tick(): Promise<void> {
      if (cancelado) return;
      try {
        const atual = await getStatus(ingestaoId as string);
        if (cancelado) return;
        if (atual === null) {
          // 404: o registro pode ainda não existir (navegação imediata, com o
          // upload do PDF em curso). Retenta até o teto; só desiste se o status
          // nunca tiver aparecido.
          if (!jaViu.current && tentativas404.current < MAX_404_RETRIES) {
            tentativas404.current += 1;
            timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
            return;
          }
          setNaoEncontrado(true);
          return;
        }
        jaViu.current = true;
        setStatus(atual);
        setErro(null);
        // Reagenda apenas se ainda não estiver em estado terminal.
        if (atual.fase !== "done" && atual.fase !== "failed") {
          timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelado) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErro(msg);
        // Tenta de novo após o intervalo — erro pode ser transitório.
        timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      }
    }

    void tick();

    return () => {
      cancelado = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [ingestaoId]);

  if (!ingestaoId) {
    return <div className="text-gray-500">Carregando...</div>;
  }

  if (naoEncontrado) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Ingestão não encontrada</h1>
        <p className="text-gray-600">
          O registro <span className="font-mono">{ingestaoId}</span> não está mais no
          cache (TTL de 24h) ou o ID é inválido.
        </p>
        <Link
          href="/admin/ingestao/nova"
          className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Iniciar nova ingestão
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Status da ingestão</h1>
          <p className="font-mono text-sm text-gray-500">{ingestaoId}</p>
          {status?.lei_id && (
            <p className="text-sm text-gray-600">
              Norma: <span className="font-mono">{status.lei_id}</span>
            </p>
          )}
        </div>
        {status && (
          <span
            className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
              status.fase === "done"
                ? "bg-green-100 text-green-800"
                : status.fase === "failed"
                  ? "bg-red-100 text-red-800"
                  : "bg-blue-100 text-blue-800"
            }`}
          >
            {status.fase}
          </span>
        )}
      </div>

      {erro && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          role="alert"
        >
          Erro temporário: {erro} (retentando em {POLL_INTERVAL_MS / 1000}s)
        </div>
      )}

      {status === null && !erro ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          Conectando ao orquestrador...
        </div>
      ) : status !== null ? (
        <PipelinePhaseTracker status={status} />
      ) : null}

      {status?.fase === "done" && (
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <Link
            href="/admin/ingestao"
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Ver norma na listagem
          </Link>
        </div>
      )}

      {status?.fase === "failed" && (
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <Link
            href="/admin/ingestao/nova"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Tentar nova ingestão
          </Link>
        </div>
      )}

      {status && (
        <div className="rounded-md border border-gray-200 bg-white p-4 text-xs text-gray-600">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <p className="font-medium text-gray-500">Iniciado</p>
              <p className="font-mono">{status.iniciado_em}</p>
            </div>
            <div>
              <p className="font-medium text-gray-500">Atualizado</p>
              <p className="font-mono">{status.atualizado_em}</p>
            </div>
            <div>
              <p className="font-medium text-gray-500">Tokens</p>
              <p className="font-mono tabular-nums">{status.tokens_consumidos}</p>
            </div>
            <div>
              <p className="font-medium text-gray-500">Finalizado</p>
              <p className="font-mono">{status.finalizado_em ?? "—"}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
