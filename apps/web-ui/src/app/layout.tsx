/**
 * Layout raiz — envolve toda a app com:
 *   - Provider React Query (state remoto).
 *   - Sidebar fixa (navegação principal).
 *   - Main com padding lateral em desktop (md+).
 *
 * Metadados gerais (title, description) ficam aqui para SEO básico.
 */
import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { Providers } from "@/components/providers";
import { ApiKeyProvider } from "@/lib/api-key-store";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vectorgov_t — Análise de pedidos de reequilíbrio",
  description:
    "Plataforma multi-agente para análise de pedidos de reequilíbrio econômico-financeiro em contratos administrativos.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>
          <ApiKeyProvider>
            <div className="min-h-screen">
              <Sidebar />
              <main className="md:pl-72">
                <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
                  {children}
                </div>
              </main>
            </div>
          </ApiKeyProvider>
        </Providers>
      </body>
    </html>
  );
}
