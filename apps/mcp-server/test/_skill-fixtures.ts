/**
 * Fábricas de markdown válido para skills, usadas pelos testes das tools.
 *
 * Gera conteúdo determinístico que satisfaz `SkillMetadata` (Zod).
 * Não substitui as skills reais em `packages/skills/active/` — é só
 * input controlado para asserts unitários.
 */

export interface SkillFixtureOpts {
  nome?: string;
  descricao?: string;
  categoria?: string;
  versao?: string;
  tokens?: number;
  agentes?: string[];
  corpo?: string;
}

const DEFAULTS: Required<SkillFixtureOpts> = {
  nome: "skill-de-teste",
  descricao:
    "Skill sintética para validar o pipeline de publicação e listagem de meta.",
  categoria: "analise-peticao",
  versao: "1.0.0",
  tokens: 800,
  agentes: ["orquestrador", "analista-juridico"],
  corpo:
    "## Quando usar\n\nUse esta skill em testes.\n\n## Critérios\n\n- Item 1\n- Item 2\n",
};

/**
 * Constrói uma string `.md` completa (front-matter + corpo).
 */
export function fixtureSkillMd(opts: SkillFixtureOpts = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const agentes = o.agentes.map((a) => `  - ${a}`).join("\n");
  return [
    "---",
    `nome: ${o.nome}`,
    `descricao: "${o.descricao}"`,
    "trigger:",
    "  palavras_chave: [teste, validacao, fixture]",
    "  contextos:",
    "    - cenário de unit test",
    "    - validacao de pipeline",
    "agentes_aplicaveis:",
    agentes,
    "modelo_recomendado: gemini-3.5-flash",
    `versao: ${o.versao}`,
    "data_atualizacao: 2026-05-26",
    'autor: "QA Bot"',
    `tokens_aproximados: ${o.tokens}`,
    `categoria: ${o.categoria}`,
    "status: active",
    "---",
    "",
    o.corpo,
  ].join("\n");
}
