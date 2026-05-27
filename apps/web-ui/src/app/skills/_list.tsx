/**
 * Lista de skills (client component) — tabela com filtro por categoria.
 *
 * Cada linha leva para `/skills/[nome]` (editor).
 */
"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { listarSkills } from "@/lib/api";

interface SkillRow {
  nome: string;
  descricao: string;
  categoria: string;
  versao: string;
  tokens_aproximados: number;
  agentes_aplicaveis: string[];
}

const CATEGORIA_LABEL: Record<string, string> = {
  "analise-peticao": "Análise de petição",
  "geracao-parecer": "Geração de parecer",
  "calculo-tributario": "Cálculo",
  "pesquisa-legislacao": "Pesquisa",
  "utilidades": "Utilidades",
};

export function SkillsList() {
  const [filtro, setFiltro] = React.useState("");
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["skills"],
    queryFn: listarSkills,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-[color:var(--color-destructive)]">
          {error instanceof Error ? error.message : "Erro ao carregar skills"}
        </CardContent>
      </Card>
    );
  }

  const skills = ((data ?? []) as unknown as SkillRow[]).filter((s) => {
    if (!filtro) return true;
    const q = filtro.toLowerCase();
    return (
      s.nome.toLowerCase().includes(q) ||
      s.descricao.toLowerCase().includes(q) ||
      s.categoria.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Filtrar por nome, descrição ou categoria…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="max-w-md"
        />
        <span className="text-sm text-[color:var(--color-muted-foreground)]">
          {skills.length} de {data?.length ?? 0} skills
        </span>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Agentes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skills.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-8 text-[color:var(--color-muted-foreground)]"
                >
                  Nenhuma skill encontrada.
                </TableCell>
              </TableRow>
            ) : (
              skills.map((s) => (
                <TableRow key={s.nome} className="cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/skills/${encodeURIComponent(s.nome)}`}
                      className="block"
                    >
                      <p className="font-medium flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-[color:var(--color-warning)]" />
                        {s.nome}
                      </p>
                      <p className="text-xs text-[color:var(--color-muted-foreground)] line-clamp-1">
                        {s.descricao}
                      </p>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {CATEGORIA_LABEL[s.categoria] ?? s.categoria}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{s.versao}</code>
                  </TableCell>
                  <TableCell className="text-sm">
                    {s.tokens_aproximados.toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {s.agentes_aplicaveis.slice(0, 2).map((a) => (
                        <Badge key={a} variant="secondary" className="text-[10px]">
                          {a}
                        </Badge>
                      ))}
                      {s.agentes_aplicaveis.length > 2 ? (
                        <Badge variant="secondary" className="text-[10px]">
                          +{s.agentes_aplicaveis.length - 2}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
