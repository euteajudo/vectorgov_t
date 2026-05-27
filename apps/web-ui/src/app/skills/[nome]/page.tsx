/**
 * Rota `/skills/[nome]` — editor markdown da skill.
 */
import type { Metadata } from "next";
import { SkillEditor } from "./_editor";

export const metadata: Metadata = {
  title: "Editor de skill — Vectorgov_t",
};

interface Props {
  params: Promise<{ nome: string }>;
}

export default async function SkillEditorPage({ params }: Props) {
  const { nome } = await params;
  return <SkillEditor nome={decodeURIComponent(nome)} />;
}
