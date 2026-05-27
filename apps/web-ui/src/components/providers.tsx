/**
 * Provider raiz da app — React Query.
 *
 * Centraliza configuração global do client (staleTime, retry, etc.) e mantém
 * um único cliente por instância da app (não recriar a cada render).
 *
 * Decisões:
 *  - `staleTime: 30s` — dados de listagens (histórico, skills) toleram esse
 *    delay; mutations (`gerarParecer`) invalidam queries específicas.
 *  - `refetchOnWindowFocus: false` — em dashboards jurídicos o user fica
 *    bastante tempo lendo, evitar refetches surpresa.
 *  - `retry: 1` — em caso de falha de rede no Worker, tentamos uma vez.
 *    Erros 4xx (validação) não são retriados.
 */
"use client";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function Providers({ children }: { children: React.ReactNode }) {
  // useState para garantir que o client seja criado UMA vez por mount.
  // Se criasse no escopo do módulo, sofreria com hot-reload em dev.
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Não retry em erros 4xx (problema do client).
              if (error instanceof Error && /^4\d\d/.test(error.message)) {
                return false;
              }
              return failureCount < 1;
            },
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
