/**
 * Conteúdo das 5 fases do fluxo de geração do parecer, em linguagem do usuário.
 *
 * Módulo PURO (sem React/JSX) para ser testável e reutilizável: a barra lateral
 * do chat (`components/notebook/WorkflowSidebar.tsx`) e a página de instruções
 * consomem daqui. As fases espelham o FSM do backend
 * (`apps/mcp-server/src/agents/conversational/fsm.ts`).
 */
import type { EstadoConversa } from "@vectorgov-t/schemas";

export interface FaseInfo {
  /** Número da etapa (1–5). */
  n: number;
  /** Rótulo curto da etapa. */
  titulo: string;
  /** Próxima etapa (null = fluxo concluído). */
  proxima: string | null;
  /** O que o usuário deve pedir/fazer nesta etapa. */
  oQuePedir: string;
}

/** Ordem canônica das fases do funil. */
export const FASES_ORDEM: EstadoConversa[] = [
  "AGUARDANDO_DOCUMENTO",
  "DOCUMENTO_RECEBIDO",
  "PETICAO_EXTRAIDA",
  "ANALISE_PRONTA",
  "PARECER_GERADO",
];

/** Conteúdo de cada fase, em linguagem do usuário. */
export const FASE_INFO: Record<EstadoConversa, FaseInfo> = {
  AGUARDANDO_DOCUMENTO: {
    n: 1,
    titulo: "Anexar o pedido",
    proxima: "Extração dos dados",
    oQuePedir: "Anexe o PDF do pedido de reequilíbrio (botão de anexar).",
  },
  DOCUMENTO_RECEBIDO: {
    n: 2,
    titulo: "Extrair os dados",
    proxima: "Conferência e análise",
    oQuePedir: 'Peça ao assistente: "extraia os dados do pedido".',
  },
  PETICAO_EXTRAIDA: {
    n: 3,
    titulo: "Conferir e analisar",
    proxima: "Geração do parecer",
    oQuePedir:
      'Confira (e corrija, se preciso) os dados extraídos e peça: "analise o pedido".',
  },
  ANALISE_PRONTA: {
    n: 4,
    titulo: "Gerar o parecer",
    proxima: "Parecer concluído",
    oQuePedir: 'Revise o resultado da análise e peça: "gere o parecer".',
  },
  PARECER_GERADO: {
    n: 5,
    titulo: "Concluído",
    proxima: null,
    oQuePedir: "Abra ou baixe o parecer gerado.",
  },
};

/**
 * Texto do "o que pedir agora", com o caso especial de análise inconclusiva
 * (em `ANALISE_PRONTA`, veredito `inconclusiva` → orienta complementar, não gerar).
 */
export function oQuePedirAgora(
  fase: EstadoConversa,
  veredito?: string | null,
): string {
  if (fase === "ANALISE_PRONTA" && veredito === "inconclusiva") {
    return "A análise ficou inconclusiva. Complemente a documentação do pedido e peça para reanalisar.";
  }
  return FASE_INFO[fase].oQuePedir;
}
