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
import type { Peticao } from "@vectorgov-t/schemas";

export interface AnalistaInput {
  pergunta_focal: string;
  resultado_pesquisa: ResultadoPesquisa;
  /**
   * Petição em análise — necessária para o juízo de admissibilidade
   * (tempestividade, instrução, escopo), que depende de fatos da petição,
   * não só dos achados de pesquisa.
   */
  peticao: Peticao;
}

const SYSTEM_BASE = `Você é o ANALISTA JURÍDICO TRIBUTÁRIO de um sistema multi-agente.
Sua função é INTERPRETAR normas tributárias aplicáveis ao caso E emitir o
JUÍZO DE ADMISSIBILIDADE do pedido.

Regras DURAS:
1. SÓ interprete normas já trazidas pelo Pesquisador (ou explicitamente referenciadas).
2. Sempre aponte riscos jurídicos (prescrição, decadência, vícios formais).
3. citacoes_aplicaveis devem ser referências legíveis (ex.: "Art. 124 da Lei 14.133/2021").
4. NÃO fabrique normas — se faltar fonte, registre como risco.
5. PREENCHA o bloco 'admissibilidade' como flags booleanas, com base nos FATOS
   da petição (não na sua opinião de mérito):
   - no_escopo: o pedido trata de reequilíbrio por IBS/CBS pós-Reforma? (art. 373)
   - tempestivo: foi apresentado em prazo razoável? (art. 376, II) — se a petição
     não trouxer elementos de prazo, assuma TRUE e registre a incerteza na justificativa.
   - instruido: a petição traz documentos/memória de cálculo/valor pleiteado mínimos? (art. 376, IV)
   - comprovacao_suficiente: o desequilíbrio está EFETIVAMENTE comprovado? (art. 374 caput)
   Na dúvida sobre instrução/comprovação, marque FALSE — isso gera DILIGÊNCIA
   (complementação), não indeferimento de mérito. Explique cada flag em 'justificativa'.`;

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
        modelo: contexto.modelos?.pevs_analista ?? "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Pergunta focal: ${input.pergunta_focal}

== Petição (para juízo de admissibilidade) ==
Contrato: ${input.peticao.contrato.numero} (${input.peticao.contrato.modalidade}), valor R$ ${(input.peticao.contrato.valor_centavos / 100).toFixed(2)}
Data assinatura: ${input.peticao.contrato.data_assinatura} | Início vigência: ${input.peticao.contrato.data_inicio_vigencia} | Protocolo: ${input.peticao.data_protocolo}
Objeto: ${input.peticao.contrato.objeto}
Fato alegado: ${input.peticao.fato_alegado}
Base legal invocada: ${input.peticao.base_legal_invocada.join("; ") || "(nenhuma)"}
Cálculos apresentados pelo requerente: ${
              input.peticao.calculos_apresentados.length === 0
                ? "(NENHUM — pedido não quantificado)"
                : input.peticao.calculos_apresentados
                    .map(
                      (c) =>
                        `${c.descricao} → R$ ${(c.valor_pretendido_centavos / 100).toFixed(2)} (${c.metodologia})`,
                    )
                    .join("; ")
            }
Anexos: ${input.peticao.anexos_urls.length} documento(s)

== Achados do Pesquisador (${input.resultado_pesquisa.achados.length}) ==
${input.resultado_pesquisa.achados
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
        admissibilidade: result.object.admissibilidade,
        tracingId: contexto.tracingId,
      });
      return result.object;
    },
  };
}
