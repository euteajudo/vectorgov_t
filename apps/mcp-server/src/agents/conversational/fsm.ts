/**
 * fsm.ts — Máquina de estados da conversa guiada (o micro-harness do Gemini).
 *
 * Tudo aqui é PURO e determinístico: recebe o estado do mundo já lido e decide
 *  (a) em que fase a conversa está,
 *  (b) quais tools de transição o modelo pode ver,
 *  (c) o bloco de contexto a injetar no system prompt.
 *
 * O LLM nunca decide a topologia — só conversa dentro da fase.
 * Ver docs/design/fsm-conversacional.md.
 */
import type { EstadoConversa, PeticaoRascunho } from "@vectorgov-t/schemas";

/** Sinais do storage real usados para derivar a fase (nunca a memória do LLM). */
export interface EstadoInputs {
  temDocumento: boolean;
  temRascunho: boolean;
  analiseId: string | null;
  temParecer: boolean;
}

/**
 * Deriva a fase atual a partir do estado real. Função total: cobre os 5
 * estados na ordem do funil. É o coração testável da FSM.
 */
export function derivarEstado(i: EstadoInputs): EstadoConversa {
  if (!i.temDocumento) return "AGUARDANDO_DOCUMENTO";
  if (!i.temRascunho) return "DOCUMENTO_RECEBIDO";
  if (!i.analiseId) return "PETICAO_EXTRAIDA";
  if (!i.temParecer) return "ANALISE_PRONTA";
  return "PARECER_GERADO";
}

/** Guarda da transição PETICAO_EXTRAIDA → ANALISE_PRONTA. */
export function podeAnalisar(r: PeticaoRascunho): boolean {
  return (r.contrato_valor_centavos ?? 0) > 0 && r.resumo_pedido.trim().length >= 50;
}

/** O que ainda falta para poder analisar (guia o usuário no prompt). */
export function pendenciasParaAnalisar(r: PeticaoRascunho): string[] {
  const faltas: string[] = [];
  if (!((r.contrato_valor_centavos ?? 0) > 0)) faltas.push("valor do contrato");
  if (r.resumo_pedido.trim().length < 50) {
    faltas.push("descrição do fato alegado (mín. 50 caracteres)");
  }
  return faltas;
}

/**
 * Gating: tools de TRANSIÇÃO permitidas por estado. As de consulta ficam
 * sempre ligadas (definidas no engine) — aqui só o trilho estratégico.
 *
 * `analisar_reequilibrio` aparece em PETICAO_EXTRAIDA, mas só EXECUTA se a
 * guarda `podeAnalisar` passar (validada na própria tool). `gerar_parecer` só
 * em ANALISE_PRONTA (e a tool recusa veredito inconclusiva).
 */
export function toolsDeTransicaoPermitidas(estado: EstadoConversa): string[] {
  switch (estado) {
    case "DOCUMENTO_RECEBIDO":
      return ["extrair_peticao_do_documento"];
    case "PETICAO_EXTRAIDA":
      return ["extrair_peticao_do_documento", "analisar_reequilibrio"];
    case "ANALISE_PRONTA":
      return ["gerar_parecer"];
    case "AGUARDANDO_DOCUMENTO":
    case "PARECER_GERADO":
    default:
      return [];
  }
}

/** Metadados de cada fase para montar o bloco de contexto. */
const FASE_INFO: Record<EstadoConversa, { produto: string; proxima: string }> = {
  AGUARDANDO_DOCUMENTO: {
    produto: "um PDF do pedido de reequilíbrio anexado",
    proxima: "DOCUMENTO_RECEBIDO (extrair os dados do pedido)",
  },
  DOCUMENTO_RECEBIDO: {
    produto: "os dados da petição extraídos do documento",
    proxima: "PETICAO_EXTRAIDA (confirmar os dados e analisar)",
  },
  PETICAO_EXTRAIDA: {
    produto: "dados da petição completos e confirmados",
    proxima: "ANALISE_PRONTA (rodar a análise de reequilíbrio)",
  },
  ANALISE_PRONTA: {
    produto: "o parecer formal gerado a partir da análise",
    proxima: "PARECER_GERADO (gerar o parecer formal)",
  },
  PARECER_GERADO: {
    produto: "—",
    proxima: "— (fluxo concluído)",
  },
};

export interface BlocoEstadoCtx {
  estado: EstadoConversa;
  rascunho: PeticaoRascunho | null;
  veredito: string | null;
  /**
   * Skills oferecidas NESTA fase (push). Lidas ao vivo do `_meta.json` pelo
   * engine — refletem CRUD em tempo real (skill nova/atualizada/deletada).
   * Vazio/ausente → nenhuma seção de skills é injetada.
   */
  skillsDaFase?: Array<{ nome: string; descricao: string }>;
}

/**
 * Monta o bloco [ESTADO DA CONVERSA] injetado no system prompt a cada turno.
 * Texto 100% determinístico — é o backend "instruindo" o condutor.
 */
export function montarBlocoEstado(ctx: BlocoEstadoCtx): string {
  const info = FASE_INFO[ctx.estado];
  const linhas: string[] = [
    "[ESTADO DA CONVERSA]",
    `Fase atual: ${ctx.estado}`,
    `Produto desta fase: ${info.produto}`,
    `Próxima fase: ${info.proxima}`,
  ];

  switch (ctx.estado) {
    case "AGUARDANDO_DOCUMENTO":
      linhas.push("Ações permitidas: orientar o usuário a anexar o PDF do pedido");
      break;
    case "DOCUMENTO_RECEBIDO":
      linhas.push("Ações permitidas: extrair os dados do pedido do documento");
      break;
    case "PETICAO_EXTRAIDA": {
      const faltas = ctx.rascunho ? pendenciasParaAnalisar(ctx.rascunho) : ["dados da petição"];
      if (faltas.length > 0) {
        linhas.push(`Pendências para avançar: ${faltas.join("; ")}`);
        linhas.push("Ações permitidas: ajudar o usuário a completar/corrigir os dados");
      } else {
        linhas.push("Pendências para avançar: nenhuma — pronto para analisar");
        linhas.push("Ações permitidas: analisar agora | corrigir algum dado");
      }
      break;
    }
    case "ANALISE_PRONTA":
      if (ctx.veredito === "inconclusiva") {
        linhas.push(
          "Veredito: inconclusiva — NÃO gere parecer; oriente o usuário a complementar a documentação e reanalisar",
        );
        linhas.push("Ações permitidas: complementar dados e reanalisar");
      } else {
        linhas.push(`Veredito: ${ctx.veredito ?? "(definido)"}`);
        linhas.push("Ações permitidas: gerar parecer | ver a análise completa");
      }
      break;
    case "PARECER_GERADO":
      linhas.push("Ações permitidas: apresentar o parecer e oferecer abri-lo");
      break;
  }

  // Skills da fase (push). Determinístico: o backend diz ao condutor quais
  // instruções carregar AGORA. A lista vem do _meta.json (CRUD ao vivo).
  if (ctx.skillsDaFase && ctx.skillsDaFase.length > 0) {
    linhas.push(
      "",
      "Skills recomendadas nesta fase (carregue o conteúdo com a tool " +
        "`skill_carregar(nome)` antes de produzir o entregável da fase):",
    );
    for (const s of ctx.skillsDaFase) {
      linhas.push(`- \`${s.nome}\`: ${s.descricao}`);
    }
    linhas.push(
      "Use `skill_listar({ fase })` para reconsultar a qualquer momento — a " +
        "lista é dinâmica e pode mudar entre turnos.",
    );
  }

  linhas.push(
    "",
    "Conduza o usuário à próxima fase. Você pode conversar livremente (tirar dúvidas, " +
      "explicar normas, consultar a legislação), mas ao fim de cada resposta ofereça as " +
      "próximas ações com a tool `oferecer_opcoes`. NUNCA pule de fase: só avança quando o " +
      "produto da fase atual estiver completo. As ferramentas que avançam o fluxo só " +
      "aparecem quando é a hora certa.",
  );
  return linhas.join("\n");
}
