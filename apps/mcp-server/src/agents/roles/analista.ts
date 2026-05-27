/**
 * Analista Jurídico — papel 3/8.
 *
 * Responsabilidade:
 *  - Interpretar normas TRIBUTÁRIAS aplicáveis ao caso.
 *  - Apontar riscos jurídicos (prescrição, vícios formais, etc.).
 *  - Indicar citações aplicáveis (apenas referências; a verificação
 *    fica com o Auditor).
 *
 * Modelo: gemini-3.5-flash (interpretação focada, com input já
 * filtrado pelo Pesquisador).
 */
import type { AgentRole, AgentContext, SkillFull } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import {
  AnaliseJuridicaSchema,
  type AnaliseJuridica,
  type ResultadoPesquisa,
} from "./_io-schemas.js";

export interface AnalistaInput {
  pergunta_focal: string;
  resultado_pesquisa: ResultadoPesquisa;
}

const SYSTEM_BASE = `Você é o ANALISTA JURÍDICO TRIBUTÁRIO de um sistema multi-agente.
Sua função é INTERPRETAR normas tributárias aplicáveis ao caso.

Regras DURAS:
1. SÓ interprete normas já trazidas pelo Pesquisador (ou explicitamente referenciadas).
2. Sempre aponte riscos jurídicos (prescrição, decadência, vícios formais).
3. citacoes_aplicaveis devem ser referências legíveis (ex.: "Art. 124 da Lei 14.133/2021").
4. NÃO fabrique normas — se faltar fonte, registre como risco.`;

export function criarAnalistaJuridico(): AgentRole<
  AnalistaInput,
  AnaliseJuridica
> {
  return {
    nome: "analista_juridico",
    papel: "Interpreta normas tributárias",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: [],
    modelo: "gemini-3.5-flash",
    schemaOutput: AnaliseJuridicaSchema,
    async executar(
      input: AnalistaInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<AnaliseJuridica> {
      const system = montarSystemPrompt(SYSTEM_BASE, skills);
      const result = await contexto.llm.generateObject({
        modelo: "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Pergunta focal: ${input.pergunta_focal}\n\nAchados do Pesquisador (${input.resultado_pesquisa.achados.length}):\n${input.resultado_pesquisa.achados
              .map((a, i) => `${i + 1}. [${a.fonte}] ${a.trecho.slice(0, 200)}`)
              .join("\n")}`,
          },
        ],
        schema: AnaliseJuridicaSchema,
        tag: "analista.interpretar",
        temperatura: 0.2,
      });
      contexto.logger.info("analista.executar concluído", {
        riscos: result.object.riscos_juridicos.length,
        tracingId: contexto.tracingId,
      });
      return result.object;
    },
  };
}
