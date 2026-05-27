/**
 * Rota `/peticoes/[id]/parecer` — geração e edição do parecer formal.
 */
import type { Metadata } from "next";
import { ParecerView } from "./_view";

export const metadata: Metadata = {
  title: "Parecer — Vectorgov_t",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ParecerPage({ params }: Props) {
  const { id } = await params;
  return <ParecerView peticaoId={id} />;
}
