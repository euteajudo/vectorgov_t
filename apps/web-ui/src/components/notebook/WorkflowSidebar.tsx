/**
 * Barra lateral direita do chat — mostra ONDE o usuário está no fluxo de
 * geração do parecer (5 fases), qual a PRÓXIMA etapa e O QUE PEDIR ao assistente.
 *
 * A fase vem do FSM do backend (evento WS "done" / `GET /api/notebooks/:id/estado`).
 * Conteúdo das fases (linguagem do usuário) vive em `lib/workflow-fases.ts`.
 */
"use client";

import type { JSX } from "react";
import { Check, CircleDot, Circle } from "lucide-react";
import type { EstadoConversa } from "@vectorgov-t/schemas";
import {
  FASES_ORDEM,
  FASE_INFO,
  oQuePedirAgora,
} from "../../lib/workflow-fases";

export interface WorkflowSidebarProps {
  /** Fase atual; `null` enquanto carrega. */
  fase: EstadoConversa | null;
  /** Veredito da análise (quando em ANALISE_PRONTA) — trata "inconclusiva". */
  veredito?: string | null;
}

export function WorkflowSidebar({
  fase,
  veredito,
}: WorkflowSidebarProps): JSX.Element {
  const atualIdx = fase ? FASES_ORDEM.indexOf(fase) : -1;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Fluxo do parecer
        </h2>
        <p className="mt-0.5 text-xs text-gray-400">
          Onde você está no processo.
        </p>
      </div>

      {/* Stepper das 5 fases */}
      <ol className="space-y-1">
        {FASES_ORDEM.map((f, i) => {
          const info = FASE_INFO[f];
          const concluida = atualIdx >= 0 && i < atualIdx;
          const atual = i === atualIdx;
          return (
            <li
              key={f}
              className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${
                atual ? "bg-blue-50 ring-1 ring-blue-200" : ""
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {concluida ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : atual ? (
                  <CircleDot className="h-4 w-4 text-blue-600" />
                ) : (
                  <Circle className="h-4 w-4 text-gray-300" />
                )}
              </span>
              <span
                className={`text-sm ${
                  atual
                    ? "font-semibold text-blue-900"
                    : concluida
                      ? "text-gray-500"
                      : "text-gray-400"
                }`}
              >
                {info.n}. {info.titulo}
              </span>
            </li>
          );
        })}
      </ol>

      {/* O que pedir agora */}
      {fase ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            O que pedir agora
          </div>
          <p className="mt-1 text-sm text-blue-900">
            {oQuePedirAgora(fase, veredito)}
          </p>
          {FASE_INFO[fase].proxima && (
            <p className="mt-2 text-xs text-blue-600">
              Próxima etapa: {FASE_INFO[fase].proxima}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-400">
          Carregando a fase…
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-gray-400">
        O assistente conduz você etapa por etapa e oferece botões com as próximas
        ações. Você também pode pedir em linguagem natural.
      </p>
    </div>
  );
}
