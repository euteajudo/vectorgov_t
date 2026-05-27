/**
 * Página 404 padrão.
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
      <p className="text-6xl font-bold text-[color:var(--color-muted-foreground)]">
        404
      </p>
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-[color:var(--color-muted-foreground)] max-w-md">
        O endereço que você acessou não existe ou foi movido.
      </p>
      <Button asChild>
        <Link href="/">
          <Home className="h-4 w-4" />
          Voltar para início
        </Link>
      </Button>
    </div>
  );
}
