/**
 * Pesquisador — papel 2/8.
 *
 * Responsabilidade:
 *  - RECUPERAR trechos relevantes da base normativa via tools MCP reais
 *    (busca semântica + lookup direto), NÃO inventar.
 *  - Produzir citações CANDIDATAS (status PENDENTE) cujo `texto_literal`,
 *    `norma_id` e `dispositivo` vêm DIRETO dos snippets das tools — o
 *    Auditor depois verifica contra o filesystem.
 *
 * Fluxo (o LLM nunca calcula nem inventa texto):
 *  1. LLM transforma a pergunta focal em um plano de busca (queries).
 *  2. Código invoca `buscar_legislacao` (e `consultar_artigo` para alvos
 *     diretos) e coleta snippets REAIS.
 *  3. LLM apenas SELECIONA quais snippets são pertinentes (por índice).
 *  4. Código monta achados + citações candidatas a partir dos snippets
 *     selecionados — texto e proveniência vêm da fonte, não do LLM.
 *
 * Como `llm.generateObject` não faz function-calling, o código orquestra
 * as chamadas de tool (mesmo padrão do Calculista).
 */
import type { AgentRole, AgentContext, SkillFull, ToolMCP } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import {
  ResultadoPesquisaSchema,
  type ResultadoPesquisa,
  PlanoBuscaPesquisadorSchema,
  type PlanoBuscaPesquisador,
  SelecaoCitacoesSchema,
} from "./_io-schemas.js";
import type { Snippet, CitacaoVerificada, TipoFonte } from "@vectorgov-t/schemas";

export interface PesquisadorInput {
  pergunta_focal: string;
  contexto_peticao: string;
  /**
   * Data de competência (YYYY-MM-DD) para resolver a vigência das normas no
   * lookup exato (`consultar_artigo`). Representa o período de execução em
   * análise — a redação da norma de transição muda por competência. Opcional:
   * sem ela, o lookup usa a redação ATUAL.
   */
  competencia?: string;
}

const TOOL_BUSCAR = "buscar_legislacao";
const TOOL_CONSULTAR = "consultar_artigo";
const TOOLS_PERMITIDAS = [
  TOOL_BUSCAR,
  TOOL_CONSULTAR,
  "fs_ler_dispositivo",
  "fs_grep",
  "fs_listar_normas",
];

const HASH_PLACEHOLDER = "a".repeat(64);
const TOP_K_POR_QUERY = 5;

const SYSTEM_PLANEJAR = `Você é o PESQUISADOR de um sistema jurídico multi-agente.
Esta é a etapa de PLANEJAMENTO de busca: transforme a pergunta focal em
1 a 5 queries de busca semântica que recuperem os dispositivos normativos
mais relevantes da base (legislação tributária e de licitações).

Regras:
1. Queries curtas e específicas (termos jurídicos, não frases longas).
2. Se a pergunta já cita norma + artigo explícitos, inclua em normas_alvo.
3. NÃO invente normas — apenas descreva o que buscar.`;

const SYSTEM_SELECIONAR = `Você é o PESQUISADOR de um sistema jurídico multi-agente.
Esta é a etapa de SELEÇÃO: você recebe trechos REAIS recuperados da base e
deve escolher quais são pertinentes à pergunta focal.

Regras DURAS:
1. Devolva apenas os ÍNDICES (0-based) dos trechos pertinentes.
2. NÃO escreva texto de citação — o texto vem dos próprios trechos.
3. Seja seletivo: inclua só o que sustenta a análise, não tudo.`;

/** Deriva o tipo de fonte a partir do prefixo do norma_id. */
function tipoFonteDeNormaId(normaId: string): TipoFonte {
  if (normaId.startsWith("lc-")) return "lei_complementar";
  if (normaId.startsWith("lei-")) return "lei";
  if (normaId.startsWith("decreto-")) return "decreto";
  if (normaId.startsWith("instrucao-normativa-")) return "instrucao_normativa";
  if (normaId.startsWith("constituicao-") || normaId.startsWith("ec-"))
    return "constituicao";
  return "outro";
}

/** Monta o identificador legível do dispositivo (campo `artigo`). */
function artigoLegivel(c: Snippet["citacao"]): string {
  if (c.artigo === null || c.artigo === undefined) return "(sem artigo)";
  let s = `art. ${c.artigo}`;
  if (c.paragrafo !== null && c.paragrafo !== undefined)
    s += `, § ${c.paragrafo}`;
  if (c.inciso) s += `, ${c.inciso}`;
  if (c.alinea) s += `, ${c.alinea}`;
  return s;
}

/**
 * Converte um snippet real em citação candidata PENDENTE, copiando
 * proveniência (norma_id, dispositivo, texto) da fonte. Retorna null
 * quando o snippet não tem artigo (não verificável por fs_ler_dispositivo).
 */
function snippetParaCitacao(
  snippet: Snippet,
  idx: number,
): CitacaoVerificada | null {
  const c = snippet.citacao;
  if (c.artigo === null || c.artigo === undefined) return null;
  return {
    id: `pesq-${idx}`,
    tipo_fonte: tipoFonteDeNormaId(c.norma_id),
    norma: c.norma_label || c.norma_id,
    artigo: artigoLegivel(c),
    norma_id: c.norma_id,
    dispositivo: {
      artigo: c.artigo,
      paragrafo: c.paragrafo ?? undefined,
      inciso: c.inciso ?? undefined,
      alinea: c.alinea ?? undefined,
    },
    texto_literal: snippet.texto,
    hash: HASH_PLACEHOLDER,
    status: "PENDENTE",
  };
}

/** Resultado vazio válido (fallback). */
function resultadoVazio(): ResultadoPesquisa {
  return { achados: [], citacoes_candidatas: [], tools_chamadas: [] };
}

export function criarPesquisador(): AgentRole<
  PesquisadorInput,
  ResultadoPesquisa
> {
  return {
    nome: "pesquisador",
    papel: "Recupera trechos via tools MCP (busca + lookup direto)",
    systemPromptBase: SYSTEM_PLANEJAR,
    toolsPermitidas: TOOLS_PERMITIDAS,
    modelo: "gemini-3.5-flash",
    schemaOutput: ResultadoPesquisaSchema,
    async executar(
      input: PesquisadorInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<ResultadoPesquisa> {
      const toolBuscar = contexto.tools.find((t) => t.nome === TOOL_BUSCAR);
      const toolConsultar = contexto.tools.find(
        (t) => t.nome === TOOL_CONSULTAR,
      );

      if (!toolBuscar && !toolConsultar) {
        contexto.logger.warn("pesquisador.tools_indisponiveis", {
          tracingId: contexto.tracingId,
        });
        return resultadoVazio();
      }

      // ---- Passo 1: LLM planeja a busca --------------------------------------
      let plano: PlanoBuscaPesquisador;
      try {
        const r = await contexto.llm.generateObject({
          modelo: contexto.modelos?.pevs_pesquisador ?? "gemini-3.5-flash",
          system: montarSystemPrompt(SYSTEM_PLANEJAR, skills),
          messages: [
            {
              role: "user",
              content: `Pergunta focal: ${input.pergunta_focal}\n\nContexto da petição:\n${input.contexto_peticao}\n\nProduza o plano de busca.`,
            },
          ],
          schema: PlanoBuscaPesquisadorSchema,
          tag: "pesquisador.planejar_busca",
          temperatura: 0.1,
        });
        plano = r.object;
      } catch (e) {
        contexto.logger.error("pesquisador.planejar_falhou", {
          erro: e instanceof Error ? e.message : String(e),
          tracingId: contexto.tracingId,
        });
        return resultadoVazio();
      }

      // ---- Passo 2: código invoca as tools reais -----------------------------
      const snippets: Snippet[] = [];
      const toolsChamadas = new Set<string>();

      if (toolBuscar) {
        for (const query of plano.queries) {
          try {
            const resp = (await toolBuscar.executar({
              query,
              top_k: TOP_K_POR_QUERY,
            })) as { resultados?: Snippet[] } | undefined;
            toolsChamadas.add(TOOL_BUSCAR);
            for (const s of resp?.resultados ?? []) snippets.push(s);
          } catch (e) {
            contexto.logger.warn("pesquisador.busca_falhou", {
              query,
              erro: e instanceof Error ? e.message : String(e),
              tracingId: contexto.tracingId,
            });
          }
        }
      }

      if (toolConsultar) {
        for (const alvo of plano.normas_alvo) {
          try {
            const resp = (await toolConsultar.executar({
              norma_id: alvo.norma,
              artigo: alvo.artigo,
              // Resolve a redação por competência (período de execução). Sem
              // competência, a tool devolve a redação atual.
              ...(input.competencia
                ? { data_referencia: input.competencia }
                : {}),
            })) as
              | { encontrado?: boolean; citacao?: Snippet["citacao"]; texto?: string }
              | undefined;
            toolsChamadas.add(TOOL_CONSULTAR);
            if (resp?.encontrado && resp.citacao && resp.texto) {
              snippets.push({ citacao: resp.citacao, texto: resp.texto });
            }
          } catch (e) {
            contexto.logger.warn("pesquisador.consulta_falhou", {
              alvo,
              erro: e instanceof Error ? e.message : String(e),
              tracingId: contexto.tracingId,
            });
          }
        }
      }

      // Dedup por norma_id + hierarquia (mesma busca pode repetir dispositivos).
      const vistos = new Set<string>();
      const unicos: Snippet[] = [];
      for (const s of snippets) {
        const chave = `${s.citacao.norma_id}#${s.citacao.hierarquia_path}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        unicos.push(s);
      }

      if (unicos.length === 0) {
        contexto.logger.info("pesquisador.executar concluído", {
          achados: 0,
          citacoes_candidatas: 0,
          tracingId: contexto.tracingId,
        });
        return { achados: [], citacoes_candidatas: [], tools_chamadas: [...toolsChamadas] };
      }

      // ---- Passo 3: LLM seleciona os snippets pertinentes --------------------
      let indicesRelevantes: number[];
      try {
        const listaNumerada = unicos
          .map(
            (s, i) =>
              `[${i}] ${s.citacao.norma_label || s.citacao.norma_id} ${artigoLegivel(s.citacao)} — ${s.texto.slice(0, 200)}`,
          )
          .join("\n");
        const r = await contexto.llm.generateObject({
          modelo: contexto.modelos?.pevs_pesquisador ?? "gemini-3.5-flash",
          system: montarSystemPrompt(SYSTEM_SELECIONAR, skills),
          messages: [
            {
              role: "user",
              content: `Pergunta focal: ${input.pergunta_focal}\n\nTrechos recuperados:\n${listaNumerada}\n\nSelecione os índices pertinentes.`,
            },
          ],
          schema: SelecaoCitacoesSchema,
          tag: "pesquisador.selecionar",
          temperatura: 0.0,
        });
        indicesRelevantes = r.object.indices_relevantes.filter(
          (i) => i >= 0 && i < unicos.length,
        );
      } catch (e) {
        // Falha na seleção → usa todos (degradação graciosa; Auditor filtra).
        contexto.logger.warn("pesquisador.selecao_falhou", {
          erro: e instanceof Error ? e.message : String(e),
          tracingId: contexto.tracingId,
        });
        indicesRelevantes = unicos.map((_, i) => i);
      }

      // ---- Passo 4: monta achados + citações a partir dos snippets reais -----
      const achados = unicos.map((s) => ({
        fonte: `${s.citacao.norma_label || s.citacao.norma_id} ${artigoLegivel(s.citacao)}`,
        trecho: s.texto,
        relevancia: typeof s.score === "number" ? Math.max(0, Math.min(1, s.score)) : 0.5,
      }));

      const citacoes: CitacaoVerificada[] = [];
      for (const i of indicesRelevantes) {
        const cit = snippetParaCitacao(unicos[i]!, i);
        if (cit) citacoes.push(cit);
      }

      contexto.logger.info("pesquisador.executar concluído", {
        achados: achados.length,
        citacoes_candidatas: citacoes.length,
        tools_chamadas: [...toolsChamadas],
        tracingId: contexto.tracingId,
      });

      return {
        achados,
        citacoes_candidatas: citacoes,
        tools_chamadas: [...toolsChamadas],
      };
    },
  };
}
