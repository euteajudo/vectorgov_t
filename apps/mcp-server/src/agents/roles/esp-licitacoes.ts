/**
 * Especialista em Licitações — papel 4/8.
 *
 * Responsabilidade:
 *  - Enquadrar o caso na Lei 14.133/2021 (nova lei de licitações).
 *  - Indicar jurisprudência TCU aplicável.
 *  - Sinalizar pontos de atenção operacional do gestor público.
 */
import type { AgentRole, AgentContext, SkillFull } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import {
  ParecerLicitacaoSchema,
  type ParecerLicitacao,
  type ResultadoPesquisa,
} from "./_io-schemas.js";

export interface EspLicitacoesInput {
  pergunta_focal: string;
  resultado_pesquisa: ResultadoPesquisa;
}

const SYSTEM_BASE = `Você é o ESPECIALISTA EM LICITAÇÕES (Lei 14.133/2021).
Sua função é enquadrar o caso na nova lei e apontar jurisprudência TCU.

Regras DURAS:
1. Cite apenas dispositivos da Lei 14.133/2021 ou súmulas/acórdãos TCU.
2. enquadramento_lei_14133 deve dizer EXATAMENTE qual artigo/capítulo se aplica.
3. jurisprudencia_tcu_aplicavel: lista de "Acórdão NNNN/AAAA-Plenário".
4. pontos_de_atencao: riscos práticos de execução (prazo, contraditório, dolo/culpa).`;

export function criarEspLicitacoes(): AgentRole<
  EspLicitacoesInput,
  ParecerLicitacao
> {
  return {
    nome: "esp_licitacoes",
    papel: "Lei 14.133 + jurisprudência TCU",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: [],
    modelo: "gemini-3.5-flash",
    schemaOutput: ParecerLicitacaoSchema,
    async executar(
      input: EspLicitacoesInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<ParecerLicitacao> {
      const system = montarSystemPrompt(SYSTEM_BASE, skills);
      const result = await contexto.llm.generateObject({
        modelo: "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Pergunta focal: ${input.pergunta_focal}\n\nAchados do Pesquisador:\n${input.resultado_pesquisa.achados
              .slice(0, 10)
              .map((a, i) => `${i + 1}. [${a.fonte}] ${a.trecho.slice(0, 200)}`)
              .join("\n")}`,
          },
        ],
        schema: ParecerLicitacaoSchema,
        tag: "esp_licitacoes.enquadrar",
        temperatura: 0.2,
      });
      contexto.logger.info("esp_licitacoes.executar concluído", {
        jurisprudencia: result.object.jurisprudencia_tcu_aplicavel.length,
        pontos_atencao: result.object.pontos_de_atencao.length,
        tracingId: contexto.tracingId,
      });
      return result.object;
    },
  };
}
