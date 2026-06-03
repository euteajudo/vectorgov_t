/**
 * Especialista em Licitações — papel 4/8.
 *
 * Responsabilidade:
 *  - Enquadrar o caso na Lei 14.133/2021 (nova lei de licitações).
 *  - Indicar jurisprudência TCU aplicável — FUNDAMENTADA na base real (tool
 *    `buscar_acordaos_tcu`), NUNCA inventada da memória.
 *  - Sinalizar pontos de atenção operacional do gestor público.
 *
 * Grounding da jurisprudência (padrão determinístico, igual ao Pesquisador):
 *  1. Código busca acórdãos reais para a pergunta focal (`buscar_acordaos_tcu`).
 *  2. Injeta a lista de acórdãos disponíveis no prompt.
 *  3. O LLM escolhe entre eles; o código PÓS-FILTRA a saída mantendo só os que
 *     casam com um acórdão recuperado (normalizando para o label canônico).
 *  Resultado: zero acórdão alucinado por construção.
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

const TOOL_ACORDAOS = "buscar_acordaos_tcu";
const TOP_K_ACORDAOS = 6;

const SYSTEM_BASE = `Você é o ESPECIALISTA EM LICITAÇÕES (Lei 14.133/2021).
Sua função é enquadrar o caso na nova lei e apontar jurisprudência TCU.

Regras DURAS:
1. Cite apenas dispositivos da Lei 14.133/2021 ou súmulas/acórdãos TCU.
2. enquadramento_lei_14133 deve dizer EXATAMENTE qual artigo/capítulo se aplica.
3. jurisprudencia_tcu_aplicavel: use SOMENTE acórdãos da lista "JURISPRUDÊNCIA
   DISPONÍVEL" fornecida no prompt — cite pelo LABEL EXATO. NUNCA invente número
   de acórdão. Se a lista vier vazia ou nenhum for pertinente, deixe a lista vazia.
4. pontos_de_atencao: riscos práticos de execução (prazo, contraditório, dolo/culpa).`;

/** Acórdão real recuperado da base (candidato à citação). */
interface AcordaoDisponivel {
  label: string;
  /** Chave canônica `numero/ano` (sem separador de milhar) para casamento. */
  chave: string;
}

/** Subset do retorno de `buscar_acordaos_tcu` que consumimos. */
interface AcordaoHit {
  citacao?: { label?: string; numero?: string; ano?: number };
  texto?: string;
}

/** Normaliza `numero/ano` removendo separador de milhar (`1.148`→`1148`). */
function chaveNumAno(numero: string, ano: number): string {
  return `${numero.replace(/\./g, "")}/${ano}`;
}

/** Extrai `numero/ano` de um texto livre de citação ("Acórdão 1.148/2022-..."). */
function extrairChave(s: string): string | null {
  const m = /(\d[\d.]*)\s*\/\s*(\d{4})/.exec(s);
  if (!m) return null;
  return `${m[1].replace(/\./g, "")}/${m[2]}`;
}

/**
 * Busca acórdãos reais para a pergunta focal e monta o bloco de grounding.
 * Best-effort: se a tool faltar ou falhar, devolve vazio (o caller mantém o
 * comportamento legado — sem grounding — em vez de derrubar a análise).
 */
async function buscarJurisprudenciaDisponivel(
  contexto: AgentContext,
  perguntaFocal: string,
): Promise<{ bloco: string; disponiveis: AcordaoDisponivel[] }> {
  const tool = contexto.tools.find((t) => t.nome === TOOL_ACORDAOS);
  if (!tool) {
    contexto.logger.warn("esp_licitacoes.acordaos_tool_indisponivel", {
      tracingId: contexto.tracingId,
    });
    return { bloco: "", disponiveis: [] };
  }

  let resultados: AcordaoHit[] = [];
  try {
    const resp = (await tool.executar({
      query: perguntaFocal,
      top_k: TOP_K_ACORDAOS,
    })) as { resultados?: AcordaoHit[] } | undefined;
    resultados = resp?.resultados ?? [];
  } catch (e) {
    contexto.logger.warn("esp_licitacoes.busca_acordaos_falhou", {
      erro: e instanceof Error ? e.message : String(e),
      tracingId: contexto.tracingId,
    });
    return { bloco: "", disponiveis: [] };
  }

  const disponiveis: AcordaoDisponivel[] = [];
  const linhas: string[] = [];
  for (const r of resultados) {
    const c = r.citacao;
    if (!c?.label || !c.numero || typeof c.ano !== "number") continue;
    const chave = chaveNumAno(c.numero, c.ano);
    // Dedup por acórdão (vários chunks do mesmo acórdão retornam juntos).
    if (disponiveis.some((d) => d.chave === chave)) continue;
    disponiveis.push({ label: c.label, chave });
    linhas.push(`- ${c.label}: ${(r.texto ?? "").slice(0, 180).trim()}`);
  }
  if (disponiveis.length === 0) return { bloco: "", disponiveis: [] };

  const bloco =
    "\n\nJURISPRUDÊNCIA DISPONÍVEL (use SOMENTE estes acórdãos em " +
    "jurisprudencia_tcu_aplicavel; cite pelo label exato; se nenhum for " +
    `pertinente, deixe vazio):\n${linhas.join("\n")}`;
  return { bloco, disponiveis };
}

/**
 * Pós-filtra a jurisprudência produzida pelo LLM: mantém só os itens que casam
 * com um acórdão REAL recuperado e normaliza para o label canônico. Garante que
 * nenhum acórdão inventado sobreviva.
 */
function filtrarJurisprudenciaReal(
  saidaLLM: string[],
  disponiveis: AcordaoDisponivel[],
  contexto: AgentContext,
): string[] {
  const porChave = new Map(disponiveis.map((d) => [d.chave, d.label]));
  const out: string[] = [];
  const vistos = new Set<string>();
  let descartados = 0;
  for (const s of saidaLLM) {
    const chave = extrairChave(s);
    const label = chave ? porChave.get(chave) : undefined;
    if (label) {
      if (!vistos.has(label)) {
        out.push(label);
        vistos.add(label);
      }
    } else {
      descartados += 1;
    }
  }
  if (descartados > 0) {
    contexto.logger.warn("esp_licitacoes.jurisprudencia_descartada", {
      descartados,
      tracingId: contexto.tracingId,
    });
  }
  return out;
}

export function criarEspLicitacoes(): AgentRole<
  EspLicitacoesInput,
  ParecerLicitacao
> {
  return {
    nome: "esp_licitacoes",
    papel: "Lei 14.133 + jurisprudência TCU",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: [TOOL_ACORDAOS],
    modelo: "gemini-3.5-flash",
    schemaOutput: ParecerLicitacaoSchema,
    async executar(
      input: EspLicitacoesInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<ParecerLicitacao> {
      const system = montarSystemPrompt(SYSTEM_BASE, skills);

      // Grounding: acórdãos REAIS para a pergunta focal (antes do LLM).
      const { bloco, disponiveis } = await buscarJurisprudenciaDisponivel(
        contexto,
        input.pergunta_focal,
      );

      const result = await contexto.llm.generateObject({
        modelo: contexto.modelos?.pevs_esp_licitacoes ?? "gemini-3.5-flash",
        system,
        messages: [
          {
            role: "user",
            content: `Pergunta focal: ${input.pergunta_focal}\n\nAchados do Pesquisador:\n${input.resultado_pesquisa.achados
              .slice(0, 10)
              .map((a, i) => `${i + 1}. [${a.fonte}] ${a.trecho.slice(0, 200)}`)
              .join("\n")}${bloco}`,
          },
        ],
        schema: ParecerLicitacaoSchema,
        tag: "esp_licitacoes.enquadrar",
        temperatura: 0.2,
      });

      // Pós-filtro só quando houve grounding (acórdãos disponíveis). Sem tool /
      // sem retorno, mantém a saída do LLM (comportamento legado) e já avisou.
      const jurisprudencia =
        disponiveis.length > 0
          ? filtrarJurisprudenciaReal(
              result.object.jurisprudencia_tcu_aplicavel,
              disponiveis,
              contexto,
            )
          : result.object.jurisprudencia_tcu_aplicavel;

      const parecer: ParecerLicitacao = {
        ...result.object,
        jurisprudencia_tcu_aplicavel: jurisprudencia,
      };

      contexto.logger.info("esp_licitacoes.executar concluído", {
        jurisprudencia: parecer.jurisprudencia_tcu_aplicavel.length,
        jurisprudencia_disponivel: disponiveis.length,
        pontos_atencao: parecer.pontos_de_atencao.length,
        tracingId: contexto.tracingId,
      });
      return parecer;
    },
  };
}
