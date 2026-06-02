/**
 * Store da API key do Google no browser.
 *
 * MUDANÇA (AI Gateway): o Gemini agora é acessado via Cloudflare AI Gateway,
 * com a chave em BYOK no gateway (server-side). O app **não precisa mais** que
 * o usuário informe a chave. Para não reescrever todos os gates `if (!apiKey)`
 * de uma vez, o `apiKey` passa a ter um SENTINELA não-nulo por padrão
 * (`GATEWAY_SENTINEL`): os gates passam, o banner some e o usuário nunca é
 * solicitado. O valor injetado nos headers/subprotocol é ignorado pelo backend
 * (que usa o `CF_AIG_TOKEN`). A UI de "informar chave" em /admin/config fica
 * vestigial — pode ser removida numa limpeza posterior.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "google_api_key";

/**
 * Valor não-nulo padrão — sinaliza "Gemini via AI Gateway, sem chave do
 * usuário". Mantém os gates legados (`if (!apiKey)`) satisfeitos. Ignorado pelo
 * backend.
 */
const GATEWAY_SENTINEL = "via-ai-gateway";

interface ApiKeyContextValue {
  apiKey: string | null;
  setApiKey: (key: string | null) => void;
  /** True após o primeiro mount (evita hydration mismatch SSR/CSR). */
  ready: boolean;
}

const Ctx = createContext<ApiKeyContextValue>({
  apiKey: null,
  setApiKey: () => {},
  ready: false,
});

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  // Default = sentinela (não-nulo): com o AI Gateway o app não exige chave.
  const [apiKey, setApiKeyState] = useState<string | null>(GATEWAY_SENTINEL);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) setApiKeyState(stored);
    setReady(true);
  }, []);

  const setApiKey = useCallback((key: string | null) => {
    if (typeof window === "undefined") return;
    if (key && key.trim().length > 0) {
      const trimmed = key.trim();
      sessionStorage.setItem(STORAGE_KEY, trimmed);
      setApiKeyState(trimmed);
    } else {
      // "Remover" volta ao sentinela do gateway — nunca deixa nulo (senão o
      // banner/gates legados voltariam a pedir chave sem necessidade).
      sessionStorage.removeItem(STORAGE_KEY);
      setApiKeyState(GATEWAY_SENTINEL);
    }
  }, []);

  return (
    <Ctx.Provider value={{ apiKey, setApiKey, ready }}>{children}</Ctx.Provider>
  );
}

export function useApiKey(): ApiKeyContextValue {
  return useContext(Ctx);
}

/**
 * Helper de fetch que injeta a key no header. Use isto em vez de `fetch`
 * direto quando o endpoint exige a key (chat, generateObject etc.).
 */
export async function fetchWithKey(
  url: string,
  apiKey: string | null,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  if (apiKey) headers.set("X-Google-API-Key", apiKey);
  return fetch(url, { ...init, headers });
}
