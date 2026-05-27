/**
 * Banner global que avisa o usuário quando a API key não está setada
 * no browser. Aparece no topo de todas as páginas (renderizado no
 * RootLayout). Some assim que o user configurar.
 *
 * Não mostra na própria página de config — evitar ruído visual.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useApiKey } from "../lib/api-key-store";

export function ApiKeyBanner() {
  const { apiKey, ready } = useApiKey();
  const pathname = usePathname();

  // Não renderiza antes da hidratação (evita flash).
  if (!ready) return null;
  if (apiKey) return null;
  // Não mostrar na própria página de config.
  if (pathname?.startsWith("/admin/config")) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Antes de usar o chat ou rodar análises, configure sua API key do
            Google.
          </span>
        </div>
        <Link
          href="/admin/config"
          className="font-medium underline hover:no-underline whitespace-nowrap"
        >
          Configure agora →
        </Link>
      </div>
    </div>
  );
}
