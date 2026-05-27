/**
 * `/admin/config` — configuração da API key (browser) + modelos por função (KV).
 *
 * A key fica em sessionStorage; some quando a aba fecha. Modelos vão pro
 * KV `config:models` do Worker — persistem entre sessões e browsers.
 */
"use client";

import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from "react";
import { Eye, EyeOff, Key, Save, Settings, TestTube2 } from "lucide-react";
import { useApiKey } from "../../../lib/api-key-store";
import {
  FUNCOES_MODELO,
  MODELOS_LLM,
  ROTULOS_FUNCAO,
  getModelConfig,
  setModelConfig,
  testarChave,
  type FuncaoModelo,
  type ModelConfig,
  type ModeloLLM,
} from "../../../lib/config-api";

export default function AdminConfigPage(): JSX.Element {
  const { apiKey, setApiKey, ready } = useApiKey();
  const [keyInput, setKeyInput] = useState("");
  const [mostrarKey, setMostrarKey] = useState(false);
  const [testando, setTestando] = useState(false);
  const [testeResultado, setTesteResultado] = useState<
    { ok: boolean; message?: string } | null
  >(null);

  const [modelos, setModelos] = useState<ModelConfig | null>(null);
  const [salvandoModelos, setSalvandoModelos] = useState(false);
  const [erroModelos, setErroModelos] = useState<string | null>(null);
  const [okModelos, setOkModelos] = useState<string | null>(null);

  useEffect(() => {
    if (apiKey) setKeyInput(apiKey);
  }, [apiKey]);

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

  function handleSalvarKey(): void {
    setApiKey(keyInput.trim() || null);
    setTesteResultado(null);
  }

  function handleLimparKey(): void {
    setApiKey(null);
    setKeyInput("");
    setTesteResultado(null);
  }

  async function handleTestarKey(): Promise<void> {
    const k = keyInput.trim();
    if (!k) {
      setTesteResultado({ ok: false, message: "digite a chave primeiro" });
      return;
    }
    setTestando(true);
    setTesteResultado(null);
    try {
      const r = await testarChave(k);
      setTesteResultado(r);
    } catch (err) {
      setTesteResultado({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestando(false);
    }
  }

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
          Defina a API key do Google (browser, não persistida no servidor) e o
          modelo de cada agente (persistido no Worker).
        </p>
      </div>

      {/* ============== API key ============== */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <header className="flex items-center gap-2">
          <Key className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-semibold">API key do Google</h2>
        </header>
        <p className="text-xs text-gray-500">
          A chave fica salva apenas na sua aba do navegador (sessionStorage).
          Se fechar a aba ou recarregar com o navegador fechado, vai precisar
          digitar de novo. Nada é enviado para o servidor além das chamadas
          que precisam da chave em runtime.
        </p>

        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={mostrarKey ? "text" : "password"}
              value={keyInput}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setKeyInput(e.target.value)
              }
              placeholder="AIza..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-sm font-mono shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setMostrarKey((m) => !m)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={mostrarKey ? "Ocultar chave" : "Mostrar chave"}
            >
              {mostrarKey ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={handleSalvarKey}
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Salvar
          </button>
          <button
            type="button"
            onClick={handleTestarKey}
            disabled={testando || !keyInput.trim()}
            className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <TestTube2 className="h-4 w-4" />
            {testando ? "Testando..." : "Testar"}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {ready ? (
              apiKey ? (
                <>
                  Chave salva no browser
                  {apiKey === keyInput ? "" : " (digitada não foi salva)"}
                </>
              ) : (
                <>Nenhuma chave salva no momento</>
              )
            ) : (
              <>Carregando...</>
            )}
          </span>
          {apiKey && (
            <button
              type="button"
              onClick={handleLimparKey}
              className="text-xs text-red-600 hover:text-red-700"
            >
              Limpar chave
            </button>
          )}
        </div>

        {testeResultado && (
          <div
            className={`rounded-md p-3 text-sm ${
              testeResultado.ok
                ? "border border-green-200 bg-green-50 text-green-700"
                : "border border-red-200 bg-red-50 text-red-700"
            }`}
            role="alert"
          >
            {testeResultado.ok
              ? "✓ Chave válida — recebeu resposta do Gemini."
              : `✗ Chave inválida${
                  testeResultado.message
                    ? `: ${testeResultado.message}`
                    : ""
                }`}
          </div>
        )}
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
