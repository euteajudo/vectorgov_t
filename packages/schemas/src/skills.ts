/**
 * Schemas Zod para o subsistema de Skills.
 *
 * O subsistema de skills permite que agentes carreguem instruções dinâmicas
 * (markdown + YAML front-matter) armazenadas em R2 sem precisar de novo
 * deploy do Worker. A meta-skill (`_meta.md` / `_meta.json`) é um índice
 * leve sempre disponível para o orquestrador, enquanto skills específicas
 * são carregadas sob demanda (lazy) com cache KV de TTL curto.
 *
 * Categorias canônicas (`SkillCategoria`) refletem as duas features do MVP:
 *   - `analise-peticao`     — extração e análise de petições.
 *   - `geracao-parecer`     — redação e verificação de pareceres.
 *   - `calculo-tributario`  — cálculos de IBS/CBS/transição.
 *   - `pesquisa-legislacao` — apoio à busca semântica/léxica.
 *   - `utilidades`          — skills transversais (formatação, etc.).
 *
 * Status (`SkillStatus`):
 *   - `active`    — em produção, indexada no `_meta`.
 *   - `candidate` — em A/B test, não indexada.
 *   - `archived`  — fora de uso, mantida para histórico.
 */

import { z } from "zod";
import { EstadoConversaSchema } from "./notebook.js";

/**
 * Fase do FSM conversacional em que uma skill é relevante.
 *
 * Reusa `EstadoConversaSchema` (definido em `notebook.ts`) — os estados do
 * trilho determinístico são a ÚNICA fonte de verdade. Assim, skill ↔ fase
 * fica sempre alinhada com `agents/conversational/fsm.ts`.
 */
export const SkillFase = EstadoConversaSchema;
export type SkillFase = z.infer<typeof SkillFase>;

/**
 * Categorias canônicas de skills. Alinhar com as features ativas do produto.
 */
export const SkillCategoria = z.enum([
  "analise-peticao",
  "geracao-parecer",
  "calculo-tributario",
  "pesquisa-legislacao",
  "utilidades",
]);
export type SkillCategoria = z.infer<typeof SkillCategoria>;

/**
 * Status de publicação. Skills em `candidate` não entram no `_meta`.
 */
export const SkillStatus = z.enum(["active", "candidate", "archived"]);
export type SkillStatus = z.infer<typeof SkillStatus>;

/**
 * Identificadores curtos dos agentes que podem consumir cada skill.
 * Mantemos lista fechada para detectar erros de digitação no front-matter.
 */
export const AgenteIdentificador = z.enum([
  "orquestrador",
  "pesquisador",
  "analista-juridico",
  "especialista-licitacoes",
  "especialista-reequilibrio",
  "calculista",
  "auditor",
  "redator",
]);
export type AgenteIdentificador = z.infer<typeof AgenteIdentificador>;

/**
 * Modelos LLM suportados. Lista pode crescer; manter sincronizada com o
 * Vercel AI SDK config no Worker.
 */
export const ModeloRecomendado = z.enum([
  "gemini-3.5-flash",
  "gemini-3-pro",
  "auto",
]);
export type ModeloRecomendado = z.infer<typeof ModeloRecomendado>;

/**
 * Configuração de quando a skill deve ser sugerida pela meta-skill.
 *
 *  - `palavras_chave` — termos que, presentes na tarefa, sinalizam relevância.
 *  - `contextos`      — frases curtas que descrevem situações típicas.
 */
export const SkillTrigger = z.object({
  palavras_chave: z.array(z.string().min(1)).min(1).max(30),
  contextos: z.array(z.string().min(1)).min(1).max(15),
});
export type SkillTrigger = z.infer<typeof SkillTrigger>;

/**
 * Metadados extraídos do YAML front-matter de cada `*.md`.
 *
 * Versão segue SemVer (`MAJOR.MINOR.PATCH`). `data_atualizacao` em ISO 8601.
 * `tokens_aproximados` permite previsão de custo antes de carregar a skill.
 */
export const SkillMetadata = z.object({
  nome: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "nome deve ser kebab-case (a-z, 0-9, -)"),
  descricao: z.string().min(20).max(400),
  trigger: SkillTrigger,
  agentes_aplicaveis: z.array(AgenteIdentificador).min(1),
  /**
   * Fases do FSM conversacional em que a skill é oferecida ao condutor
   * (Gemini). Liga a skill ao trilho determinístico — o engine injeta as
   * skills da fase no bloco [ESTADO DA CONVERSA] (push) e o `skill_listar`
   * filtra por ela (pull).
   *
   * Semântica do VAZIO: lista vazia = skill GLOBAL — oferecida em TODAS as
   * fases do funil e sempre visível no pull. Assim, criar uma skill sem
   * declarar fase nunca produz algo "órfão"; declarar fases é um refinamento
   * para reduzir ruído. A função primária da skill vem de `agentes_aplicaveis`.
   */
  fases_aplicaveis: z.array(SkillFase).default([]),
  modelo_recomendado: ModeloRecomendado,
  versao: z.string().regex(/^\d+\.\d+\.\d+$/, "versão deve ser SemVer"),
  data_atualizacao: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser ISO 8601 YYYY-MM-DD"),
  autor: z.string().min(2).max(120),
  tokens_aproximados: z.number().int().positive().max(10_000),
  categoria: SkillCategoria,
  status: SkillStatus.default("active"),
});
export type SkillMetadata = z.infer<typeof SkillMetadata>;

/**
 * Item resumido usado em listagens (`skill_listar`). Não inclui o corpo
 * markdown — apenas o necessário para o orquestrador escolher.
 */
export const SkillListItem = z.object({
  nome: z.string(),
  descricao: z.string(),
  categoria: SkillCategoria,
  versao: z.string(),
  tokens_aproximados: z.number().int().positive(),
  agentes_aplicaveis: z.array(AgenteIdentificador),
  // Fases do FSM em que a skill é relevante — carregado no índice para a
  // injeção por fase (push) e o filtro `fase` do `skill_listar` (pull).
  // Vazio = global (oferecida em todas as fases). Ver SkillMetadata.
  fases_aplicaveis: z.array(SkillFase).default([]),
});
export type SkillListItem = z.infer<typeof SkillListItem>;

/**
 * Skill completa — metadados + corpo markdown bruto.
 *
 * O `corpo_markdown` é o texto após o front-matter (sem os delimitadores
 * `---`). O `r2_key` permite rastreabilidade ao bucket de origem.
 */
export const SkillFull = z.object({
  metadata: SkillMetadata,
  corpo_markdown: z.string().min(1),
  r2_key: z.string().min(1),
});
export type SkillFull = z.infer<typeof SkillFull>;

/**
 * Índice agregado (gerado por `skills-meta-generator`).
 *
 * Versionado para invalidar caches quando o formato evoluir.
 *
 * `por_categoria` usa `z.record(z.string(), ...)` em vez de
 * `z.record(SkillCategoria, ...)` porque Zod v4 trata o record com chave
 * enumerada como "todas as chaves obrigatórias" — não é o que queremos
 * (uma instância pode ter zero skills de `utilidades`, por exemplo).
 * Validamos as chaves manualmente no gerador.
 */
export const MetaIndex = z.object({
  versao_formato: z.literal("1.0.0"),
  gerado_em: z.string(), // ISO 8601 timestamp
  total_skills: z.number().int().nonnegative(),
  skills: z.array(SkillListItem),
  por_categoria: z.record(z.string(), z.array(z.string())),
  /**
   * Skills agrupadas por fase do FSM. Chave = estado (`EstadoConversa`),
   * valor = nomes das skills cuja `fases_aplicaveis` inclui aquela fase.
   * Skills GLOBAIS (fases_aplicaveis vazio) entram em TODAS as chaves.
   * É o que alimenta a injeção por fase (push) no bloco [ESTADO DA CONVERSA].
   */
  por_fase: z.record(z.string(), z.array(z.string())),
});
export type MetaIndex = z.infer<typeof MetaIndex>;

// ---------------------------------------------------------------------------
// I/O das tools MCP
// ---------------------------------------------------------------------------

/**
 * `skill_listar` — sem parâmetros obrigatórios.
 *
 *  - `categoria` (opcional) — filtra a listagem por categoria canônica.
 *  - `agente`    (opcional) — filtra skills aplicáveis a um agente específico.
 */
export const SkillListarInput = z
  .object({
    categoria: SkillCategoria.optional(),
    agente: AgenteIdentificador.optional(),
    // Filtra skills oferecidas numa fase do FSM (inclui as globais). É o
    // "pull" escopado por estado usado pelo condutor conversacional.
    fase: SkillFase.optional(),
  })
  .strict();
export type SkillListarInput = z.infer<typeof SkillListarInput>;

export const SkillListarOutput = z.object({
  total: z.number().int().nonnegative(),
  skills: z.array(SkillListItem),
  fonte: z.enum(["cache", "r2"]),
});
export type SkillListarOutput = z.infer<typeof SkillListarOutput>;

/**
 * `skill_carregar` — recebe nome canônico e devolve corpo completo.
 */
export const SkillCarregarInput = z
  .object({
    nome: z
      .string()
      .min(3)
      .regex(/^[a-z0-9-]+$/, "nome deve ser kebab-case"),
  })
  .strict();
export type SkillCarregarInput = z.infer<typeof SkillCarregarInput>;

export const SkillCarregarOutput = z.object({
  skill: SkillFull,
  fonte: z.enum(["cache", "r2"]),
});
export type SkillCarregarOutput = z.infer<typeof SkillCarregarOutput>;

/**
 * `skill_identificar_relevantes` — recebe descrição da tarefa, retorna
 * recomendação de 1 a 3 skills (escolhida via LLM Flash, baixo custo).
 */
export const SkillIdentificarRelevantesInput = z
  .object({
    descricao_tarefa: z.string().min(20).max(2000),
    agente_solicitante: AgenteIdentificador.optional(),
    max_skills: z.number().int().min(1).max(3).default(3),
  })
  .strict();
export type SkillIdentificarRelevantesInput = z.infer<
  typeof SkillIdentificarRelevantesInput
>;

export const SkillRecomendacao = z.object({
  nome: z.string(),
  motivo: z.string().min(5).max(300),
  score: z.number().min(0).max(1),
});
export type SkillRecomendacao = z.infer<typeof SkillRecomendacao>;

export const SkillIdentificarRelevantesOutput = z.object({
  recomendadas: z.array(SkillRecomendacao).max(3),
  raciocinio: z.string(),
});
export type SkillIdentificarRelevantesOutput = z.infer<
  typeof SkillIdentificarRelevantesOutput
>;

/**
 * `skill_publicar` — grava skill em `active/` (default) ou `candidate/`
 * e dispara regeneração do `_meta`.
 *
 * Espera o conteúdo markdown completo (com front-matter `---`).
 */
export const SkillPublicarInput = z
  .object({
    nome: z
      .string()
      .min(3)
      .regex(/^[a-z0-9-]+$/, "nome deve ser kebab-case"),
    conteudo_markdown: z.string().min(50),
    destino: SkillStatus.exclude(["archived"]).default("active"),
    sobrescrever: z.boolean().default(false),
  })
  .strict();
export type SkillPublicarInput = z.infer<typeof SkillPublicarInput>;

export const SkillPublicarOutput = z.object({
  publicado: z.boolean(),
  r2_key: z.string(),
  metadata: SkillMetadata,
  meta_regenerado: z.boolean(),
});
export type SkillPublicarOutput = z.infer<typeof SkillPublicarOutput>;

/**
 * Chaves canônicas usadas em R2 / KV — centralizar evita drift de strings.
 */
export const SKILL_R2_PREFIX_ACTIVE = "active/";
export const SKILL_R2_PREFIX_CANDIDATE = "candidate/";
export const SKILL_R2_PREFIX_ARCHIVE = "archive/";
export const SKILL_R2_KEY_META_MD = "_meta.md";
export const SKILL_R2_KEY_META_JSON = "_meta.json";

/** TTLs em segundos. Workers KV exige >= 60s. */
export const SKILL_KV_TTL_META = 300; // 5 min — meta muda só em publicação
export const SKILL_KV_TTL_SKILL = 60; // 60s — janela curta p/ A/B test rápido

/** Prefixos das chaves de cache KV. */
export const SKILL_KV_KEY_META = "skill:_meta";
export const SKILL_KV_KEY_SKILL_PREFIX = "skill:active:";
