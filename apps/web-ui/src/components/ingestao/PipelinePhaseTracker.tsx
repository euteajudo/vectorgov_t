/**
 * Visualização das 7 fases do pipeline de ingestão.
 *
 * Fases (ordem fixa, mesma do `IngestaoFaseSchema`):
 *   pending → parsing → markdown → embedding → vectorize → d1 → indices → done
 *
 * A fase `failed` é tratada como estado terminal: a etapa onde parou
 * (última no array `erros`) fica vermelha, as anteriores ficam verdes,
 * as posteriores ficam cinza.
 *
 * Renderiza:
 *  - Barra de progresso horizontal (% global).
 *  - Lista vertical das fases com ícone de status (concluída, atual, pendente, erro).
 *  - Box de erros (se houver).
 */
"use client";

import type { JSX } from "react";
import type { IngestaoFase, IngestaoStatus } from "@vectorgov-t/schemas";

/**
 * Sequência canônica das 7 fases "felizes" — não inclui `pending` (estado
 * inicial sem etapa visível) nem `failed` (estado de erro transversal).
 */
const FASES: { fase: IngestaoFase; label: string; descricao: string }[] = [
  { fase: "parsing", label: "Parsing", descricao: "PDF -> hierarquia legal via Container Python" },
  { fase: "markdown", label: "Markdown", descricao: "Gera .md por dispositivo + upload R2" },
  { fase: "embedding", label: "Embedding", descricao: "Chama bge-m3 em batches" },
  { fase: "vectorize", label: "Vectorize", descricao: "Upsert no indice vetorial" },
  { fase: "d1", label: "D1", descricao: "Insert em normas/dispositivos + FTS5" },
  { fase: "indices", label: "Indices", descricao: "Atualiza _index.json e _sumario.json" },
  { fase: "done", label: "Done", descricao: "Concluido com sucesso" },
];

type EstadoEtapa = "concluida" | "atual" | "pendente" | "erro";

/**
 * Determina o estado visual de cada etapa em função da fase atual.
 *
 * Regras:
 *  - `failed`: a última fase que apareceu nos `erros` fica vermelha; as
 *    anteriores no array `FASES` ficam verdes; as posteriores cinzas.
 *  - `done`: tudo verde.
 *  - Outra fase: as anteriores ficam verdes, a atual fica azul, posteriores cinza.
 *  - `pending`: tudo cinza.
 */
function getEstado(
  faseAtual: IngestaoFase,
  faseEtapa: IngestaoFase,
  faseQueFalhou: IngestaoFase | null,
): EstadoEtapa {
  const idxAtual = FASES.findIndex((f) => f.fase === faseAtual);
  const idxEtapa = FASES.findIndex((f) => f.fase === faseEtapa);

  if (faseAtual === "failed" && faseQueFalhou) {
    const idxFalha = FASES.findIndex((f) => f.fase === faseQueFalhou);
    if (idxEtapa < idxFalha) return "concluida";
    if (idxEtapa === idxFalha) return "erro";
    return "pendente";
  }

  if (faseAtual === "done") return "concluida";
  if (faseAtual === "pending") return "pendente";

  if (idxEtapa < idxAtual) return "concluida";
  if (idxEtapa === idxAtual) return "atual";
  return "pendente";
}

function IconePorEstado({ estado }: { estado: EstadoEtapa }): JSX.Element {
  const base = "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold";
  if (estado === "concluida") {
    return <span className={`${base} bg-green-100 text-green-700`} aria-label="Concluída">OK</span>;
  }
  if (estado === "atual") {
    return <span className={`${base} bg-blue-100 text-blue-700 animate-pulse`} aria-label="Em andamento">...</span>;
  }
  if (estado === "erro") {
    return <span className={`${base} bg-red-100 text-red-700`} aria-label="Erro">X</span>;
  }
  return <span className={`${base} bg-gray-100 text-gray-400`} aria-label="Pendente">-</span>;
}

export interface PipelinePhaseTrackerProps {
  status: IngestaoStatus;
}

export function PipelinePhaseTracker({
  status,
}: PipelinePhaseTrackerProps): JSX.Element {
  const faseQueFalhou: IngestaoFase | null =
    status.fase === "failed" && status.erros.length > 0
      ? status.erros[status.erros.length - 1].fase
      : null;

  return (
    <div className="space-y-6">
      {/* Cabeçalho com barra global */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Progresso: {status.progresso_pct}%
          </h2>
          <span className="text-sm text-gray-500">
            {status.processados} / {status.total_dispositivos} dispositivos
          </span>
        </div>
        <div
          className="h-2 w-full rounded-full bg-gray-200"
          role="progressbar"
          aria-valuenow={status.progresso_pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-2 rounded-full transition-all duration-500 ${
              status.fase === "failed"
                ? "bg-red-500"
                : status.fase === "done"
                  ? "bg-green-500"
                  : "bg-blue-500"
            }`}
            style={{ width: `${status.progresso_pct}%` }}
          />
        </div>
      </div>

      {/* Lista de etapas */}
      <ol className="space-y-3">
        {FASES.map((f) => {
          const estado = getEstado(status.fase, f.fase, faseQueFalhou);
          return (
            <li
              key={f.fase}
              className={`flex items-start gap-3 rounded-md border p-3 ${
                estado === "atual"
                  ? "border-blue-300 bg-blue-50"
                  : estado === "concluida"
                    ? "border-green-200 bg-green-50/40"
                    : estado === "erro"
                      ? "border-red-300 bg-red-50"
                      : "border-gray-200 bg-white"
              }`}
            >
              <IconePorEstado estado={estado} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <p className="font-medium text-gray-900">{f.label}</p>
                  <span className="text-xs uppercase tracking-wide text-gray-400">
                    {f.fase}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{f.descricao}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Erros */}
      {status.erros.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <h3 className="mb-2 font-semibold text-red-800">
            Avisos / Erros ({status.erros.length})
          </h3>
          <ul className="space-y-1 text-sm text-red-700">
            {status.erros.map(
              (err: { fase: IngestaoFase; mensagem: string; timestamp: string }, idx: number) => (
                <li key={idx}>
                  <span className="font-mono text-xs">[{err.fase}]</span>{" "}
                  <span>{err.mensagem}</span>{" "}
                  <span className="text-red-500">({err.timestamp})</span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
