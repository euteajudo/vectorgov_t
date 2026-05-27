/**
 * Redator — papel 8/8.
 *
 * Responsabilidade:
 *  - Produzir o documento formal final (parecer / análise / memorando).
 *  - Consome uma `AnaliseReequilibrio` já assinada pelo Auditor.
 *  - NÃO faz novas verificações — apenas formata.
 *
 * Modelo: gemini-3.5-flash (formatação de texto é tarefa simples).
 *
 * Decisão de design: o Redator devolve o `Parecer` completo. O caller
 * (PEVS engine) é quem decide se vai gravar no SessionAgent.
 */
import type { AgentRole, AgentContext, SkillFull } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import { ParecerSchema, type Parecer, type AnaliseReequilibrio } from "@vectorgov-t/schemas";
import { type TipoDocumentoRedator } from "./_io-schemas.js";

export interface RedatorInput {
  analise: AnaliseReequilibrio;
  tipo_documento: TipoDocumentoRedator;
  /** Metadados do cabeçalho (parecerista, órgão, etc.). */
  cabecalho_meta: {
    numero: string;
    parecerista: string;
    orgao: string;
    assunto: string;
    data: string;
  };
  /** ID do parecer a ser gerado (UUID v4). */
  parecer_id: string;
}

const SYSTEM_BASE = `Você é o REDATOR JURÍDICO do sistema multi-agente.
Sua função é PRODUZIR o documento formal final (parecer ou análise técnica).

Regras DURAS:
1. Use APENAS citações já APROVADAS pelo Auditor — nunca invente nem cite REJEITADA/PENDENTE.
2. Estrutura formal I-V (Relatório / Fundamentação / Conclusão / Cálculos / Recomendações).
3. Conclusão objetiva em até 500 chars, alinhada com o veredito da análise.
4. conteudo de cada seção deve ter pelo menos 50 chars.
5. Para parecer_formal: tom institucional, terceira pessoa.
6. Para analise_tecnica: tom interno, pode ser mais direto.
7. Para memorando: estrutura mais enxuta, mas mantém as 5 seções.`;

export function criarRedator(): AgentRole<RedatorInput, Parecer> {
  return {
    nome: "redator",
    papel: "Formata output final (parecer / análise / memorando)",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: [],
    modelo: "gemini-3.5-flash",
    schemaOutput: ParecerSchema,
    async executar(
      input: RedatorInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<Parecer> {
      // Guarda dura: nunca permitir REJEITADA/PENDENTE no parecer.
      const naoAprovada = input.analise.citacoes.find(
        (c) => c.status !== "APROVADA",
      );
      if (naoAprovada) {
        throw new Error(
          `redator: análise contém citação não APROVADA (${naoAprovada.norma} ${naoAprovada.artigo} = ${naoAprovada.status}). Aborto antes de chamar LLM.`,
        );
      }
      const system = montarSystemPrompt(SYSTEM_BASE, skills);
      const result = await contexto.llm.generateObject({
        modelo: "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Análise pronta:
- Veredito: ${input.analise.veredito}
- Score confiança: ${input.analise.score_confianca}
- Fundamentação (resumo): ${input.analise.fundamentacao.slice(0, 600)}...
- Citações APROVADAS: ${input.analise.citacoes.length}
- Cálculos: ${input.analise.calculos.length}

Cabeçalho:
- número=${input.cabecalho_meta.numero}
- parecerista=${input.cabecalho_meta.parecerista}
- órgão=${input.cabecalho_meta.orgao}
- assunto=${input.cabecalho_meta.assunto}
- data=${input.cabecalho_meta.data}

ID do parecer a gerar: ${input.parecer_id}
ID da análise (foreign key): ${input.analise.id}
Tipo de documento: ${input.tipo_documento}
Timestamp ISO de geração: ${new Date().toISOString()}

Produza o parecer formal com 5 seções (I-V) em ordem.`,
          },
        ],
        schema: ParecerSchema,
        tag: "redator.formatar",
        temperatura: 0.3,
      });
      contexto.logger.info("redator.executar concluído", {
        parecer_id: result.object.id,
        tracingId: contexto.tracingId,
      });
      return result.object;
    },
  };
}
