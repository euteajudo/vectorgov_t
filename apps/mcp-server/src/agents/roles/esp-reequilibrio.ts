/**
 * Especialista em Reequilíbrio Econômico-Financeiro — papel 5/8.
 *
 * Responsabilidade:
 *  - Orquestrar/integrar as visões do Analista Tributário e do
 *    Especialista em Licitações.
 *  - Produzir veredito PRELIMINAR (procedente / improcedente / etc.)
 *    antes da auditoria.
 *  - Identificar pontos pendentes que possam virar bloqueantes.
 */
import type { AgentRole, AgentContext, SkillFull } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import {
  SinteseReequilibrioSchema,
  type SinteseReequilibrio,
  type AnaliseJuridica,
  type ParecerLicitacao,
  type ResultadoCalculista,
} from "./_io-schemas.js";

export interface EspReequilibrioInput {
  pergunta_focal: string;
  analise_tributaria: AnaliseJuridica;
  parecer_licitacao: ParecerLicitacao;
  resultado_calculista: ResultadoCalculista;
}

const SYSTEM_BASE = `Você é o ESPECIALISTA EM REEQUILÍBRIO ECONÔMICO-FINANCEIRO.
Você INTEGRA as visões tributária e de licitações + os cálculos do Calculista
em uma SÍNTESE textual fundamentada.

IMPORTANTE: o veredito FINAL NÃO é seu — ele é decidido por uma regra
determinística (classificar_merito) sobre o número calculado + as flags de
admissibilidade. Você só SUGERE um veredito (veredito_sugerido, advisory) e,
sobretudo, produz a FUNDAMENTAÇÃO e os pontos a complementar.

Regras DURAS:
1. 'sintese' deve ter pelo menos 50 chars integrando as visões tributária,
   de licitações e o resultado do cálculo.
2. 'veredito_sugerido' é apenas um palpite informado — NÃO se preocupe em
   acertar regras de materialidade/prazo; a regra determinística cuida disso.
3. Se houver risco jurídico bloqueante, registre-o em 'pontos_a_complementar'
   com severidade "bloqueante".
4. NÃO invente valores: o número vem do Calculista.`;

export function criarEspReequilibrio(): AgentRole<
  EspReequilibrioInput,
  SinteseReequilibrio
> {
  return {
    nome: "esp_reequilibrio",
    papel: "Integra Tributário + Licitações para veredito preliminar",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: [],
    modelo: "gemini-3.5-flash",
    schemaOutput: SinteseReequilibrioSchema,
    async executar(
      input: EspReequilibrioInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<SinteseReequilibrio> {
      const system = montarSystemPrompt(SYSTEM_BASE, skills);
      const result = await contexto.llm.generateObject({
        modelo: contexto.modelos?.pevs_esp_reequilibrio ?? "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Pergunta focal: ${input.pergunta_focal}

== Análise Tributária ==
Interpretação: ${input.analise_tributaria.interpretacao}
Riscos: ${input.analise_tributaria.riscos_juridicos.join("; ") || "(nenhum)"}

== Parecer de Licitações ==
Enquadramento: ${input.parecer_licitacao.enquadramento_lei_14133}
TCU: ${input.parecer_licitacao.jurisprudencia_tcu_aplicavel.join("; ") || "(nenhum)"}
Atenção: ${input.parecer_licitacao.pontos_de_atencao.join("; ") || "(nenhum)"}

== Cálculos ==
${input.resultado_calculista.calculos
  .map(
    (c) =>
      `- ${c.descricao} → ${c.sucesso ? `OK (${c.valor_final} ${c.unidade_final})` : `FAIL: ${c.erro}`}`,
  )
  .join("\n") || "(sem cálculos)"}`,
          },
        ],
        schema: SinteseReequilibrioSchema,
        tag: "esp_reequilibrio.integrar",
        temperatura: 0.2,
      });
      contexto.logger.info("esp_reequilibrio.executar concluído", {
        veredito_sugerido: result.object.veredito_sugerido,
        tracingId: contexto.tracingId,
      });
      return result.object;
    },
  };
}
