/**
 * Rota `/ingestao` — informa que o app de ingestão fica em outra worktree
 * e oferece atalho para a UI dedicada (Track G).
 *
 * Esta tela é intencionalmente leve — Track H não duplica funcionalidades
 * já entregues pelo Track G (vectorgov-t-ingestao-ui).
 */
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ExternalLink, UploadCloud } from "lucide-react";

export const metadata: Metadata = {
  title: "Ingestão de normas — Vectorgov_t",
};

export default function IngestaoPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-1">
        <p className="text-sm text-[color:var(--color-muted-foreground)] font-medium uppercase tracking-wide">
          Indexação da base
        </p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Ingestão de normas
        </h1>
        <p className="text-base text-[color:var(--color-muted-foreground)]">
          Submeta leis, decretos e instruções normativas para o pipeline de
          parsing, embedding e indexação no Vectorize.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-[color:var(--color-primary)]" />
            Pipeline de ingestão
          </CardTitle>
          <CardDescription>
            O endpoint <code>/ingestao/iniciar</code> aceita PDFs de normas e
            executa: parsing → markdown → embedding bge-m3 → upsert Vectorize →
            inserção em D1/FTS5 → atualização de índices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            Em produção esta tela disparará o pipeline diretamente. Por
            enquanto, use a UI dedicada do Track G ou chame o endpoint via
            <code className="mx-1">curl</code>:
          </p>
          <pre className="text-xs bg-[color:var(--color-muted)]/40 border border-[color:var(--color-border)] rounded-md p-3 overflow-auto">
{`curl -X POST https://vectorgov-t-mcp.<sub>.workers.dev/ingestao/iniciar \\
  -F "pdf=@lei-14133.pdf" \\
  -F "lei_id=lei-14133-2021" \\
  -F "lei_tipo=lei" \\
  -F "numero=14133" \\
  -F "ano=2021" \\
  -F "data_publicacao=2021-04-01"`}
          </pre>
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
            Acompanhe o progresso em{" "}
            <code className="text-xs">/ingestao/status/&lt;id&gt;</code>.
          </p>
          <Button asChild variant="outline">
            <a
              href="https://vectorgov-t-mcp.souzat19.workers.dev/health"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              Health-check do Worker
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
