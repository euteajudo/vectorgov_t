/**
 * Editor de skill — carrega markdown atual, permite edição, salva como
 * candidate (default) ou promove direto para active.
 *
 * Botões:
 *  - "Salvar como candidato" — POST /api/skills/:nome/publicar { promover: false }
 *  - "Promover para active" — POST /api/skills/:nome/publicar { promover: true }
 *  - "Comparar com active" — link para /skills/[nome]/comparar
 *  - "Testar contra petição" — abre modal mock (TODO: integrar PEVS)
 *
 * Estado:
 *  - markdown local diferge de "salvo" (dirty flag).
 *  - mutation salva, invalida queries.
 */
"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  GitCompareArrows,
  Loader2,
  Play,
  Sparkles,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { carregarSkill, publicarSkill } from "@/lib/api";

interface SkillFullShape {
  metadata: {
    nome: string;
    descricao: string;
    versao: string;
    categoria: string;
    autor: string;
    data_atualizacao: string;
    status: string;
    tokens_aproximados: number;
    agentes_aplicaveis: string[];
  };
  corpo_markdown: string;
  r2_key: string;
}

export function SkillEditor({ nome }: { nome: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["skill", nome],
    queryFn: () => carregarSkill(nome),
  });

  const [markdown, setMarkdown] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [testando, setTestando] = React.useState(false);

  // Sincroniza markdown inicial assim que a skill chega.
  React.useEffect(() => {
    const skill = data as unknown as SkillFullShape | undefined;
    if (skill && markdown === "") {
      setMarkdown(skill.corpo_markdown);
    }
  }, [data, markdown]);

  const publicarMutation = useMutation({
    mutationFn: ({ promover }: { promover: boolean }) =>
      publicarSkill(nome, markdown, promover),
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["skill", nome] });
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-[color:var(--color-destructive)]">
          {error instanceof Error ? error.message : "Skill não encontrada"}
        </CardContent>
      </Card>
    );
  }

  const skill = data as unknown as SkillFullShape;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setMarkdown(e.target.value);
    setDirty(true);
  }

  async function rodarTeste() {
    // TODO: chamar /api/skills/:nome/testar com payload de petição teste.
    setTestando(true);
    await new Promise((r) => setTimeout(r, 1500));
    setTestando(false);
    alert(
      "Teste simulado executado. O backend real executaria a skill candidata contra uma petição de regressão e mostraria a saída.",
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/skills">
            <ArrowLeft className="h-4 w-4" /> Voltar para skills
          </Link>
        </Button>
      </div>

      {/* Header da skill */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[color:var(--color-warning)]" />
                {skill.metadata.nome}
              </CardTitle>
              <CardDescription className="mt-1">
                {skill.metadata.descricao}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">v{skill.metadata.versao}</Badge>
              <Badge variant="secondary">{skill.metadata.categoria}</Badge>
              <Badge
                variant={skill.metadata.status === "active" ? "success" : "warning"}
              >
                {skill.metadata.status}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-[color:var(--color-muted-foreground)] uppercase">
              Autor
            </p>
            <p>{skill.metadata.autor}</p>
          </div>
          <div>
            <p className="text-xs text-[color:var(--color-muted-foreground)] uppercase">
              Atualizada em
            </p>
            <p>{skill.metadata.data_atualizacao}</p>
          </div>
          <div>
            <p className="text-xs text-[color:var(--color-muted-foreground)] uppercase">
              Tokens (aprox.)
            </p>
            <p>{skill.metadata.tokens_aproximados.toLocaleString("pt-BR")}</p>
          </div>
          <div>
            <p className="text-xs text-[color:var(--color-muted-foreground)] uppercase">
              R2 key
            </p>
            <code className="text-xs break-all">{skill.r2_key}</code>
          </div>
        </CardContent>
      </Card>

      {/* Editor */}
      <Card>
        <CardHeader>
          <CardTitle>Editor markdown</CardTitle>
          <CardDescription>
            Edite o front-matter e o corpo da skill. Salve como candidato para
            rodar A/B test antes de promover.
            {dirty ? (
              <Badge variant="warning" className="ml-2">
                Mudanças não salvas
              </Badge>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={28}
            className="font-mono text-xs"
            value={markdown}
            onChange={handleChange}
          />
          <p className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">
            {markdown.length.toLocaleString("pt-BR")} caracteres
          </p>
        </CardContent>
      </Card>

      {/* Ações */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => publicarMutation.mutate({ promover: false })}
          disabled={publicarMutation.isPending || !dirty}
        >
          {publicarMutation.isPending && !publicarMutation.variables?.promover ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Salvar como candidato
        </Button>
        <Button
          variant="default"
          onClick={() => publicarMutation.mutate({ promover: true })}
          disabled={publicarMutation.isPending || !dirty}
        >
          {publicarMutation.isPending && publicarMutation.variables?.promover ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Promover para active
        </Button>
        <Button asChild variant="outline">
          <Link href={`/skills/${encodeURIComponent(nome)}/comparar`}>
            <GitCompareArrows className="h-4 w-4" />
            Comparar com active
          </Link>
        </Button>
        <Button variant="outline" onClick={rodarTeste} disabled={testando}>
          {testando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Rodar teste em petição
        </Button>
      </div>

      {/* Mensagem de status */}
      {publicarMutation.isSuccess ? (
        <Card className="border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/5">
          <CardContent className="pt-4 flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-[color:var(--color-success)]" />
            Skill publicada com sucesso em{" "}
            <code className="text-xs bg-[color:var(--color-card)] px-1.5 py-0.5 rounded">
              {publicarMutation.data?.r2_key}
            </code>
          </CardContent>
        </Card>
      ) : null}

      {publicarMutation.isError ? (
        <Card className="border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive)]/5">
          <CardContent className="pt-4 text-sm text-[color:var(--color-destructive)]">
            {publicarMutation.error instanceof Error
              ? publicarMutation.error.message
              : "Erro ao publicar"}
          </CardContent>
        </Card>
      ) : null}

      {/* Preview do meta gerado */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Preview do _meta.md
          </CardTitle>
          <CardDescription>
            Como esta skill aparecerá no índice agregado consumido pelo
            orquestrador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-[color:var(--color-muted)]/40 border border-[color:var(--color-border)] rounded-md p-3 overflow-auto">
{`- nome: ${skill.metadata.nome}
  descricao: ${skill.metadata.descricao.slice(0, 100)}
  versao: ${skill.metadata.versao}
  categoria: ${skill.metadata.categoria}
  tokens: ${skill.metadata.tokens_aproximados}
  agentes: [${skill.metadata.agentes_aplicaveis.join(", ")}]`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
