/**
 * Tool MCP + regra pura: `classificar_merito`.
 *
 * Torna o VEREDITO de reequilíbrio DETERMINÍSTICO (mesmos fatos resolvidos →
 * mesmo veredito), no mesmo espírito da engine de cálculo
 * (`calcular_reequilibrio_tributario`): "LLM propõe, regra decide".
 *
 * A FONTE da verdade é a função pura `classificarMerito()` — o `pevs-engine`
 * a chama DIRETO em `montarAnalise` (sem passar pela camada MCP, para não
 * acoplar o engine ao registry de tools). A tool MCP abaixo é só um wrapper
 * fino para uso externo / teste.
 *
 * As "regras duras" que antes viviam no PROMPT do Esp. Reequilíbrio (ex.:
 * "valor irrisório <0,5% → improcedente") passam a viver AQUI, como código.
 *
 * CUIDADO — LC 214/2025, Art. 374, §2º: a existência de matriz de risco que
 * atribua o risco tributário à contratada NÃO é critério de inadmissibilidade
 * nem de improcedência. O reequilíbrio por IBS/CBS se aplica mesmo nesses
 * contratos. Por isso NENHUMA regra abaixo lê "matriz de risco".
 */

import type { Env } from "../../../env.js";
import {
  ClassificarMeritoInput,
  type ClassificarMeritoOutputT,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

/** Limiar de materialidade padrão, em PONTOS PERCENTUAIS (art. 376, §3º). */
const LIMIAR_MATERIALIDADE_PP_PADRAO = 0.5;

export interface ClassificarMeritoArgs {
  /** Diferencial de carga em centavos (tool #10). Pode ser negativo. */
  delta_valor_centavos: number;
  /** Diferencial de carga em PONTOS PERCENTUAIS (tool #10). */
  delta_percentual_pp: number;
  /** Valor pleiteado em centavos; `null` se a petição não quantificou. */
  valor_pleiteado_centavos: number | null;
  admissibilidade: {
    no_escopo: boolean;
    tempestivo: boolean;
    instruido: boolean;
  };
  comprovacao_suficiente: boolean;
  /** Limiar de materialidade em p.p. (default 0.5). */
  limiar_materialidade_pp?: number;
}

/**
 * Regra determinística do mérito. Cascata: a PRIMEIRA condição que casar
 * decide. Pré-condição: só roda DEPOIS do gate de `inconclusiva` do Auditor
 * (citações reprovadas) — aqui assume-se análise tecnicamente fundamentada.
 */
export function classificarMerito(
  args: ClassificarMeritoArgs,
): ClassificarMeritoOutputT {
  const {
    delta_valor_centavos: delta,
    delta_percentual_pp: deltaPp,
    valor_pleiteado_centavos: pleiteado,
    admissibilidade,
    comprovacao_suficiente,
  } = args;
  const limiar =
    args.limiar_materialidade_pp ?? LIMIAR_MATERIALIDADE_PP_PADRAO;

  const improcedente = (
    motivo: ClassificarMeritoOutputT["motivo"],
    fundamento: string,
    revisao_de_oficio = false,
  ): ClassificarMeritoOutputT => ({
    veredito: "improcedente",
    valor_reconhecido_centavos: 0,
    motivo,
    revisao_de_oficio,
    fundamento,
  });

  // 1. Fora do escopo do reequilíbrio (art. 373).
  if (!admissibilidade.no_escopo) {
    return improcedente(
      "fora_de_escopo",
      "Pedido fora do escopo do reequilíbrio por IBS/CBS (LC 214/2025, art. 373).",
    );
  }

  // 2. Intempestivo (art. 376, II).
  if (!admissibilidade.tempestivo) {
    return improcedente(
      "intempestivo",
      "Pedido apresentado fora do prazo (LC 214/2025, art. 376, II).",
    );
  }

  // 3. Não instruído / comprovação insuficiente → DILIGÊNCIA (art. 376, IV).
  //    Pedido não quantificado (sem valor pleiteado) também é falta de
  //    instrução: sem cálculo não há o que deferir.
  if (
    !admissibilidade.instruido ||
    !comprovacao_suficiente ||
    pleiteado === null
  ) {
    return {
      veredito: "diligencia",
      valor_reconhecido_centavos: 0,
      motivo: "comprovacao_insuficiente",
      revisao_de_oficio: false,
      fundamento:
        "Petição não instruída / desequilíbrio não comprovado — abertura de diligência para complementação (LC 214/2025, art. 376, IV; art. 374, caput).",
    };
  }

  // 4. Carga REDUZIU (delta < 0): pedido do contratado improcede, mas a
  //    Administração deve rever de ofício para reduzir (art. 375).
  if (delta < 0) {
    return improcedente(
      "carga_reduzida",
      "Reforma reduziu a carga tributária do contrato (delta negativo); pedido improcedente, com revisão de ofício para redução (LC 214/2025, art. 375).",
      true,
    );
  }

  // 5. Sem desequilíbrio (delta == 0) ou imaterial (|delta_pp| < limiar).
  if (delta === 0) {
    return improcedente(
      "sem_desequilibrio",
      "Diferencial de carga nulo — não há desequilíbrio a recompor (LC 214/2025, art. 374, caput).",
    );
  }
  if (Math.abs(deltaPp) < limiar) {
    return improcedente(
      "imaterial",
      `Diferencial de ${deltaPp} p.p. abaixo do limiar de materialidade (${limiar} p.p.) fixado pela metodologia do órgão (LC 214/2025, art. 376, §3º).`,
    );
  }

  // 6. Há desequilíbrio positivo e material a recompor (delta > 0).
  if (pleiteado <= delta) {
    return {
      veredito: "procedente",
      valor_reconhecido_centavos: pleiteado,
      motivo: "pleito_integral",
      revisao_de_oficio: false,
      fundamento:
        "Desequilíbrio comprovado e pleito dentro do diferencial apurado — deferimento integral (LC 214/2025, arts. 373-374).",
    };
  }
  return {
    veredito: "parcialmente_procedente",
    valor_reconhecido_centavos: delta,
    motivo: "pleito_excede_delta",
    revisao_de_oficio: false,
    fundamento:
      "Pleito excede o diferencial de carga apurado — deferimento parcial limitado ao impacto demonstrado (LC 214/2025, art. 374, caput).",
  };
}

async function handler(
  args: unknown,
  _env: Env,
): Promise<ClassificarMeritoOutputT> {
  const parsed = ClassificarMeritoInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "classificar_merito: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  return classificarMerito(parsed.data);
}

export const classificarMeritoTool: ToolDescriptor = {
  name: "classificar_merito",
  description:
    "Regra determinística do veredito de reequilíbrio (procede / improcede / " +
    "parcial / diligência) a partir do diferencial calculado (centavos + p.p.), " +
    "do valor pleiteado, das flags de admissibilidade e da suficiência da " +
    "comprovação. Torna o veredito reprodutível: mesmos fatos resolvidos → mesmo veredito.",
  inputSchema: zodToMcpSchema(ClassificarMeritoInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
