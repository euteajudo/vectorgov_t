/**
 * Pesquisador — papel 2/8.
 *
 * Responsabilidade:
 *  - Buscar trechos relevantes via tools MCP (busca semântica + filesystem).
 *  - Produzir lista de citações CANDIDATAS (status PENDENTE) que o
 *    Auditor depois verifica.
 *
 * O Pesquisador NÃO interpreta — só coleta. A interpretação é tarefa
 * do Analista Jurídico e do Especialista em Licitações.
 *
 * Tools que pode usar (catálogo do Track D — aqui só declarado):
 *  - busca_semantica
 *  - busca_fts
 *  - busca_hibrida
 *  - fs_listar_dispositivos
 *  - fs_ler_dispositivo
 *  - fs_grep
 *  - jurisprudencia_buscar
 *  - skills_listar
 *  - skills_ler
 */
import type { AgentRole, AgentContext, SkillFull } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import {
  ResultadoPesquisaSchema,
  type ResultadoPesquisa,
} from "./_io-schemas.js";

export interface PesquisadorInput {
  pergunta_focal: string;
  contexto_peticao: string;
}

const TOOLS_PERMITIDAS = [
  "busca_semantica",
  "busca_fts",
  "busca_hibrida",
  "fs_listar_dispositivos",
  "fs_ler_dispositivo",
  "fs_grep",
  "jurisprudencia_buscar",
  "skills_listar",
  "skills_ler",
];

const SYSTEM_BASE = `Você é o PESQUISADOR de um sistema jurídico multi-agente.
Sua única função é COLETAR trechos relevantes da base normativa.

Regras DURAS:
1. NUNCA interprete — apenas devolva trechos brutos com a fonte exata.
2. Toda citação candidata vai com status="PENDENTE" — o Auditor verifica depois.
3. Para cada citação, preencha texto_literal com a transcrição literal do
   dispositivo (NÃO resumo, NÃO paráfrase).
4. Calcule um hash placeholder de 64 chars 'a' caso não tenha hash real;
   o Auditor recalcula no momento da verificação.
5. Use apenas as tools listadas; não invente normas.`;

export function criarPesquisador(): AgentRole<
  PesquisadorInput,
  ResultadoPesquisa
> {
  return {
    nome: "pesquisador",
    papel: "Coleta trechos via tools MCP (busca + filesystem)",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: TOOLS_PERMITIDAS,
    modelo: "gemini-3.5-flash",
    schemaOutput: ResultadoPesquisaSchema,
    async executar(
      input: PesquisadorInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<ResultadoPesquisa> {
      const toolsDisponiveis = contexto.tools.filter((t) =>
        TOOLS_PERMITIDAS.includes(t.nome),
      );
      const system = montarSystemPrompt(
        `${SYSTEM_BASE}\n\nTools MCP disponíveis nesta execução: ${
          toolsDisponiveis.map((t) => t.nome).join(", ") || "(nenhuma)"
        }`,
        skills,
      );
      const result = await contexto.llm.generateObject({
        modelo: "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Pergunta focal: ${input.pergunta_focal}\n\nContexto da petição:\n${input.contexto_peticao}\n\nColete citações relevantes (status="PENDENTE").`,
          },
        ],
        schema: ResultadoPesquisaSchema,
        tag: "pesquisador.coleta",
        temperatura: 0.1,
      });
      contexto.logger.info("pesquisador.executar concluído", {
        achados: result.object.achados.length,
        citacoes_candidatas: result.object.citacoes_candidatas.length,
        tracingId: contexto.tracingId,
      });
      return result.object;
    },
  };
}
