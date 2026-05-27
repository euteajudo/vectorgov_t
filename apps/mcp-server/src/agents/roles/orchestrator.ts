/**
 * Orquestrador — papel 1/8.
 *
 * Responsabilidade:
 *  - FASE 1 PLAN: decompõe a pergunta do usuário em um plano com
 *    subtarefas atribuídas a agentes especialistas.
 *  - FASE 5 SYNTHESIZE: opcionalmente integra resultados finais (no
 *    nosso desenho atual, quem sintetiza o output final é o Redator,
 *    mas o Orquestrador escolhe qual tipo de documento solicitar).
 *
 * Modelo: gemini-3.5-flash (decomposição é tarefa de baixa
 * complexidade, custo > qualidade marginal).
 */
import type { AgentRole, AgentContext, SkillFull } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import {
  PlanoOrquestradorSchema,
  type PlanoOrquestrador,
} from "./_io-schemas.js";
import type { Peticao } from "@vectorgov-t/schemas";

/** Input do Orquestrador no Feature 1: a petição completa. */
export interface OrquestradorInput {
  peticao: Peticao;
}

const SYSTEM_BASE = `Você é o ORQUESTRADOR de um sistema multi-agente jurídico.
Sua função é decompor a análise de uma petição de reequilíbrio econômico-financeiro
em sub-tarefas executáveis pelos agentes especializados disponíveis.

Agentes disponíveis:
- pesquisador: busca semântica + filesystem para citações.
- analista: interpreta normas tributárias.
- esp_licitacoes: Lei 14.133 + jurisprudência TCU.
- esp_reequilibrio: integra descobertas de tributário + licitações.
- calculista: cálculos determinísticos.
- auditor: verifica TODA citação contra filesystem.
- redator: produz o documento formal final.

Regras DURAS:
1. SEMPRE inclua uma subtarefa para o pesquisador antes de qualquer interpretação.
2. SEMPRE inclua uma subtarefa para o auditor antes do redator.
3. Calculista é chamado em paralelo ao pesquisador (não há dependência).
4. esp_reequilibrio depende de analista + esp_licitacoes.
5. Saída DEVE validar contra o schema PlanoOrquestrador.`;

export function criarOrquestrador(): AgentRole<
  OrquestradorInput,
  PlanoOrquestrador
> {
  return {
    nome: "orquestrador",
    papel: "Decompõe pergunta em plano executável",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: [], // Orquestrador não usa tools MCP diretamente
    modelo: "gemini-3.5-flash",
    schemaOutput: PlanoOrquestradorSchema,
    async executar(
      input: OrquestradorInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<PlanoOrquestrador> {
      const system = montarSystemPrompt(SYSTEM_BASE, skills);
      const result = await contexto.llm.generateObject({
        modelo: contexto.modelos?.pevs_orquestrador ?? "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Petição a analisar (resumo):
- Contratante: ${input.peticao.contratante.razao_social}
- Contratado: ${input.peticao.contratado.razao_social}
- Contrato: ${input.peticao.contrato.numero} (${input.peticao.contrato.modalidade})
- Valor: R$ ${(input.peticao.contrato.valor_centavos / 100).toFixed(2)}
- Fato alegado: ${input.peticao.fato_alegado}
- Base legal invocada: ${input.peticao.base_legal_invocada.join("; ") || "(não informada)"}

Produza um plano com subtarefas. NÃO execute as subtarefas.`,
          },
        ],
        schema: PlanoOrquestradorSchema,
        tag: "orquestrador.plan",
        temperatura: 0.2,
      });
      contexto.logger.info("orquestrador.executar concluído", {
        subtarefas: result.object.subtarefas.length,
        tracingId: contexto.tracingId,
      });
      return result.object;
    },
  };
}
