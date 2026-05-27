/**
 * Rota `/skills/[nome]/comparar` — comparação visual diff entre versão
 * active e versão candidata da skill.
 */
import type { Metadata } from "next";
import { SkillCompare } from "./_compare";

export const metadata: Metadata = {
  title: "Comparar versões de skill — Vectorgov_t",
};

interface Props {
  params: Promise<{ nome: string }>;
}

export default async function CompararPage({ params }: Props) {
  const { nome } = await params;
  return <SkillCompare nome={decodeURIComponent(nome)} />;
}
