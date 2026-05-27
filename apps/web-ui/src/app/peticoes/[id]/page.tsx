/**
 * Rota `/peticoes/[id]` — visualização da análise completa.
 *
 * Server component leve: define metadata e renderiza o componente client
 * `AnaliseView` que faz a query e cuida da interação.
 */
import type { Metadata } from "next";
import { AnaliseView } from "./_view";

export const metadata: Metadata = {
  title: "Análise de petição — Vectorgov_t",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PeticaoPage({ params }: Props) {
  const { id } = await params;
  return <AnaliseView id={id} />;
}
