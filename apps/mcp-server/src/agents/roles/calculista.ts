/**
 * Calculista — papel 6/8.
 *
 * Responsabilidade:
 *  - Executar cálculos determinísticos via tool MCP
 *    `calcular_reequilibrio_tributario` (engine pura).
 *  - O LLM monta os inputs (alíquotas pré, classificação do contrato,
 *    alíquotas de referência publicadas) e a tool retorna carga pré,
 *    carga pós ano-a-ano (regime transição 2026-2033+), diferencial
 *    e valor de reequilíbrio em centavos.
 *
 * O Calculista é o único papel que combina LLM + lógica determinística.
 */
import type { AgentRole, AgentContext, SkillFull } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import {
  ResultadoCalculistaSchema,
  type ResultadoCalculista,
} from "./_io-schemas.js";
import type { Peticao } from "@vectorgov-t/schemas";

export interface CalculistaInput {
  peticao: Peticao;
  contexto_pedido: string;
}

const SYSTEM_BASE = `Você é o CALCULISTA do sistema multi-agente.
Sua função é EXECUTAR cálculos de reequilíbrio econômico-financeiro.

Regras DURAS:
1. Para cálculos de reequilíbrio decorrentes da Reforma Tributária
   (EC 132/2023, LC 214/2025, Decreto 12955/2026), você DEVE chamar a tool
   'calcular_reequilibrio_tributario' — NÃO calcule manualmente.
2. Os inputs da tool incluem: alíquotas pré (PIS/Cofins/ICMS/ISS),
   classificação do contrato (is_compra_governamental + ente_contratante),
   alíquotas de referência CBS/IBS publicadas pelo Senado/TCU para o
   ano-base e o redutor de compras governamentais.
3. Cada cálculo no output precisa de descrição + inputs nomeados +
   memória passo-a-passo (popule a partir de 'memoria_calculo' devolvida
   pela tool).
4. sucesso=true exige valor_final preenchido (use
   'diferencial.valor_remanescente_contrato_centavos' convertido em BRL)
   + pelo menos 1 linha em memoria.
5. sucesso=false exige campo erro preenchido + valor_final=null.
6. placeholder=false quando a tool foi efetivamente chamada e devolveu
   sucesso=true; só use placeholder=true para cálculos que ainda NÃO têm
   engine determinística disponível.
7. Use centavos integers para evitar floats — em valor_final use number,
   mas garanta que o resultado é finito e não-NaN.`;

export function criarCalculista(): AgentRole<
  CalculistaInput,
  ResultadoCalculista
> {
  return {
    nome: "calculista",
    papel: "Cálculos determinísticos (engine reequilíbrio pós-Reforma)",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: ["calcular_reequilibrio_tributario"],
    modelo: "gemini-3.5-flash",
    schemaOutput: ResultadoCalculistaSchema,
    async executar(
      input: CalculistaInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<ResultadoCalculista> {
      const system = montarSystemPrompt(SYSTEM_BASE, skills);
      const result = await contexto.llm.generateObject({
        modelo: contexto.modelos?.pevs_calculista ?? "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Petição:
- Contrato ${input.peticao.contrato.numero}
- Valor original: R$ ${(input.peticao.contrato.valor_centavos / 100).toFixed(2)}
- Cálculos apresentados pelo requerente: ${
              input.peticao.calculos_apresentados.length === 0
                ? "(nenhum)"
                : input.peticao.calculos_apresentados
                    .map(
                      (c) =>
                        `${c.descricao} → pretendido R$ ${(c.valor_pretendido_centavos / 100).toFixed(2)} (${c.metodologia})`,
                    )
                    .join("; ")
            }

Pedido específico:\n${input.contexto_pedido}\n\nProduza os cálculos necessários.`,
          },
        ],
        schema: ResultadoCalculistaSchema,
        tag: "calculista.calcular",
        temperatura: 0.0,
      });
      contexto.logger.info("calculista.executar concluído", {
        calculos: result.object.calculos.length,
        sucesso: result.object.calculos.filter((c) => c.sucesso).length,
        tracingId: contexto.tracingId,
      });
      return result.object;
    },
  };
}
