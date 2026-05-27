/**
 * Store da API key do Google no browser.
 *
 * Decisão arquitetural (demo): a key NÃO trafega pro backend pra
 * persistência — fica apenas em `sessionStorage`. Some quando a aba
 * fecha. Em cada request, a UI injeta no header `X-Google-API-Key`
 * (REST) ou no Sec-WebSocket-Protocol `vectorgov-key.<key>` (WS).
 *
 * Por que `sessionStorage` e não `localStorage`:
 *  - Some ao fechar a aba → satisfaz "demo, sem persistência".
 *  - Por origem, sobrevive a reloads e navegação na mesma tab.
 *  - DevTools mostra. Aceitável.
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
  const [apiKey, setApiKeyState] = useState<string | null>(null);
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
      sessionStorage.removeItem(STORAGE_KEY);
      setApiKeyState(null);
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
