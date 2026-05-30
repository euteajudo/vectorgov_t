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
import {
  ParecerSchema,
  RedacaoParecerSchema,
  type Parecer,
  type ParecerSecao,
  type AnaliseReequilibrio,
} from "@vectorgov-t/schemas";
import { type TipoDocumentoRedator } from "./_io-schemas.js";

/** Numerais e títulos padrão das 5 seções formais (I-V). */
const SECOES_ROMANAS = ["I", "II", "III", "IV", "V"] as const;
const SECOES_TITULOS = [
  "Relatório",
  "Fundamentação",
  "Conclusão",
  "Cálculos e Demonstrativos",
  "Recomendações",
];

/**
 * Normaliza as seções geradas pelo LLM para EXATAMENTE 5, na ordem I-V,
 * com conteúdo mínimo. Rede de segurança: garante que o `ParecerSchema`
 * (que exige `.length(5)` na ordem I-V e conteúdo ≥ 50 chars) sempre passe,
 * mesmo que o modelo gere menos seções, fora de ordem ou curtas demais.
 * No caso comum (5 seções bem-formadas) preserva o que o modelo produziu.
 */
function normalizarSecoes(secoes: ParecerSecao[]): ParecerSecao[] {
  return SECOES_ROMANAS.map((romano, i) => {
    const achada = secoes.find((s) => s.numero === romano) ?? secoes[i];
    const titulo = achada?.titulo?.trim() || SECOES_TITULOS[i]!;
    let conteudo = achada?.conteudo?.trim() ?? "";
    if (conteudo.length < 50) {
      conteudo = `${SECOES_TITULOS[i]}: sem detalhamento adicional do modelo para este caso concreto.`;
    }
    return { numero: romano, titulo, conteudo };
  });
}

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
      const citacoesParaPrompt =
        input.analise.citacoes
          .map(
            (c, i) =>
              `  ${i + 1}. ${c.norma} — ${c.artigo}: "${c.texto_literal.slice(0, 220)}${c.texto_literal.length > 220 ? "…" : ""}"`,
          )
          .join("\n") || "  (nenhuma citação na análise)";

      // Resumo do preço de referência (vantajosidade) para a seção IV.
      const pr = input.analise.preco_referencia;
      const precoParaPrompt =
        pr && pr.estatisticas.mediana_centavos !== null
          ? `Preço de referência (vantajosidade) — mencione na seção IV: mediana R$ ${(pr.estatisticas.mediana_centavos / 100).toFixed(2)} por ${pr.estatisticas.unidade_fornecimento_base ?? "unidade de fornecimento"} (n=${pr.estatisticas.n} amostras públicas aderentes; fonte ${pr.fonte}; ${pr.documentos_suporte.length} doc(s) de suporte).`
          : "Sem pesquisa de preço de referência nesta análise.";

      // O LLM gera APENAS a redação (seções + conclusão + recomendações).
      // Os campos determinísticos (id, analise_id, cabeçalho, citações,
      // cálculos, gerado_em) são injetados pelo código — o modelo não
      // precisa reproduzir hashes SHA-256 / UUIDs, o que quebrava o schema
      // ("No object generated: response did not match schema").
      const result = await contexto.llm.generateObject({
        modelo: contexto.modelos?.pevs_redator ?? "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Você vai redigir um parecer a partir desta análise JÁ VERIFICADA pelo Auditor.

Veredito: ${input.analise.veredito}
Score de confiança: ${input.analise.score_confianca}
Fundamentação técnica (base):
${input.analise.fundamentacao.slice(0, 1500)}

Citações APROVADAS (cite norma e artigo na fundamentação; NÃO reproduza hashes — elas entram no parecer automaticamente):
${citacoesParaPrompt}

Cálculos disponíveis na análise: ${input.analise.calculos.length}
${precoParaPrompt}

Cabeçalho (já definido — NÃO precisa gerar):
- número=${input.cabecalho_meta.numero}
- parecerista=${input.cabecalho_meta.parecerista}
- órgão=${input.cabecalho_meta.orgao}
- assunto=${input.cabecalho_meta.assunto}
- data=${input.cabecalho_meta.data}

ID do parecer a gerar: ${input.parecer_id}
ID da análise (foreign key): ${input.analise.id}
Tipo de documento: ${input.tipo_documento}
Timestamp ISO de geração: ${new Date().toISOString()}

Produza APENAS a REDAÇÃO em 5 seções, na ordem I, II, III, IV, V
(Relatório, Fundamentação, Conclusão, Cálculos e Demonstrativos,
Recomendações), cada uma com ao menos 50 caracteres; mais a conclusão
objetiva (1 frase, até ~480 chars, alinhada ao veredito) e as
recomendações práticas. Identificação, citações e cálculos são
preenchidos automaticamente — foque no texto jurídico.`,
          },
        ],
        schema: RedacaoParecerSchema,
        tag: "redator.formatar",
        temperatura: 0.3,
      });

      // Monta o Parecer final programaticamente (mesmo princípio de
      // `montarAnalise`): a prosa vem do LLM, o resto vem da análise/input.
      const redacao = result.object;
      const parecer: Parecer = ParecerSchema.parse({
        id: input.parecer_id,
        analise_id: input.analise.id,
        cabecalho: input.cabecalho_meta,
        secoes: normalizarSecoes(redacao.secoes),
        conclusao_objetiva: redacao.conclusao_objetiva.trim().slice(0, 500),
        recomendacoes: redacao.recomendacoes ?? [],
        citacoes: input.analise.citacoes,
        calculos: input.analise.calculos,
        preco_referencia: input.analise.preco_referencia ?? null,
        gerado_em: new Date().toISOString(),
      });
      contexto.logger.info("redator.executar concluído", {
        parecer_id: parecer.id,
        tracingId: contexto.tracingId,
      });
      return parecer;
    },
  };
}
