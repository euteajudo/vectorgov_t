/**
 * Calculista — papel 6/8.
 *
 * Responsabilidade:
 *  - Executar cálculos determinísticos (em Fase 4 será integrado com
 *    planilhas oficiais TCU + tributos pós-reforma).
 *  - Por ora (Fase 2), devolve placeholders válidos contra
 *    CalculoTributarioSchema.
 *
 * O Calculista é o único papel que combina LLM + lógica determinística:
 * o LLM monta a estrutura do pedido de cálculo (qual tipo, quais inputs),
 * e a engine determinística faz a aritmética. Aqui simulamos os dois
 * com o mock LLM.
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
1. Cada cálculo precisa de descrição + inputs nomeados + memória passo-a-passo.
2. sucesso=true exige valor_final preenchido + pelo menos 1 linha em memoria.
3. sucesso=false exige campo erro preenchido + valor_final=null.
4. placeholder=true até integração com engine real (Fase 4).
5. Use centavos integers para evitar floats — em valor_final use number,
   mas garanta que o resultado é finito e não-NaN.`;

export function criarCalculista(): AgentRole<
  CalculistaInput,
  ResultadoCalculista
> {
  return {
    nome: "calculista",
    papel: "Cálculos determinísticos (placeholder Fase 2)",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: [],
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
