/**
 * Gerador automático da "meta-skill" — índice agregado das skills ativas.
 *
 * Quando uma skill é publicada (`skill_publicar`), regeneramos dois artefatos
 * derivados que vivem no R2 e são consumidos por todo o sistema:
 *
 *   - `_meta.md`   — tabela markdown legível, ~500 tokens. É o que o
 *                    orquestrador injeta no contexto a cada turno.
 *   - `_meta.json` — formato estruturado (`MetaIndex`), usado pela tool
 *                    `skill_listar` e pela tool `skill_identificar_relevantes`.
 *
 * Estratégia geral:
 *   1. Listar todos os objetos do prefixo `active/` no `R2_SKILLS`.
 *   2. Baixar cada arquivo, fazer parse do YAML front-matter.
 *   3. Validar com `SkillMetadata` (descarta inválidos com warning interno).
 *   4. Agrupar por `categoria` para a tabela markdown.
 *   5. Gravar `_meta.md` + `_meta.json` no R2.
 *   6. Invalidar a chave KV `skill:_meta` para forçar refresh nos próximos hits.
 *
 * Falhas parciais (1 skill inválida) NÃO derrubam a regeneração — apenas
 * removem aquele item do índice. A intenção é manter o sistema operacional
 * mesmo com uma skill com bug de YAML.
 */

import type { Env } from "../env.js";
import {
  MetaIndex,
  SkillCategoria,
  SkillMetadata,
  SkillListItem,
  SKILL_R2_PREFIX_ACTIVE,
  SKILL_R2_KEY_META_MD,
  SKILL_R2_KEY_META_JSON,
  SKILL_KV_KEY_META,
} from "@vectorgov-t/schemas";
import { parseFrontmatter } from "./yaml-frontmatter.js";
import { cacheDelete } from "./cache.js";

/**
 * Lista todas as keys de `active/*.md` no bucket R2.
 *
 * Pagina via cursor — o `list()` do R2 retorna no máx 1000 objetos por
 * página. Para um número plausível de skills (< 200) raramente paginará,
 * mas o loop garante correção mesmo com crescimento.
 */
async function listarKeysAtivas(env: Env): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const opts: R2ListOptions = { prefix: SKILL_R2_PREFIX_ACTIVE, limit: 1000 };
    if (cursor) opts.cursor = cursor;
    const page = await env.R2_SKILLS.list(opts);
    for (const obj of page.objects) {
      // Ignora `_meta.*` que vivem na raiz (não casariam com prefixo de
      // qualquer modo, mas filtramos por sufixo `.md` para segurança).
      if (obj.key.endsWith(".md")) keys.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

/**
 * Lê um objeto do R2 e devolve seu texto, ou `null` se sumir entre o list
 * e o get (race rara mas possível).
 */
async function lerSkillMarkdown(env: Env, key: string): Promise<string | null> {
  const obj = await env.R2_SKILLS.get(key);
  if (!obj) return null;
  return obj.text();
}

/**
 * Resultado da extração de uma skill (sucesso ou falha estruturada).
 */
interface ExtracaoResultado {
  key: string;
  metadata?: SkillMetadata;
  erro?: string;
}

/**
 * Extrai e valida metadata de uma única skill.
 *
 * Devolve um wrapper para que o caller possa decidir como tratar erros
 * (no nosso caso: pular o item, mas logar internamente).
 */
async function extrairMetadata(
  env: Env,
  key: string,
): Promise<ExtracaoResultado> {
  try {
    const texto = await lerSkillMarkdown(env, key);
    if (!texto) return { key, erro: "objeto desapareceu entre list e get" };
    const { data } = parseFrontmatter(texto);
    const parsed = SkillMetadata.safeParse(data);
    if (!parsed.success) {
      return { key, erro: `metadata inválido: ${parsed.error.message}` };
    }
    // Apenas `active` entra no índice. `candidate` fica fora do _meta
    // mesmo que esteja por engano em `active/` (e vice-versa).
    if (parsed.data.status !== "active") {
      return { key, erro: `status='${parsed.data.status}' não entra no meta` };
    }
    return { key, metadata: parsed.data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return { key, erro: `parse falhou: ${message}` };
  }
}

/**
 * Converte `SkillMetadata` em `SkillListItem` (remove campos pesados).
 */
function toListItem(meta: SkillMetadata): SkillListItem {
  return {
    nome: meta.nome,
    descricao: meta.descricao,
    categoria: meta.categoria,
    versao: meta.versao,
    tokens_aproximados: meta.tokens_aproximados,
    agentes_aplicaveis: meta.agentes_aplicaveis,
  };
}

/**
 * Agrupa skills por categoria, mantendo nomes em ordem alfabética dentro
 * de cada grupo (saída determinística → diffs do `_meta.md` ficam limpos).
 *
 * Devolve `Partial` porque nem toda categoria precisa estar representada.
 */
function agruparPorCategoria(
  skills: SkillMetadata[],
): Partial<Record<SkillCategoria, string[]>> {
  const grupos: Partial<Record<SkillCategoria, string[]>> = {};
  for (const s of skills) {
    if (!grupos[s.categoria]) grupos[s.categoria] = [];
    grupos[s.categoria]!.push(s.nome);
  }
  for (const cat of Object.keys(grupos) as SkillCategoria[]) {
    grupos[cat]!.sort();
  }
  return grupos;
}

/**
 * Rótulos legíveis (PT-BR) para as categorias canônicas. Usados no `_meta.md`.
 */
const ROTULOS_CATEGORIA: Record<SkillCategoria, string> = {
  "analise-peticao": "Análise de petição",
  "geracao-parecer": "Geração de parecer",
  "calculo-tributario": "Cálculo tributário",
  "pesquisa-legislacao": "Pesquisa em legislação",
  utilidades: "Utilidades",
};

/**
 * Gera o markdown legível do índice agregado.
 *
 * Mantém ~500 tokens com até 10-15 skills: tabela compacta, sem cabeçalhos
 * verbosos. Cada categoria vira uma sub-seção com lista bullet.
 */
function gerarMetaMarkdown(skills: SkillMetadata[]): string {
  const grupos = agruparPorCategoria(skills);
  const partes: string[] = [];
  partes.push("# Skills disponíveis");
  partes.push("");
  partes.push(
    "Use `skill_carregar(nome)` para baixar o conteúdo completo de uma skill.",
  );
  partes.push("");
  partes.push(`Total: ${skills.length} skills ativas.`);
  partes.push("");

  // Ordenamos categorias na mesma ordem de `SkillCategoria` para
  // garantir diff estável e leitura previsível.
  const ordemCategorias: SkillCategoria[] = [
    "analise-peticao",
    "geracao-parecer",
    "calculo-tributario",
    "pesquisa-legislacao",
    "utilidades",
  ];

  for (const cat of ordemCategorias) {
    const nomes = grupos[cat];
    if (!nomes || nomes.length === 0) continue;
    partes.push(`## ${ROTULOS_CATEGORIA[cat]}`);
    partes.push("");
    partes.push("| Nome | Descrição | Tokens |");
    partes.push("|---|---|---|");
    for (const nome of nomes) {
      const meta = skills.find((s) => s.nome === nome);
      if (!meta) continue;
      // Encurta descrição para manter tabela < 80 col legível e index leve.
      const desc =
        meta.descricao.length > 120
          ? `${meta.descricao.slice(0, 117)}...`
          : meta.descricao;
      partes.push(`| \`${meta.nome}\` | ${desc} | ${meta.tokens_aproximados} |`);
    }
    partes.push("");
  }
  return partes.join("\n");
}

/**
 * Resultado da regeneração — útil para a tool `skill_publicar` reportar status.
 */
export interface RegenerarMetaResult {
  total_skills_consideradas: number;
  total_skills_indexadas: number;
  erros: Array<{ key: string; erro: string }>;
  tamanho_meta_md_bytes: number;
  gerado_em: string;
}

/**
 * Pipeline completa de regeneração. Idempotente — pode ser chamada com
 * segurança após qualquer publicação.
 *
 * Ordem dos efeitos:
 *   1. Grava `_meta.md` e `_meta.json` no R2 (leitor pode ler durante a
 *      regen sem ver estado inconsistente — o R2 escreve atomicamente
 *      por objeto).
 *   2. Invalida `skill:_meta` no KV. Próxima leitura via `skill_listar`
 *      vai buscar do R2 e popular cache novo.
 */
export async function regenerarMeta(env: Env): Promise<RegenerarMetaResult> {
  const keys = await listarKeysAtivas(env);
  const totalConsideradas = keys.length;

  // Paraleliza leituras — R2 aguenta dezenas de gets simultâneos.
  // Para evitar saturar o isolate em volumes maiores, podemos passar a
  // chunkar (10 em 10). Por enquanto, dezenas de skills é seguro.
  const resultados = await Promise.all(
    keys.map((k) => extrairMetadata(env, k)),
  );

  const validas: SkillMetadata[] = [];
  const erros: Array<{ key: string; erro: string }> = [];
  for (const r of resultados) {
    if (r.metadata) validas.push(r.metadata);
    else if (r.erro) erros.push({ key: r.key, erro: r.erro });
  }

  // Ordena por nome para diff estável.
  validas.sort((a, b) => a.nome.localeCompare(b.nome));

  const geradoEm = new Date().toISOString();
  const metaJson: MetaIndex = MetaIndex.parse({
    versao_formato: "1.0.0",
    gerado_em: geradoEm,
    total_skills: validas.length,
    skills: validas.map(toListItem),
    por_categoria: agruparPorCategoria(validas),
  });

  const metaMd = gerarMetaMarkdown(validas);

  // Gravações em paralelo — independentes.
  await Promise.all([
    env.R2_SKILLS.put(SKILL_R2_KEY_META_MD, metaMd, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    }),
    env.R2_SKILLS.put(SKILL_R2_KEY_META_JSON, JSON.stringify(metaJson, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    }),
  ]);

  // Invalida cache KV. Falha aqui não derruba a regen — KV é best-effort.
  try {
    await cacheDelete(env, SKILL_KV_KEY_META);
  } catch {
    // ignora — KV indisponível não invalida a operação principal.
  }

  return {
    total_skills_consideradas: totalConsideradas,
    total_skills_indexadas: validas.length,
    erros,
    tamanho_meta_md_bytes: new TextEncoder().encode(metaMd).byteLength,
    gerado_em: geradoEm,
  };
}
