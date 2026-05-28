/**
 * Calculista — papel 6/8.
 *
 * Responsabilidade:
 *  - Calcular o diferencial de carga tributária (pré × pós Reforma) via
 *    tool MCP `calcular_reequilibrio_tributario` (engine determinística).
 *
 * Fluxo:
 *  1. LLM extrai da petição os inputs estruturados (regime tributário pré,
 *     alíquotas, classificação compra governamental, alíquotas de referência
 *     conhecidas) → produz `InputsCalculoReequilibrioLLM`.
 *  2. Código invoca a tool com esses inputs.
 *  3. Output da tool (carga pré, carga pós por ano, diferencial, memória,
 *     base legal) é mapeado para `CalculoTributarioSchema` — o schema
 *     interno do PEVS.
 *
 * Fallback: se a tool não estiver disponível em `contexto.tools`
 * (cenário de teste em isolamento), o agente devolve um placeholder
 * válido contra `CalculoTributarioSchema`.
 *
 * O Calculista é o único papel que combina LLM + lógica determinística:
 * o LLM monta a estrutura do pedido; o código executa a aritmética.
 */
import type { AgentRole, AgentContext, SkillFull, ToolMCP } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import {
  ResultadoCalculistaSchema,
  type ResultadoCalculista,
  InputsCalculoReequilibrioLLMSchema,
  type InputsCalculoReequilibrioLLM,
} from "./_io-schemas.js";
import type {
  Peticao,
  CalcularReequilibrioOutputT,
  CalculoTributario,
} from "@vectorgov-t/schemas";

const TOOL_NAME = "calcular_reequilibrio_tributario";

export interface CalculistaInput {
  peticao: Peticao;
  contexto_pedido: string;
}

const SYSTEM_BASE = `Você é o CALCULISTA do sistema multi-agente.
Sua única função neste passo é EXTRAIR de uma petição de reequilíbrio os
inputs estruturados que alimentam a engine determinística de cálculo
(tool 'calcular_reequilibrio_tributario').

Regras DURAS:
1. NÃO calcule nada — apenas decida os inputs. A aritmética é da engine.
2. Inferências obrigatórias a partir da petição:
   - regime_tributario_pre: a partir do CNPJ / razão social, infira o
     regime mais provável (default: 'lucro_real' para empresas médias/grandes).
   - aliquotas_pre: use valores-padrão do regime se não houver dado específico
     (PIS 1,65%, Cofins 7,6% para lucro real; ICMS depende da UF/produto;
     ISS depende do município/serviço).
   - is_compra_governamental: true se contratante.ente_federativo for
     'uniao', 'estado', 'municipio', 'df', 'autarquia' ou 'empresa_publica'.
   - ente_contratante: derive de contratante.ente_federativo
     ('empresa_publica' → 'autarquia'; 'privada' → 'nao_se_aplica').
3. vigencia_fim: a Petição só traz data_inicio_vigencia. Estime com base
   em prática contratual (default conservador: último dia do 5º ano após
   o início, OU mesmo ano se objeto sugere contrato de execução imediata).
4. aliquotas_referencia_publicadas: use null em ambos os campos quando
   você não tiver fonte confirmada do Senado/TCU. NÃO INVENTE valores.
5. redutor_compras_govern_pct: idem — null quando desconhecido.
6. creditos_estimados_pct: 0 quando não houver indício; até 100 se a
   petição menciona insumos significativos com direito a crédito.
7. justificativa: explique em 1-3 frases como você chegou nesses números.`;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Mapeia o output da tool fiscal para o `CalculoTributarioSchema` do PEVS.
 *
 * `valor_final` fica em centavos (consistente com o resto do projeto).
 * Em cenários onde a Reforma reduz a carga, o valor é NEGATIVO — indica
 * reequilíbrio em favor da Administração.
 */
function mapearOutputParaCalculo(
  output: CalcularReequilibrioOutputT,
  contratoNumero: string,
): CalculoTributario {
  const id = `reequilibrio-tributario-${contratoNumero}`;
  if (!output.sucesso) {
    return {
      id,
      tipo: "reequilibrio_economico",
      descricao:
        "Cálculo de reequilíbrio tributário (engine pós-Reforma) falhou",
      inputs: {},
      memoria: [
        {
          descricao: "Falha na execução da engine determinística",
          valor: null,
          unidade: null,
          formula: null,
        },
      ],
      valor_final: null,
      unidade_final: "centavos",
      sucesso: false,
      erro: output.erro ?? "Erro desconhecido na tool fiscal",
      placeholder: false,
    };
  }

  const linhas: CalculoTributario["memoria"] = output.memoria_calculo.map(
    (p) => ({
      descricao: p.descricao,
      valor: Number.isFinite(p.resultado) ? p.resultado : null,
      unidade: p.unidade,
      formula: p.formula,
    }),
  );

  // Anexa base legal como linhas descritivas no final da memória
  // (Auditor compara texto da memória contra fontes).
  for (const b of output.base_legal) {
    linhas.push({
      descricao: `Base legal: ${b.norma} — ${b.artigo}. ${b.resumo}`,
      valor: null,
      unidade: null,
      formula: null,
    });
  }
  for (const alerta of output.alertas) {
    linhas.push({
      descricao: `Alerta: ${alerta}`,
      valor: null,
      unidade: null,
      formula: null,
    });
  }

  return {
    id,
    tipo: "reequilibrio_economico",
    descricao: `Reequilíbrio tributário pós-Reforma (LC 214/2025): diferencial médio de ${output.diferencial.pct_medio_ponderado} p.p. sobre ${output.diferencial.meses_remanescentes} meses remanescentes`,
    inputs: {
      diferencial_pct: output.diferencial.pct_medio_ponderado,
      valor_anual_centavos: output.diferencial.valor_anual_centavos,
      meses_remanescentes: output.diferencial.meses_remanescentes,
      carga_pre_pct: output.carga_pre.pct_total,
    },
    memoria: linhas,
    valor_final: output.diferencial.valor_remanescente_contrato_centavos,
    unidade_final: "centavos",
    sucesso: true,
    erro: null,
    placeholder: false,
  };
}

/**
 * Constrói o input da tool a partir do que o LLM extraiu + dos campos
 * vindos diretamente da petição (valor, datas, número do contrato).
 */
function montarInputDaTool(
  inputsLLM: InputsCalculoReequilibrioLLM,
  peticao: Peticao,
): Record<string, unknown> {
  return {
    contrato: {
      numero: peticao.contrato.numero,
      valor_centavos: peticao.contrato.valor_centavos,
      data_assinatura: peticao.contrato.data_assinatura,
      vigencia_inicio: peticao.contrato.data_inicio_vigencia,
      vigencia_fim: inputsLLM.vigencia_fim,
      regime_tributario_pre: inputsLLM.regime_tributario_pre,
      is_compra_governamental: inputsLLM.is_compra_governamental,
      ente_contratante: inputsLLM.ente_contratante,
    },
    aliquotas_pre: inputsLLM.aliquotas_pre,
    parametros_calculo: {
      aliquotas_referencia_publicadas:
        inputsLLM.aliquotas_referencia_publicadas,
      redutor_compras_govern_pct: inputsLLM.redutor_compras_govern_pct,
      creditos_estimados_pct: clamp(inputsLLM.creditos_estimados_pct, 0, 100),
    },
  };
}

/**
 * Fallback quando a tool não está disponível no contexto.
 * Devolve um placeholder válido contra o schema, marcado como tal.
 */
function placeholderSemTool(contratoNumero: string): CalculoTributario {
  return {
    id: `reequilibrio-tributario-${contratoNumero}`,
    tipo: "reequilibrio_economico",
    descricao:
      "Cálculo não executado: tool 'calcular_reequilibrio_tributario' não disponível neste contexto",
    inputs: {},
    memoria: [
      {
        descricao:
          "Engine determinística pós-Reforma não foi injetada em contexto.tools",
        valor: null,
        unidade: null,
        formula: null,
      },
    ],
    valor_final: null,
    unidade_final: "centavos",
    sucesso: false,
    erro: "TOOL_NAO_DISPONIVEL",
    placeholder: true,
  };
}

export function criarCalculista(): AgentRole<
  CalculistaInput,
  ResultadoCalculista
> {
  return {
    nome: "calculista",
    papel: "Cálculos determinísticos (engine reequilíbrio pós-Reforma)",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: [TOOL_NAME],
    modelo: "gemini-3.5-flash",
    schemaOutput: ResultadoCalculistaSchema,
    async executar(
      input: CalculistaInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<ResultadoCalculista> {
      const tool: ToolMCP | undefined = contexto.tools.find(
        (t) => t.nome === TOOL_NAME,
      );

      // Fallback: sem tool, devolve placeholder controlado.
      if (!tool) {
        contexto.logger.warn("calculista.tool_indisponivel", {
          tool: TOOL_NAME,
          tracingId: contexto.tracingId,
        });
        return {
          calculos: [placeholderSemTool(input.peticao.contrato.numero)],
        };
      }

      // Passo 1: LLM extrai inputs estruturados da petição.
      const system = montarSystemPrompt(SYSTEM_BASE, skills);
      const enteContratante =
        input.peticao.contratante.ente_federativo ?? "privada";
      let inputsLLM: InputsCalculoReequilibrioLLM;
      try {
        const result = await contexto.llm.generateObject({
          modelo: contexto.modelos?.pevs_calculista ?? "gemini-3.5-flash",
          system,
          messages: [
            {
              role: "user",
              content: `PETIÇÃO

Contrato:
- Número: ${input.peticao.contrato.numero}
- Modalidade: ${input.peticao.contrato.modalidade}
- Valor: R$ ${(input.peticao.contrato.valor_centavos / 100).toFixed(2)}
- Data assinatura: ${input.peticao.contrato.data_assinatura}
- Início vigência: ${input.peticao.contrato.data_inicio_vigencia}
- Objeto: ${input.peticao.contrato.objeto}

Contratante: ${input.peticao.contratante.razao_social} (ente=${enteContratante})
Contratado: ${input.peticao.contratado.razao_social}

Fato alegado:
${input.peticao.fato_alegado}

Cálculos apresentados pelo requerente:
${
  input.peticao.calculos_apresentados.length === 0
    ? "(nenhum)"
    : input.peticao.calculos_apresentados
        .map(
          (c) =>
            `- ${c.descricao} → pretendido R$ ${(c.valor_pretendido_centavos / 100).toFixed(2)} (${c.metodologia})`,
        )
        .join("\n")
}

PEDIDO: ${input.contexto_pedido}

Extraia os inputs estruturados para a engine de cálculo.`,
            },
          ],
          schema: InputsCalculoReequilibrioLLMSchema,
          tag: "calculista.extrair_inputs",
          temperatura: 0.0,
        });
        inputsLLM = result.object;
      } catch (e) {
        const erro = e instanceof Error ? e.message : String(e);
        contexto.logger.error("calculista.llm_falhou", {
          erro,
          tracingId: contexto.tracingId,
        });
        return {
          calculos: [
            {
              id: `reequilibrio-tributario-${input.peticao.contrato.numero}`,
              tipo: "reequilibrio_economico",
              descricao: "LLM falhou ao extrair inputs da petição",
              inputs: {},
              memoria: [
                {
                  descricao: `Erro na extração de inputs: ${erro}`,
                  valor: null,
                  unidade: null,
                  formula: null,
                },
              ],
              valor_final: null,
              unidade_final: "centavos",
              sucesso: false,
              erro,
              placeholder: false,
            },
          ],
        };
      }

      // Passo 2: invoca a tool determinística.
      const toolInput = montarInputDaTool(inputsLLM, input.peticao);
      let toolOutput: CalcularReequilibrioOutputT;
      try {
        toolOutput = (await tool.executar(
          toolInput,
        )) as CalcularReequilibrioOutputT;
      } catch (e) {
        const erro = e instanceof Error ? e.message : String(e);
        contexto.logger.error("calculista.tool_falhou", {
          erro,
          tracingId: contexto.tracingId,
        });
        return {
          calculos: [
            {
              id: `reequilibrio-tributario-${input.peticao.contrato.numero}`,
              tipo: "reequilibrio_economico",
              descricao: "Tool fiscal lançou exceção",
              inputs: {},
              memoria: [
                {
                  descricao: `Inputs montados pelo LLM: ${inputsLLM.justificativa}`,
                  valor: null,
                  unidade: null,
                  formula: null,
                },
                {
                  descricao: `Exceção da tool: ${erro}`,
                  valor: null,
                  unidade: null,
                  formula: null,
                },
              ],
              valor_final: null,
              unidade_final: "centavos",
              sucesso: false,
              erro,
              placeholder: false,
            },
          ],
        };
      }

      // Passo 3: mapeia output → CalculoTributario.
      const calculo = mapearOutputParaCalculo(
        toolOutput,
        input.peticao.contrato.numero,
      );

      // Prepende a justificativa do LLM como primeira linha de memória,
      // para o Auditor entender que inputs foram inferidos.
      calculo.memoria.unshift({
        descricao: `Inputs inferidos pelo LLM: ${inputsLLM.justificativa}`,
        valor: null,
        unidade: null,
        formula: null,
      });

      contexto.logger.info("calculista.executar concluído", {
        sucesso: calculo.sucesso,
        valor_final_centavos: calculo.valor_final,
        anos_calculados: toolOutput.carga_pos_por_ano.length,
        alertas: toolOutput.alertas.length,
        tracingId: contexto.tracingId,
      });
      return { calculos: [calculo] };
    },
  };
}
