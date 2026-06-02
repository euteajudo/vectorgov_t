/**
 * `/admin/config` — modelo por função (persistido no KV do Worker).
 *
 * A chave do Gemini NÃO é mais configurada aqui: o Worker acessa o Gemini via
 * Cloudflare AI Gateway (chave em BYOK no gateway, server-side). O usuário não
 * informa chave alguma.
 */
"use client";

import { useEffect, useState, type FormEvent, type JSX } from "react";
import { Save, Settings, ShieldCheck } from "lucide-react";
import {
  FUNCOES_MODELO,
  MODELOS_LLM,
  ROTULOS_FUNCAO,
  getModelConfig,
  setModelConfig,
  type FuncaoModelo,
  type ModelConfig,
  type ModeloLLM,
} from "../../../lib/config-api";

export default function AdminConfigPage(): JSX.Element {
  const [modelos, setModelos] = useState<ModelConfig | null>(null);
  const [salvandoModelos, setSalvandoModelos] = useState(false);
  const [erroModelos, setErroModelos] = useState<string | null>(null);
  const [okModelos, setOkModelos] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    getModelConfig()
      .then((cfg) => {
        if (!cancelado) setModelos(cfg);
      })
      .catch((err) => {
        if (!cancelado)
          setErroModelos(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelado = true;
    };
  }, []);

  function setModeloDe(funcao: FuncaoModelo, modelo: ModeloLLM): void {
    if (!modelos) return;
    setModelos({
      modelos: { ...modelos.modelos, [funcao]: modelo },
    });
    setOkModelos(null);
  }

  async function handleSalvarModelos(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!modelos) return;
    setSalvandoModelos(true);
    setErroModelos(null);
    setOkModelos(null);
    try {
      const persistido = await setModelConfig(modelos.modelos);
      setModelos(persistido);
      setOkModelos("Modelos salvos.");
    } catch (err) {
      setErroModelos(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvandoModelos(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Configurações
        </h1>
        <p className="text-sm text-gray-500">
          Defina o modelo de cada agente (persistido no Worker).
        </p>
      </div>

      {/* ============== Acesso ao Gemini (informativo) ============== */}
      <section className="rounded-lg border border-green-200 bg-green-50 p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
        <div className="text-sm text-green-800">
          <p className="font-semibold">Gemini via Cloudflare AI Gateway</p>
          <p className="text-xs text-green-700">
            A chave do Google fica protegida no AI Gateway (server-side) — você
            não precisa informar nenhuma chave para usar o chat, a análise ou o
            parecer.
          </p>
        </div>
      </section>

      {/* ============== Modelos ============== */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <header className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-semibold">Modelo por função</h2>
        </header>
        <p className="text-xs text-gray-500">
          Salvo no Worker (KV). Aplica-se a todas as próximas chamadas. Não
          requer redeploy.
        </p>

        {!modelos && !erroModelos && (
          <div className="text-sm text-gray-500">Carregando...</div>
        )}

        {modelos && (
          <form onSubmit={handleSalvarModelos} className="space-y-3">
            <div className="space-y-2">
              {FUNCOES_MODELO.map((f) => (
                <div
                  key={f}
                  className="flex items-center justify-between gap-3 rounded border border-gray-100 px-3 py-2"
                >
                  <label
                    htmlFor={`mod-${f}`}
                    className="text-sm text-gray-700 flex-1"
                  >
                    {ROTULOS_FUNCAO[f]}
                  </label>
                  <select
                    id={`mod-${f}`}
                    value={modelos.modelos[f]}
                    onChange={(e) =>
                      setModeloDe(f, e.target.value as ModeloLLM)
                    }
                    className="rounded border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {MODELOS_LLM.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {erroModelos && (
              <div
                className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700"
                role="alert"
              >
                {erroModelos}
              </div>
            )}
            {okModelos && (
              <div
                className="rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-700"
                role="status"
              >
                {okModelos}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={salvandoModelos}
                className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {salvandoModelos ? "Salvando..." : "Salvar modelos"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
