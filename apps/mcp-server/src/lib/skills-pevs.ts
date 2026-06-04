/**
 * Carrega as skills ATIVAS (R2 `vectorgov-t-skills`) e as indexa por papel do
 * PEVS, para que o motor as injete no system prompt de cada agente
 * (`montarSystemPrompt`). É o que faz "editar uma skill" mudar de verdade a
 * análise e o parecer — não só o condutor do chat.
 *
 * Best-effort: qualquer erro (R2 indisponível, skill malformada) degrada para
 * "sem skills" — o PEVS roda com os prompts-base, como antes.
 */
import type { Env } from "../env.js";
import { invokeTool as invokeSkillTool } from "../mcp/tools/registry.js";
import type { SkillFull } from "../agents/types.js";

/**
 * `role.nome` (papéis do PEVS) → identificador em `agentes_aplicaveis` das
 * skills (enum `AgenteIdentificador`). Os nomes divergem (kebab vs snake,
 * "esp_*" vs "especialista-*"), por isso o mapa é explícito.
 */
const PAPEL_PARA_AGENTE: Record<string, string> = {
  orquestrador: "orquestrador",
  pesquisador: "pesquisador",
  calculista: "calculista",
  analista_juridico: "analista-juridico",
  esp_licitacoes: "especialista-licitacoes",
  esp_reequilibrio: "especialista-reequilibrio",
  auditor: "auditor",
  redator: "redator",
};

interface SkillListItemLite {
  nome: string;
  agentes_aplicaveis?: string[];
}
interface SkillCarregada {
  skill?: { metadata?: { nome?: string; descricao?: string }; corpo_markdown?: string };
}

/**
 * Devolve um mapa `role.nome → SkillFull[]` (formato que os papéis consomem).
 * Cada skill é carregada do R2 no máximo uma vez (cache por nome).
 */
export async function carregarSkillsPorPapel(
  env: Env,
): Promise<Record<string, SkillFull[]>> {
  const out: Record<string, SkillFull[]> = {};

  let lista: SkillListItemLite[];
  try {
    const r = (await invokeSkillTool(env, "skill_listar", {})) as {
      skills?: SkillListItemLite[];
    };
    lista = r.skills ?? [];
  } catch {
    return out; // sem índice → PEVS roda sem skills
  }
  if (lista.length === 0) return out;

  // Cache do corpo por nome — uma skill pode servir a vários papéis.
  const cache = new Map<string, SkillFull | null>();
  async function carregar(nome: string): Promise<SkillFull | null> {
    const existente = cache.get(nome);
    if (existente !== undefined) return existente;
    let sf: SkillFull | null = null;
    try {
      const r = (await invokeSkillTool(env, "skill_carregar", { nome })) as SkillCarregada;
      const m = r.skill?.metadata;
      const corpo = r.skill?.corpo_markdown;
      if (m?.nome && corpo) {
        sf = { id: m.nome, titulo: m.nome, tags: [], conteudo_markdown: corpo };
      }
    } catch {
      sf = null;
    }
    cache.set(nome, sf);
    return sf;
  }

  for (const [papel, agenteId] of Object.entries(PAPEL_PARA_AGENTE)) {
    const nomes = lista
      .filter((s) => (s.agentes_aplicaveis ?? []).includes(agenteId))
      .map((s) => s.nome);
    const skills: SkillFull[] = [];
    for (const nome of nomes) {
      const sf = await carregar(nome);
      if (sf) skills.push(sf);
    }
    if (skills.length > 0) out[papel] = skills;
  }
  return out;
}
